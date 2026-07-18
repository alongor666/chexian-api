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
 * PAT 专项：enforcePatSqlPolicy（安全审查 M5，backlog uid=2026-07-12-claude-4b93ea）在
 * validateSQL 通过后收口 PAT 调用——默认档 'audit' 额外打一条独立重点审计 console.warn，
 * 'deny' 档 403 拒绝（见 config/env.ts 的 PAT_SQL_POLICY 三态说明）。
 */
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, AppError, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, withRouteCache } from './shared.js';
import { validateSQL } from '../../utils/sql-validator.js';
import { injectPermissionIntoAnySql, isPermissionFilterMissing } from '../../utils/sql-permission-injector.js';
import { getReferencedLazyDomains } from '../../config/sql-federation-policy.js';
import { getBootstrapper } from '../../services/bootstrapper-registry.js';
import { authEnv } from '../../config/env.js';

export type PatSqlPolicy = 'allow' | 'audit' | 'deny';

export interface PatSqlAuditContext {
  /** 原始 SQL 文本（未注入权限过滤前） */
  sql: string;
  /** 本次 SQL 命中的惰性派生域清单（getReferencedLazyDomains 计算结果，可复用） */
  referencedDomains: string[];
}

/** console.warn 打印的 SQL 摘要长度上限，避免超长 SQL 把审计日志行撑爆 */
const SQL_PREVIEW_MAX_LENGTH = 200;

/**
 * PAT 调用 GET /api/query/sql 的策略执行 + 重点审计（安全审查 M5）。
 *
 * 背景：readonlyMiddleware 只挡 PAT 的非 GET 方法，SQL 直通端点仍对 PAT 全量放开
 * （虽仍受 RLS 强制注入约束，但暴露面偏宽）。`cx sql`（CLI，见 cli/src/commands/sql.ts）
 * 与部分 MCP agent 工具依赖此端点用 PAT 调用，故不能一刀切拒绝。
 *
 * - 非 PAT（会话 JWT）调用：直接跳过，零行为变更（回归安全网）。
 * - 'allow'：放行，不打重点审计。
 * - 'audit'（默认，兼容现状）：放行 + 打一条独立 console.warn 重点审计——与
 *   middleware/audit.ts 的 auditMiddleware 写入 logs/audit.log 的通用 /api/query/*
 *   审计条目（已含 auth_kind=pat + token_id）并行、互不覆盖，本函数不改动该服务本体。
 * - 'deny'：抛 AppError(403)，路由层负责把它转成 HTTP 响应。
 *
 * @param policy 默认读取 authEnv.PAT_SQL_POLICY；测试用例可显式传参覆盖，避免依赖
 *   进程级 env 单例（authEnv 在模块加载时即固化，vi.mock 成本高且会污染其他用例）。
 */
export function enforcePatSqlPolicy(
  req: Request,
  ctx: PatSqlAuditContext,
  policy: PatSqlPolicy = authEnv.PAT_SQL_POLICY
): void {
  if (!req.pat) return; // 会话 JWT 调用不受本策略约束

  if (policy === 'deny') {
    throw new AppError(
      403,
      'PAT 已被策略禁止调用 SQL 直通端点（PAT_SQL_POLICY=deny）。请改用会话 Token 调用，或联系管理员调整策略。'
    );
  }

  if (policy === 'audit') {
    console.warn(
      JSON.stringify({
        tag: 'pat-sql-audit',
        level: 'security',
        timestamp: new Date().toISOString(),
        tokenId: req.pat.tokenId,
        tokenName: req.pat.name,
        username: req.user?.username,
        role: req.user?.role,
        sqlLength: ctx.sql.length,
        sqlPreview: ctx.sql.slice(0, SQL_PREVIEW_MAX_LENGTH),
        referencedDomains: ctx.referencedDomains,
      })
    );
  }
  // 'allow'：不额外处理，仅走既有 auditMiddleware 通用审计
}

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

    // 命中派生域：惰性预热（下方 bootstrapper 分支）与 PAT 重点审计上下文共用一次计算。
    const referencedDomains = getReferencedLazyDomains(sql);

    // PAT 策略收口（安全审查 M5）：非 PAT 调用零行为变更；deny 档在此 403，audit 档打重点审计。
    enforcePatSqlPolicy(req, { sql, referencedDomains });

    // 惰性域预热：cx sql 直查不经 typed 路由的 createDomainMiddleware，须在此对 SQL 引用到的
    // federated 关系手动触发 ensureDomainLoaded，否则纯惰性域（如 NewEnergyClaims）冷态查询会
    // 「table does not exist」。开关关闭时 getReferencedLazyDomains 恒返回空，零额外开销。
    const bootstrapper = getBootstrapper();
    if (bootstrapper) {
      for (const domain of referencedDomains) {
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
