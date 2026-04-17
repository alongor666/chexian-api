/**
 * 查询路由统一入口
 *
 * 历史 2789 行单体实现已拆分到 `server/src/routes/query/*.ts`。
 * 此文件是唯一对外入口，负责聚合子路由并统一挂载权限中间件。
 * 归档原文：`archive/legacy-code/2026-03-query-route-split/query.legacy.ts`
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { snapshotServe } from '../middleware/snapshot-serve.js';

import kpiRoutes from './query/kpi.js';
import trendRoutes from './query/trend.js';
import truckRoutes from './query/truck.js';
import growthRoutes from './query/growth.js';
import costRoutes from './query/cost.js';
import comprehensiveRoutes from './query/comprehensive.js';
// renewalRoutes removed — replaced by renewal-v2
import crossSellRoutes from './query/cross-sell.js';
import salesmanRoutes from './query/salesman.js';
import reportRoutes from './query/report.js';
import premiumPlanRoutes from './query/premium-plan.js';
import performanceRoutes from './query/performance.js';
import bundleRoutes from './query/bundles.js';
// renewalFunnelRoutes removed — replaced by renewal-v2
import quoteConversionRoutes from './query/quote-conversion.js';
import claimsDetailRoutes from './query/claims-detail.js';
import expenseDevRoutes from './query/expense-development.js';
import repairRoutes from './query/repair.js';
import customerFlowRoutes from './query/customer-flow.js';
import renewalV2Routes from './query/renewal-v2.js';
import patrolRoutes from './query/patrol.js';
import policyGeoRoutes from './query/policy-geo.js';

export { buildRouteCacheKey } from './query/shared.js';
export { fetchDashboardBundleData } from './query/bundles.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);
router.use(snapshotServe);

router.use(kpiRoutes);
router.use(trendRoutes);
router.use(truckRoutes);
router.use(growthRoutes);
router.use(costRoutes);
router.use(comprehensiveRoutes);
// renewalRoutes removed — replaced by renewal-v2
router.use(crossSellRoutes);
router.use(salesmanRoutes);
router.use(reportRoutes);
router.use(premiumPlanRoutes);
router.use(performanceRoutes);
router.use(bundleRoutes);
// renewalFunnelRoutes removed — replaced by renewal-v2
router.use(quoteConversionRoutes);
router.use(claimsDetailRoutes);
router.use(expenseDevRoutes);
router.use(repairRoutes);
router.use(customerFlowRoutes);
router.use(renewalV2Routes);
router.use(patrolRoutes);
router.use(policyGeoRoutes);

export default router;
