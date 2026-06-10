import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../../sql/salesman-ranking.js';

const router = Router();

export const salesmanRankingExtraSchema = z.object({
  rankingType: z.enum(['all', 'quality']).default('all'),
  limit: z.coerce.number().default(10),
});

router.get(
  '/salesman-ranking',
  withRouteCache('salesman-ranking'),
  asyncHandler(async (req, res) => {
    const rankingResult = salesmanRankingExtraSchema.safeParse(req.query);
    if (!rankingResult.success) {
      throw new AppError(400, rankingResult.error.issues[0].message);
    }
    const { rankingType, limit } = rankingResult.data;

    const { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    let sql: string;
    if (rankingType === 'all') {
      sql = generateSalesmanAllBusinessRankingQuery(finalWhereClause, limit);
    } else {
      sql = generateSalesmanQualityBusinessRankingQuery(finalWhereClause, limit);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
