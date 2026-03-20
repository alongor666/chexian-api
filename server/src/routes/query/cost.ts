import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, isValidDateFormat } from './shared.js';
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

const router = Router();

/**
 * 成本分析请求验证Schema（特有参数）
 */
const costExtraSchema = z.object({
  type: z.enum(['earned', 'earned-new', 'expense-forecast']).optional(),
  analysisType: z.enum(['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost']).optional(),
  dimension: z.enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage']).default('org_level_3'),
  cutoffDate: z.string().optional(),
  operatingCostRate: z.string().optional(),
  policyMonth: z.string().optional(),
});

/**
 * GET /api/query/cost
 * 成本分析（赔付率/费用率/综合费用率/变动成本率）
 */
router.get(
  '/cost',
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

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
