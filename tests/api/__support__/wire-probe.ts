/**
 * 线缆探针（ApiClient 拆分审计 · 金 master 可重复 harness 支撑层）
 *
 * 纯支撑模块（不含 vitest 断言）：导出
 *   - REGISTRY：当前 apiClient 全部 99 个业务方法的「规范入参」清单
 *               （25 基类 + 74 命名空间；与 pre-#536 单体 client 逐方法对应）
 *   - serializeCall：把一次 fetch 调用归一化成稳定的线缆签名
 *   - FAR_FUTURE_JWT：探测期注入的恒不过期 token（让 auth 字段确定）
 *
 * 设计意图：金 master 评审残留要的是「逐方法 URL/param/verb 对 #536 前基线 diff」
 * 的**可重复**形态。本模块把「方法 → 线缆签名」做成纯函数，client-wire-golden.test.ts
 * 据此生成快照并 diff 冻结 golden；任何方法的 verb/路径/参数键/鉴权/请求体键漂移都会被抓。
 */

import { API_BASE } from '../../../src/shared/api/client-core';

/** 单个方法的线缆签名（只取结构契约，值不入快照以免脆性） */
export interface WireSnapshot {
  /** HTTP 动词 */
  verb: string;
  /** API_BASE 剥离后的路径（不含 query） */
  path: string;
  /** 排序后的 query 参数键集合（仅键名，不含值） */
  params: string[];
  /** 请求体的排序键集合；multipart 为 'FormData'；无体为 null */
  bodyKeys: string[] | 'FormData' | null;
  /** 是否带 Authorization 头 */
  auth: boolean;
  /** GET 合并键（非 GET 为空串）——固化「同 key 合并」契约 */
  dedupe: string;
}

/** 注册表条目：ns 为命名空间键（null 表示基类方法）；args 用工厂以便每次新建 File 等 */
export interface RegistryEntry {
  ns: string | null;
  method: string;
  args: () => unknown[];
}

/**
 * 恒不过期 JWT：header.payload.sig 三段，core.setToken 只解析 payload(index 1)。
 * payload.exp = 9999999999（秒）→ ~公元 2286 年，getToken 不会判过期。
 */
export const FAR_FUTURE_JWT = `h.${btoa(JSON.stringify({ exp: 9999999999 }))}.s`;

const NO_ARGS = () => [];

/**
 * 当前 apiClient 全量业务方法注册表（99 = 25 基类 + 74 命名空间）。
 *
 * 与 tests/api/__golden__/pre536-business-methods.json 的 99 个 pre-#536 方法
 * 一一对应（命名空间方法在迁移中被重命名，故按「域 + 语义」对应，非按名）。
 */
