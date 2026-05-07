import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import { generateTonnageRoseQuery, generateOrgByTonnageQuery, generateTonnageByOrgQuery } from '../../sql/truck.js';

const router = Router();

/**
 * 营业货车分析请求验证Schema（特有参数）
 */
const truckExtraSchema = z.object({
  queryType: z.enum(['rose', 'orgByTonnage', 'tonnageByOrg', 'all']).default('rose'),
  metric: z.enum(['premium', 'count']).default('premium'),
});

/**
 * GET /api/query/truck
 * 营业货车专项分析
 */
router.get(
  '/truck',
  withRouteCache('truck'),
  asyncHandler(async (req, res) => {
    const truckResult = truckExtraSchema.safeParse(req.query);
    if (!truckResult.success) {
      throw new AppError(400, truckResult.error.issues[0].message);
    }
    const { queryType, metric } = truckResult.data;

    const { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    // queryType=all: 一次性返回所有4个子查询结果（前端货车面板需要）
    if (queryType === 'all') {
      const [rosePremium, roseCount, tonnageByOrg, orgPremium] = await Promise.all([
        duckdbService.query(generateTonnageRoseQuery('premium', finalWhereClause)),
        duckdbService.query(generateTonnageRoseQuery('count', finalWhereClause)),
        duckdbService.query(generateTonnageByOrgQuery(finalWhereClause)),
        duckdbService.query(generateOrgByTonnageQuery(finalWhereClause)),
      ]);

      res.json({
        success: true,
        data: { rosePremium, roseCount, tonnageByOrg, orgPremium },
      });
      return;
    }

    let sql: string;
    switch (queryType) {
      case 'rose':
        sql = generateTonnageRoseQuery(metric, finalWhereClause);
        break;
      case 'orgByTonnage':
        sql = generateOrgByTonnageQuery(finalWhereClause);
        break;
      case 'tonnageByOrg':
        sql = generateTonnageByOrgQuery(finalWhereClause);
        break;
      default:
        sql = generateTonnageRoseQuery(metric, finalWhereClause);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
