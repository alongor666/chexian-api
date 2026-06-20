import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, parseFiltersAndBuildWhere, withRouteCache } from './shared.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../../sql/salesman-ranking.js';
import { isSalesmanCubeServable, generateSalesmanRankingCubeQuery } from '../../sql/cube/salesman-cube.js';
import { ensureSalesmanCubeFresh } from '../../services/duckdb-cube.js';
import { runShadowCompare, runPostCutoverShadowSample } from '../../services/cube-shadow.js';
import { isCubeRoutingEnabledFor, isCubeShadowEnabledFor, shouldSamplePostCutoverShadow } from '../../services/cube-routing.js';

const router = Router();

/**
 * 业务员立方体接线（第五批次，BACKLOG uid=2026-06-11-claude-90a92c）。
 * 双开关默认关闭时零生效。返回 null 表示走原路径（不可服务/未就绪/开关关闭）。
 * 影子模式：返回原路径结果，同时后台双跑比对。
 */
async function trySalesmanCube(
  rankingType: 'all' | 'quality',
  whereClause: string,
  limit: number,
  legacyRunner: () => Promise<Array<Record<string, unknown>>>
): Promise<Array<Record<string, unknown>> | null> {
  const cubeRouting = isCubeRoutingEnabledFor('salesman-ranking');
  const cubeShadow = isCubeShadowEnabledFor('salesman-ranking');
  if (!cubeRouting && !cubeShadow) return null;
  if (!isSalesmanCubeServable(whereClause).servable) return null;
  if (ensureSalesmanCubeFresh(duckdbService) !== 'ready') return null;

  const cubeSql = generateSalesmanRankingCubeQuery(rankingType, whereClause, limit);
  if (cubeRouting) {
    const cubeRows = await duckdbService.query<Record<string, unknown>>(cubeSql);
    // 切流后采样影子（R3/bf2c4e）：对外已返 cube，后台跑 legacy 对账
    if (shouldSamplePostCutoverShadow('salesman-ranking')) {
      runPostCutoverShadowSample('salesman-ranking', cubeRows, legacyRunner);
    }
    return cubeRows;
  }
  // 影子对账：先取原路径结果返回调用方，后台比对立方体结果
  const legacyResult = await legacyRunner();
  runShadowCompare('salesman-ranking', legacyResult, () => duckdbService.query(cubeSql));
  return legacyResult;
}

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

    const cubeResult = await trySalesmanCube(
      rankingType,
      finalWhereClause,
      limit,
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
