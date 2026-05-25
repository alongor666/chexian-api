/**
 * GET /api/query/sql — DuckDB SELECT/WITH 直通
 *
 * PIVOT 覆盖不了的复杂场景（窗口函数 / 多 CTE / LAG/LEAD）的安全兜底。
 *
 * 5 层安全堆叠：
 *   1. authMiddleware + readonlyMiddleware (router 级) — PAT 仅 GET
 *   2. permissionMiddleware (router 级) — 生成 req.permissionFilter
 *   3. validateSQL — 8 层校验（长度/单语句/SELECT|WITH/DDL/文件函数/PolicyFact/policy_no/聚合）
 *   4. injectPermissionIntoAnySql — RLS 强制注入（支持 CTE）
 *   5. withRouteCache — 同参命中缓存
 *
 * 审计：middleware/audit.ts 自动覆盖 /api/query/* — SQL 文本在 query.sql 字段。
 */
import { Router } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, withRouteCache } from './shared.js';
import { validateSQL } from '../../utils/sql-validator.js';
import { injectPermissionIntoAnySql } from '../../utils/sql-permission-injector.js';

const router = Router();

router.get(
  '/sql',
  withRouteCache('sql', QUERY_CACHE.hotspotShort),
  asyncHandler(async (req, res) => {
    const sql = String(req.query.sql ?? '').trim();
    if (!sql) {
      throw new AppError(400, 'SQL: 缺少 sql 参数');
    }

    const validation = validateSQL(sql);
    if (!validation.valid) {
      throw new AppError(400, validation.error ?? 'SQL 校验失败');
    }

    let safeSql: string;
    try {
      safeSql = injectPermissionIntoAnySql(sql, req.permissionFilter ?? '1=1');
    } catch (err) {
      throw new AppError(400, `SQL 权限注入失败: ${(err as Error).message}`);
    }

    const rows = await duckdbService.query(safeSql, QUERY_CACHE.hotspotShort);

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: rows,
        meta: { rowCount: Array.isArray(rows) ? rows.length : 0 },
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
