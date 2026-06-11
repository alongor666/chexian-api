import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { readonlyMiddleware } from '../middleware/readonly.js';
import { requireRole, UserRole } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { getBootstrapper } from '../services/bootstrapper-registry.js';

const router = Router();

const reloadSchema = z.object({
  domains: z.array(z.enum(['customer_flow', 'new_energy_claims'])).min(1),
});

router.post(
  '/data/reload',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = reloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'Invalid reload request');
    }

    const bootstrapper = getBootstrapper();
    if (!bootstrapper) {
      throw new AppError(503, 'Data bootstrapper is not ready');
    }

    const results = await bootstrapper.reloadDomains(parsed.data.domains);
    res.json({
      success: true,
      domains: results,
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
