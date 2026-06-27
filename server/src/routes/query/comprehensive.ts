import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere, extractOrgNames, resolveBranchRlsCode,
  isValidDateFormat, logger, createDomainMiddleware,
  QUERY_CACHE, HTTP_MAX_AGE,
  buildRouteCacheKey, getRouteCache, setRouteCache,
  markRequestCacheHit, sendWithEtag, buildResponseMeta,
  resolveCutoffDate, computeTimeProgress, toFiniteNumber,
  DEFAULT_COMPREHENSIVE_THRESHOLDS,
  buildComprehensiveAlerts, withRankByDimType, requirePermissionFilter,
  type ComprehensiveMetricRow,
} from './shared.js';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveLossTrendQuery,
  generateComprehensivePlanByOrgQuery,
  generateComprehensiveSummaryQuery,
  type ComprehensiveDimension,
  type ComprehensiveGranularity,
} from '../../sql/comprehensive-analysis.js';

const router = Router();

// 确保 ClaimsAgg 惰性域在首次访问综合分析 API 时已加载
router.use(createDomainMiddleware('ClaimsAgg'));

export const comprehensiveExtraSchema = z.object({
  cutoffDate: z.string().optional(),
  planYear: z.coerce.number().int().optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

async function handleComprehensiveBundle(req: Request, res: Response): Promise<void> {
  const parseResult = comprehensiveExtraSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const routeCacheKey = buildRouteCacheKey(req, 'comprehensive-bundle');
  const cachedBundleData = getRouteCache<Record<string, unknown>>(routeCacheKey);
  if (cachedBundleData) {
    markRequestCacheHit();
    sendWithEtag(req, res, {
      success: true,
      data: cachedBundleData,
      meta: buildResponseMeta(res),
    }, HTTP_MAX_AGE.bundle);
    return;
  }

  const { cutoffDate: requestedCutoffDate, planYear: requestedPlanYear, granularity } = parseResult.data;
  const { filterData, whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

  if (requestedCutoffDate && !isValidDateFormat(requestedCutoffDate)) {
    throw new AppError(400, `Invalid cutoffDate format: ${requestedCutoffDate}. Expected YYYY-MM-DD`);
  }

  const maxDateRows = await duckdbService.query<{ max_data_date: string | null }>(
    `SELECT MAX(CAST(policy_date AS DATE)) AS max_data_date FROM PolicyFact WHERE ${whereWithoutDate}`,
    QUERY_CACHE.hotspotShort
  );
  const maxDataDate = maxDateRows[0]?.max_data_date ? String(maxDateRows[0].max_data_date) : null;
  const resolvedCutoffDate = resolveCutoffDate(requestedCutoffDate, filterData.endDate, maxDataDate);

  if (!isValidDateFormat(resolvedCutoffDate)) {
    throw new AppError(400, `Invalid resolved cutoffDate: ${resolvedCutoffDate}. Expected YYYY-MM-DD`);
  }

  const resolvedPlanYear = requestedPlanYear ?? Number(resolvedCutoffDate.slice(0, 4));
  const timeProgress = computeTimeProgress(resolvedCutoffDate);
  const thresholds = DEFAULT_COMPREHENSIVE_THRESHOLDS;

  const dimensions: ComprehensiveDimension[] = ['org', 'category', 'business'];
  const [summaryRows, ...dimensionResults] = await Promise.all([
    duckdbService.query(generateComprehensiveSummaryQuery(whereWithDate, resolvedCutoffDate), QUERY_CACHE.hotspotShort),
    ...dimensions.map((dimension) =>
      duckdbService.query(
        generateComprehensiveDimensionMetricsQuery({
          dimension,
          whereClause: whereWithDate,
          cutoffDate: resolvedCutoffDate,
        }),
        QUERY_CACHE.hotspotShort
      )
    ),
  ]);

  const orgNames = extractOrgNames(filterData, req.permissionFilter);
  // 分省 RLS（ADR G4 GATED 多省）：achievement_cache 年计划按省过滤（双门控；flag off / 单省无列 → 不注入）
  const rlsBranchCode = await resolveBranchRlsCode(req, 'achievement_cache');
  let planRows: Array<{ dim_key: string; plan_premium: number }> = [];
  try {
    planRows = await duckdbService.query(
      generateComprehensivePlanByOrgQuery(resolvedPlanYear, orgNames, rlsBranchCode),
      QUERY_CACHE.hotspotMedium
    );
  } catch (error) {
    logger.warn('comprehensive-bundle: failed to load achievement_cache plan data, fallback to null plan.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const planMap = new Map<string, number>();
  for (const row of planRows) {
    if (!row?.dim_key) continue;
    planMap.set(String(row.dim_key), toFiniteNumber(row.plan_premium));
  }

  const normalizedRows: ComprehensiveMetricRow[] = dimensionResults.flatMap((rows, idx) => {
    const dimType = dimensions[idx];
    return (rows as Array<Record<string, unknown>>).map((row) => {
      const dimKey = String(row.dim_key ?? '未知');
      const planPremium = dimType === 'org' ? (planMap.get(dimKey) ?? null) : null;
      const signedPremium = toFiniteNumber(row.signed_premium);
      // signed_premium 单位为元、plan_premium（achievement_cache.plan_vehicle）单位为万元，
      // 分子须先 /10000 对齐（同 kpi.ts vehicle_achievement_rate），否则达成率被压成约 1/10000
      const achievementRate =
        planPremium && planPremium > 0 && timeProgress && timeProgress > 0
          ? Number((((signedPremium / 10000) / planPremium) / timeProgress * 100).toFixed(2))
          : null;

      return {
        dim_type: dimType,
        dim_key: dimKey,
        policy_count: Math.max(0, Math.round(toFiniteNumber(row.policy_count))),
        signed_premium: signedPremium,
        reported_claims: toFiniteNumber(row.reported_claims),
        fee_amount: toFiniteNumber(row.fee_amount),
        claim_cases: Math.max(0, Math.round(toFiniteNumber(row.claim_cases))),
        earned_premium: toFiniteNumber(row.earned_premium),
        earned_claim_ratio: row.earned_claim_ratio === null ? null : toFiniteNumber(row.earned_claim_ratio, NaN),
        expense_ratio: row.expense_ratio === null ? null : toFiniteNumber(row.expense_ratio, NaN),
        variable_cost_ratio:
          row.variable_cost_ratio === null ? null : toFiniteNumber(row.variable_cost_ratio, NaN),
        avg_claim_amount: row.avg_claim_amount === null ? null : toFiniteNumber(row.avg_claim_amount, NaN),
        claim_frequency: row.claim_frequency === null ? null : toFiniteNumber(row.claim_frequency, NaN),
        comprehensive_expense_ratio:
          row.comprehensive_expense_ratio === null
            ? null
            : toFiniteNumber(row.comprehensive_expense_ratio, NaN),
        per_vehicle_premium:
          row.per_vehicle_premium === null ? null : toFiniteNumber(row.per_vehicle_premium, NaN),
        premium_share: toFiniteNumber(row.premium_share),
        claim_share: toFiniteNumber(row.claim_share),
        expense_share: toFiniteNumber(row.expense_share),
        plan_premium: planPremium,
        achievement_rate: achievementRate,
      };
    });
  }).map((row) => ({
    ...row,
    earned_claim_ratio: Number.isFinite(row.earned_claim_ratio ?? NaN) ? row.earned_claim_ratio : null,
    expense_ratio: Number.isFinite(row.expense_ratio ?? NaN) ? row.expense_ratio : null,
    variable_cost_ratio: Number.isFinite(row.variable_cost_ratio ?? NaN) ? row.variable_cost_ratio : null,
    avg_claim_amount: Number.isFinite(row.avg_claim_amount ?? NaN) ? row.avg_claim_amount : null,
    claim_frequency: Number.isFinite(row.claim_frequency ?? NaN) ? row.claim_frequency : null,
    comprehensive_expense_ratio: Number.isFinite(row.comprehensive_expense_ratio ?? NaN)
      ? row.comprehensive_expense_ratio
      : null,
    per_vehicle_premium: Number.isFinite(row.per_vehicle_premium ?? NaN)
      ? row.per_vehicle_premium
      : null,
  }));

  const rankedRows = withRankByDimType(normalizedRows);
  const orgRows = rankedRows.filter((row) => row.dim_type === 'org');
  const orgScope = orgRows.map((row) => row.dim_key);

  const summaryRow = (summaryRows[0] || {}) as Record<string, unknown>;
  const totalSignedPremium = toFiniteNumber(summaryRow.signed_premium);
  // 达成率口径对齐：分子/分母必须同 scope（均来自 orgRows 计划覆盖范围），
  // 否则分子用全量签单 / 分母用计划机构 会让比率虚高。
  const totalPlanPremium = orgRows.reduce((sum, row) => sum + (row.plan_premium || 0), 0);
  const totalSignedPremiumForPlan = orgRows.reduce(
    (sum, row) => sum + (toFiniteNumber(row.signed_premium) || 0),
    0
  );
  // 同上：signed_premium（元）→ /10000 对齐 plan（万元）
  const summaryAchievementRate =
    totalPlanPremium > 0 && timeProgress && timeProgress > 0
      ? Number((((totalSignedPremiumForPlan / 10000) / totalPlanPremium) / timeProgress * 100).toFixed(2))
      : null;

  const lossTrendRows = await duckdbService.query(
    generateComprehensiveLossTrendQuery(
      whereWithDate,
      resolvedCutoffDate,
      granularity as ComprehensiveGranularity
    ),
    QUERY_CACHE.hotspotShort
  );

  const overviewRows = rankedRows;
  const overviewAlerts = buildComprehensiveAlerts(orgRows, thresholds);

  const expenseSurplusRows = rankedRows.map((row) => {
    const expenseRateDeviation =
      row.expense_ratio === null
        ? null
        : Number((row.expense_ratio - thresholds.expenseBudget).toFixed(2));
    const expenseSurplusAmount =
      expenseRateDeviation === null
        ? null
        : Number((row.signed_premium * expenseRateDeviation / 100).toFixed(2));

    return {
      dim_type: row.dim_type,
      dim_key: row.dim_key,
      expenseRateDeviation,
      expenseSurplusAmount,
    };
  });

  const roiRows = rankedRows.map((row) => {
    const claimRatio = row.earned_claim_ratio !== null ? row.earned_claim_ratio / 100 : null;
    const expenseRatio = row.expense_ratio !== null ? row.expense_ratio / 100 : null;
    const marginContribution =
      claimRatio !== null && expenseRatio !== null
        ? Number((row.signed_premium * (1 - claimRatio - expenseRatio)).toFixed(2))
        : null;
    const expenseOutputPremiumRatio =
      row.fee_amount > 0 ? Number((row.signed_premium / row.fee_amount).toFixed(4)) : null;
    const expenseOutputMarginRatio =
      row.fee_amount > 0 && marginContribution !== null
        ? Number((marginContribution / row.fee_amount).toFixed(4))
        : null;
    const marginRate =
      row.signed_premium > 0 && marginContribution !== null
        ? Number((marginContribution * 100.0 / row.signed_premium).toFixed(2))
        : null;

    return {
      dim_type: row.dim_type,
      dim_key: row.dim_key,
      signed_premium: row.signed_premium,
      expense_amount: row.fee_amount,
      marginContribution,
      expenseOutputPremiumRatio,
      expenseOutputMarginRatio,
      marginRate,
    };
  });

  const bundleData = {
    meta: {
      cutoffDate: resolvedCutoffDate,
      maxDataDate,
      planYear: resolvedPlanYear,
      orgScope,
      permissionFilter: requirePermissionFilter(req.permissionFilter),
      thresholds,
      timeProgress,
    },
    overview: {
      summary: {
        signedPremium: totalSignedPremium,
        reportedClaims: toFiniteNumber(summaryRow.reported_claims),
        expenseAmount: toFiniteNumber(summaryRow.fee_amount),
        earnedClaimRatio:
          summaryRow.earned_claim_ratio === null ? null : toFiniteNumber(summaryRow.earned_claim_ratio, NaN),
        expenseRatio: summaryRow.expense_ratio === null ? null : toFiniteNumber(summaryRow.expense_ratio, NaN),
        variableCostRatio:
          summaryRow.variable_cost_ratio === null ? null : toFiniteNumber(summaryRow.variable_cost_ratio, NaN),
        comprehensiveExpenseRatio:
          summaryRow.comprehensive_expense_ratio === null
            ? null
            : toFiniteNumber(summaryRow.comprehensive_expense_ratio, NaN),
        perVehiclePremium:
          summaryRow.per_vehicle_premium === null
            ? null
            : toFiniteNumber(summaryRow.per_vehicle_premium, NaN),
        claimFrequency:
          summaryRow.claim_frequency === null
            ? null
            : toFiniteNumber(summaryRow.claim_frequency, NaN),
        achievementRate: summaryAchievementRate,
      },
      rows: overviewRows,
      alerts: overviewAlerts,
    },
    premium: {
      rows: rankedRows,
    },
    cost: {
      rows: rankedRows,
    },
    loss: {
      quadrantRows: rankedRows,
      trendRows: lossTrendRows,
    },
    expense: {
      rows: rankedRows,
      surplusRows: expenseSurplusRows,
    },
    roi: {
      rows: roiRows,
    },
  };

  setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

  sendWithEtag(req, res, {
    success: true,
    data: bundleData,
    meta: buildResponseMeta(res),
  }, HTTP_MAX_AGE.bundle);
}

router.get(
  '/comprehensive-bundle',
  asyncHandler(async (req, res) => {
    await handleComprehensiveBundle(req, res);
  })
);

router.get(
  '/comprehensive-analysis-bundle',
  asyncHandler(async (req, res) => {
    await handleComprehensiveBundle(req, res);
  })
);

export default router;
