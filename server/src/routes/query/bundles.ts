/**
 * Bundle routes for aggregated multi-query endpoints.
 * Consolidates dashboard-bundle, performance-bundle, and cross-sell-bundle.
 *
 * Sub-route files:
 *   - bundles/cross-sell.ts   — GET /cross-sell-bundle
 *   - bundles/dashboard.ts    — GET /dashboard-bundle + fetchDashboardBundleData()
 *   - bundles/performance.ts  — GET /performance-bundle
 */

import { Router } from 'express';
import crossSellBundleRouter from './bundles/cross-sell.js';
import dashboardBundleRouter from './bundles/dashboard.js';
import performanceBundleRouter from './bundles/performance.js';

export { fetchDashboardBundleData } from './bundles/dashboard.js';

const router = Router();

router.use(crossSellBundleRouter);
router.use(dashboardBundleRouter);
router.use(performanceBundleRouter);

export default router;
