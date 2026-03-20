/**
 * 查询路由合并入口
 * 将拆分的子路由模块合并为统一的 Router
 *
 * 原 query.ts (2789行) → 13个模块文件
 */

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';

// Sub-route modules
import kpiRoutes from './kpi.js';
import trendRoutes from './trend.js';
import truckRoutes from './truck.js';
import growthRoutes from './growth.js';
import coefficientRoutes from './coefficient.js';
import costRoutes from './cost.js';
import comprehensiveRoutes from './comprehensive.js';
import renewalRoutes from './renewal.js';
import crossSellRoutes from './cross-sell.js';
import salesmanRoutes from './salesman.js';
import reportRoutes from './report.js';
import premiumPlanRoutes from './premium-plan.js';
import performanceRoutes from './performance.js';
import bundleRoutes from './bundles.js';

// Re-export for backward compatibility
export { buildRouteCacheKey } from './shared.js';
export { fetchDashboardBundleData } from './bundles.js';

const router = Router();

// Apply auth + permission middleware to all query routes
router.use(authMiddleware);
router.use(permissionMiddleware);

// Mount all sub-routers
router.use(kpiRoutes);
router.use(trendRoutes);
router.use(truckRoutes);
router.use(growthRoutes);
router.use(coefficientRoutes);
router.use(costRoutes);
router.use(comprehensiveRoutes);
router.use(renewalRoutes);
router.use(crossSellRoutes);
router.use(salesmanRoutes);
router.use(reportRoutes);
router.use(premiumPlanRoutes);
router.use(performanceRoutes);
router.use(bundleRoutes);

export default router;
