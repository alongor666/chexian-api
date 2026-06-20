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
import { injectPermissionIntoAnySql, isPermissionFilterMissing } from '../../utils/sql-permission-injector.js';
import { getReferencedLazyDomains } from '../../config/sql-federation-policy.js';
import { getBootstrapper } from '../../services/bootstrapper-registry.js';

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

    // 惰性域预热：cx sql 直查不经 typed 路由的 createDomainMiddleware，须在此对 SQL 引用到的
    // federated 关系手动触发 ensureDomainLoaded，否则纯惰性域（如 NewEnergyClaims）冷态查询会
    // 「table does not exist」。开关关闭时 getReferencedLazyDomains 恒返回空，零额外开销。
    const bootstrapper = getBootstrapper();
    if (bootstrapper) {
      const domains = getReferencedLazyDomains(sql);
      for (const domain of domains) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await bootstrapper.ensureDomainLoaded(domain);
        } catch (err) {
          throw new AppError(503, `派生域加载失败 (${domain}): ${(err as Error).message}`);
        }
      }
    }

    // m1 fail-closed（plan 风险表 m1）：permissionMiddleware 必生成 permissionFilter；undefined =
    // 中间件未跑 = bug，绝不退化为 '1=1' 放行全表（federation 下 = 跨机构越权泄漏）。
    // '1=1'（branch_admin 合法无限制）由 injectPermissionIntoAnySql 短路放行，不在此拦截。
    if (isPermissionFilterMissing(req.permissionFilter)) {
      throw new AppError(403, 'SQL 权限过滤缺失（权限中间件未生成 permissionFilter）— fail-closed 拒绝执行');
    }
    let safeSql: string;
    try {
      safeSql = injectPermissionIntoAnySql(sql, req.permissionFilter);
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