export const REGISTRY: RegistryEntry[] = [
  // ── 基类保留（25）：会话生命周期 + 核心查询 + 未建域残渣 ──
  { ns: null, method: 'login', args: () => ['u', 'p'] },
  { ns: null, method: 'getCurrentUser', args: NO_ARGS },
  { ns: null, method: 'logout', args: NO_ARGS },
  { ns: null, method: 'getKpi', args: NO_ARGS },
  { ns: null, method: 'getKpiDetail', args: NO_ARGS },
  { ns: null, method: 'getTrend', args: NO_ARGS },
  { ns: null, method: 'getQualityBusinessTrend', args: NO_ARGS },
  { ns: null, method: 'getTruckAnalysis', args: NO_ARGS },
  { ns: null, method: 'getGrowthAnalysis', args: () => ['s', 'e', 'bs', 'be'] },
  { ns: null, method: 'getCostAnalysis', args: NO_ARGS },
  { ns: null, method: 'getComprehensiveBundle', args: NO_ARGS },
  { ns: null, method: 'getSalesmanRanking', args: NO_ARGS },
  { ns: null, method: 'getDashboardBundle', args: NO_ARGS },
  { ns: null, method: 'getMarketingReport', args: NO_ARGS },
  { ns: null, method: 'getHolidayDrilldown', args: NO_ARGS },
  { ns: null, method: 'getPremiumReport', args: NO_ARGS },
  { ns: null, method: 'getPremiumPlan', args: NO_ARGS },
  { ns: null, method: 'getPlanAchievement', args: NO_ARGS },
  { ns: null, method: 'getFilterOptions', args: NO_ARGS },
  { ns: null, method: 'getPatrolReport', args: () => ['cost'] },
  { ns: null, method: 'getPatrolNarrative', args: () => ['cost'] },
  { ns: null, method: 'getExpenseRatioDev', args: NO_ARGS },
  { ns: null, method: 'getPolicyGeoProvince', args: NO_ARGS },
  { ns: null, method: 'getPolicyGeoCity', args: NO_ARGS },
  { ns: null, method: 'getRenewalTracker', args: () => [{}] },

  // ── quoteConversion（7）──
  { ns: 'quoteConversion', method: 'kpi', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'funnel', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'drilldown', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'heatmap', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'price', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'trend', args: NO_ARGS },
  { ns: 'quoteConversion', method: 'ranking', args: NO_ARGS },

  // ── claimsDetail（11）──
  { ns: 'claimsDetail', method: 'pendingOverview', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'pendingByOrg', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'pendingAging', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'causeAnalysis', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'geoAccident', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'geoPlate', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'geoComparison', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'claimCycle', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'frequencyYoy', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'lossRatioDev', args: NO_ARGS },
  { ns: 'claimsDetail', method: 'heatmap', args: NO_ARGS },

  // ── repair（12）──
  { ns: 'repair', method: 'overview', args: NO_ARGS },
  { ns: 'repair', method: 'detail', args: NO_ARGS },
  { ns: 'repair', method: 'status', args: NO_ARGS },
  { ns: 'repair', method: 'metadata', args: NO_ARGS },
  { ns: 'repair', method: 'city', args: NO_ARGS },
  { ns: 'repair', method: 'channel', args: NO_ARGS },
  { ns: 'repair', method: 'coopTier', args: NO_ARGS },
  { ns: 'repair', method: 'scatter', args: NO_ARGS },
  { ns: 'repair', method: 'localResource', args: NO_ARGS },
  { ns: 'repair', method: 'toPremium', args: NO_ARGS },
  { ns: 'repair', method: 'diversionList', args: NO_ARGS },
  { ns: 'repair', method: 'orphanShops', args: NO_ARGS },

  // ── crossSell（7）──
  { ns: 'crossSell', method: 'analysis', args: () => [{}] },
  { ns: 'crossSell', method: 'timePeriod', args: NO_ARGS },
  { ns: 'crossSell', method: 'trend', args: NO_ARGS },
  { ns: 'crossSell', method: 'topSalesman', args: NO_ARGS },
  { ns: 'crossSell', method: 'bundle', args: () => [{}] },
  { ns: 'crossSell', method: 'orgTrend', args: NO_ARGS },
  { ns: 'crossSell', method: 'heatmap', args: NO_ARGS },

  // ── performance（6）──
  { ns: 'performance', method: 'summary', args: NO_ARGS },
  { ns: 'performance', method: 'trend', args: NO_ARGS },
  { ns: 'performance', method: 'drilldown', args: () => [{}] },
  { ns: 'performance', method: 'orgHeatmap', args: NO_ARGS },
  { ns: 'performance', method: 'topSalesman', args: NO_ARGS },
  { ns: 'performance', method: 'bundle', args: () => [{}] },

  // ── customerFlow（5）──
  { ns: 'customerFlow', method: 'summary', args: NO_ARGS },
  { ns: 'customerFlow', method: 'inflow', args: NO_ARGS },
  { ns: 'customerFlow', method: 'outflow', args: NO_ARGS },
  { ns: 'customerFlow', method: 'trend', args: NO_ARGS },
  { ns: 'customerFlow', method: 'metadata', args: NO_ARGS },

  // ── ai（4）──
  { ns: 'ai', method: 'analyzeTrend', args: () => [{ rows: [], org: 'x', coverage: 'y' }] },
  { ns: 'ai', method: 'detectRequirement', args: () => [{ message: 'm' }] },
  { ns: 'ai', method: 'capabilities', args: NO_ARGS },
  { ns: 'ai', method: 'quickSuggestions', args: NO_ARGS },

  // ── data（5）──
  { ns: 'data', method: 'files', args: NO_ARGS },
  { ns: 'data', method: 'load', args: () => ['f.parquet'] },
  { ns: 'data', method: 'upload', args: () => [new File(['x'], 'f.parquet')] },
  { ns: 'data', method: 'remove', args: () => ['f.parquet'] },
  { ns: 'data', method: 'version', args: NO_ARGS },

  // ── workflows（5）──
  { ns: 'workflows', method: 'run', args: () => ['r1'] },
  { ns: 'workflows', method: 'audit', args: () => ['r1'] },
  { ns: 'workflows', method: 'approve', args: () => ['r1'] },
  { ns: 'workflows', method: 'reject', args: () => ['r1'] },
  { ns: 'workflows', method: 'runsHealth', args: NO_ARGS },

  // ── auth（12）──
  { ns: 'auth', method: 'listUsers', args: NO_ARGS },
  { ns: 'auth', method: 'createUser', args: () => [{}] },
  { ns: 'auth', method: 'updateUser', args: () => ['id', {}] },
  { ns: 'auth', method: 'deleteUser', args: () => ['id'] },
  { ns: 'auth', method: 'listMyTokens', args: NO_ARGS },
  { ns: 'auth', method: 'createMyToken', args: () => [{}] },
  { ns: 'auth', method: 'revokeMyToken', args: () => ['t'] },
  { ns: 'auth', method: 'listRoles', args: NO_ARGS },
  { ns: 'auth', method: 'createRole', args: () => [{}] },
  { ns: 'auth', method: 'updateRole', args: () => ['r', {}] },
  { ns: 'auth', method: 'deleteRole', args: () => ['r'] },
  { ns: 'auth', method: 'getWeComConfig', args: NO_ARGS },
];

/** 把一次 fetch(url, options) 归一化成稳定线缆签名 */
export function serializeCall(url: string, options: RequestInit = {}): WireSnapshot {
  const u = new URL(url);
  const base = new URL(API_BASE);
  let pathname = u.pathname;
  if (pathname.startsWith(base.pathname)) {
    pathname = pathname.slice(base.pathname.length) || '/';
  }

  const verb = (options.method || 'GET').toUpperCase();

  const params = [...new Set(u.searchParams.keys())].sort();
  const sortedQuery = params.length
    ? '?' +
      params
        .map((k) =>
          u.searchParams
            .getAll(k)
            .sort()
            .map((v) => `${k}=${v}`)
            .join('&')
        )
        .join('&')
    : '';

  const headers = (options.headers || {}) as Record<string, string>;
  const auth = Boolean(headers.Authorization || headers.authorization);

  let bodyKeys: string[] | 'FormData' | null = null;
  const body = options.body;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    bodyKeys = 'FormData';
  } else if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      bodyKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed).sort() : null;
    } catch {
      bodyKeys = null;
    }
  }

  const dedupe = verb === 'GET' ? `GET:${pathname}${sortedQuery}` : '';

  return { verb, path: pathname, params, bodyKeys, auth, dedupe };
}
