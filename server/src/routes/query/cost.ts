import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, isValidDateFormat, createDomainMiddleware, withRouteCache } from './shared.js';
import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
  generateEarnedPremiumQuery,
  generatePolicy2025In2025Query,
  generatePolicy2025In2026Query,
  generatePolicy2026In2026Query,
  generatePolicy2026In2027Query,
  generateNewEarnedPremiumSummaryQuery,
  generateMonthlyExpenseQuery,
  CostDimension,
} from '../../sql/cost.js';
import { isCostCubeServable, generateCostCubeQuery, type CostCubeAnalysisType } from '../../sql/cube/cost-cube.js';
import { ensureCostCubeFresh } from '../../services/duckdb-cube.js';
import { runShadowCompare } from '../../services/cube-shadow.js';
import { isCubeRoutingEnabledFor, isCubeShadowEnabledFor } from '../../services/cube-routing.js';
import type { CostAnalysisConfig } from '../../sql/cost/shared.js';

const router = Router();

/**
 * 成本立方体接线（第三批次，BACKLOG uid=2026-06-11-claude-90a92c）。
 * 双开关默认关闭时零生效。返回 null 表示走原路径（不可服务/未就绪/探针降级/开关关闭）。
 * 影子模式：返回原路径结果，同时后台双跑比对。
 */
async function tryCostCube(
  analysisType: CostCubeAnalysisType,
  config: CostAnalysisConfig,
  legacyRunner: () => Promise<Array<Record<string, unknown>>>
): Promise<Array<Record<string, unknown>> | null> {
  const cubeRouting = isCubeRoutingEnabledFor('cost');
  const cubeShadow = isCubeShadowEnabledFor('cost');
  if (!cubeRouting && !cubeShadow) return null;
  if (!isCostCubeServable({ whereClause: config.whereClause ?? '1=1', dimension: config.dimension }).servable) return null;
  if (ensureCostCubeFresh(duckdbService) !== 'ready') return null;

  const cubeSql = generateCostCubeQuery(analysisType, config);
  if (cubeRouting) {
    return duckdbService.query(cubeSql);
  }
  // 影子对账：先取原路径结果返回调用方，后台比对立方体结果
  const legacyResult = await legacyRunner();
  runShadowCompare('cost', legacyResult, () => duckdbService.query(cubeSql));
  return legacyResult;
}

// 确保 ClaimsAgg 惰性域在首次访问 cost API 时已加载
router.use(createDomainMiddleware('ClaimsAgg'));

/**
 * 成本分析请求验证Schema（特有参数）
 */
export const costExtraSchema = z.object({
  type: z.enum(['earned', 'earned-new', 'expense-forecast']).optional(),
  analysisType: z.enum(['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost']).optional(),
  dimension: z.enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage']).default('org_level_3'),
  cutoffDate: z.string().optional(),
  operatingCostRate: z.string().optional(),
  // B327：约束 policyMonth 为 YYYY-MM（月份 01-12）/ all / 空，路由层早拒注入与无效月份载荷
  //       （SQL 层 escapeSqlLiteral 为最终兜底；policy_month 由 STRFTIME('%Y-%m') 恒零填充，故 \d{2}+月份范围与数据对齐）
  policyMonth: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|all)?$/, 'policyMonth 应为 YYYY-MM（如 2026-01）或 all').optional(),
});

/**
 * GET /api/query/cost
 * 成本分析（赔付率/费用率/综合费用率/变动成本率）
 */
router.get(
  '/cost',
  withRouteCache('cost'),
  asyncHandler(async (req, res) => {
    const costResult = costExtraSchema.safeParse(req.query);
    if (!costResult.success) {
      throw new AppError(400, costResult.error.issues[0].message);
    }
    const { type, analysisType, dimension, cutoffDate, operatingCostRate, policyMonth } = costResult.data;

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    // 新协议：type=earned/earned-new/expense-forecast
    if (type) {
      if (type === 'earned') {
        if (!cutoffDate) {
          throw new AppError(400, 'cutoffDate is required when type=earned');
        }
        if (!isValidDateFormat(cutoffDate)) {
          throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
        }

        const sql = generateEarnedPremiumQuery({
          cutoffDate,
          whereClause: finalWhereClause,
          policyMonth,
          orgLevel3: filterData.orgLevel3,
        });
        const result = await duckdbService.query(sql);
        res.json({ success: true, data: result });
        return;
      }

      if (type === 'earned-new') {
        const config = { whereClause: finalWhereClause };
        const [policy2025In2025, policy2025In2026, policy2026In2026, policy2026In2027] = await Promise.all([
          duckdbService.query(generatePolicy2025In2025Query(config)),
          duckdbService.query(generatePolicy2025In2026Query(config)),
          duckdbService.query(generatePolicy2026In2026Query(config)),
          duckdbService.query(generatePolicy2026In2027Query(config)),
        ]);

        res.json({
          success: true,
          data: {
            policy2025In2025,
            policy2025In2026,
            policy2026In2026,
            policy2026In2027,
          },
        });
        return;
      }

      // type=expense-forecast
      const parsedRate = operatingCostRate === undefined ? 9 : Number(operatingCostRate);
      if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        throw new AppError(400, `Invalid operatingCostRate: ${operatingCostRate}. Expected 0-100`);
      }

      const config = { whereClause: finalWhereClause };
      const summaryData = await duckdbService.query(generateNewEarnedPremiumSummaryQuery(config));
      const monthlyExpenseData = await duckdbService.query(generateMonthlyExpenseQuery(config));

      res.json({
        success: true,
        data: {
          summaryData,
          monthlyExpenseData,
          operatingCostRate: parsedRate,
        },
      });
      return;
    }

    // 旧协议：analysisType + dimension + cutoffDate
    const finalAnalysisType = analysisType || 'claimRatio';
    if (!cutoffDate) {
      throw new AppError(400, 'cutoffDate is required for cost analysis');
    }
    if (!isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    const config = {
      dimension: dimension as CostDimension,
      cutoffDate,
      whereClause: finalWhereClause,
    };

    let sql: string;
    switch (finalAnalysisType) {
      case 'claimRatio':
        sql = generateClaimRatioQuery(config);
        break;
      case 'expenseRatio':
        sql = generateExpenseRatioQuery(config);
        break;
      case 'comprehensiveCost':
        sql = generateComprehensiveCostQuery(config);
        break;
      case 'variableCost':
        sql = generateVariableCostQuery(config);
        break;
      default:
        sql = generateClaimRatioQuery(config);
    }

    const cubeResult = await tryCostCube(
      finalAnalysisType as CostCubeAnalysisType,
      config,
      () => duckdbService.query(sql)
    );
    const result = cubeResult ?? await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
