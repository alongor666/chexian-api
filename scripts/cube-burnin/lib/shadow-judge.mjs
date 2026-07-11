/**
 * shadow-judge.mjs — 影子对账信号快照 + delta 计算 + 判定
 *
 * 纯函数，无 IO 副作用。可被测试直接 import。
 */

import { SHADOW_KEYS, ACTIVE_SHADOW_KEYS } from '../../shared/cube-routes.mjs';

// ─── 判定常量 ────────────────────────────────────────────────────

export const VERDICT = Object.freeze({
  PASS:         'PASS',
  FAIL:         'FAIL',
  WARN:         'WARN',
  INSUFFICIENT: 'INSUFFICIENT',
});

/** re-export 给本 lib 测试用（SSOT 在 scripts/shared/cube-routes.mjs）。
 * 2026-07-11（f1c991）：快照/判定收窄到 ACTIVE_SHADOW_KEYS——cost/kpi 已随 65f495 退役，
 * 永远 match=0，留在判定集会让 burn-in 恒 INSUFFICIENT、切流晋级链结构性卡死。 */
export { SHADOW_KEYS, ACTIVE_SHADOW_KEYS };

// ─── 核心函数 ────────────────────────────────────────────────────

/**
 * 从 /health 完整响应中提取 cubeShadow 快照。
 *
 * 缺字段时兜底为 0，不抛出异常。
 *
 * @param {object} healthResponse - GET /health 完整 JSON 响应体
 * @returns {{ [key: string]: { match: number, mismatch: number, error: number } }}
 */
export function snapshotShadow(healthResponse) {
  const shadow = healthResponse?.cubeShadow ?? {};
  const result = {};
  for (const key of ACTIVE_SHADOW_KEYS) {
    const entry = shadow[key] ?? {};
    result[key] = {
      match:    Number(entry.match    ?? 0),
      mismatch: Number(entry.mismatch ?? 0),
      error:    Number(entry.error    ?? 0),
    };
  }
  return result;
}

/**
 * 计算两次快照之间的 delta。
 *
 * after < before（异常场景）时 delta 记录为负数（上层 judge 不会因此 FAIL，
 * 但会有 INSUFFICIENT 信号），调用方可检查负 delta 发出 warning。
 *
 * @param {ReturnType<typeof snapshotShadow>} before
 * @param {ReturnType<typeof snapshotShadow>} after
 * @returns {{ [key: string]: { match: number, mismatch: number, error: number } }}
 */
export function computeDelta(before, after) {
  const result = {};
  for (const key of ACTIVE_SHADOW_KEYS) {
    const b = before[key] ?? { match: 0, mismatch: 0, error: 0 };
    const a = after[key]  ?? { match: 0, mismatch: 0, error: 0 };
    result[key] = {
      match:    a.match    - b.match,
      mismatch: a.mismatch - b.mismatch,
      error:    a.error    - b.error,
    };
  }
  return result;
}

/**
 * 根据 delta 判定 burn-in 结果。
 *
 * 优先级（高→低）：FAIL > WARN > INSUFFICIENT > PASS
 *
 * 规则：
 *   - 任一路由 mismatch > 0 → FAIL（立方体算错）
 *   - 任一路由 error > 0    → WARN（执行异常，无 FAIL）
 *   - 任一路由 match < minMatch → INSUFFICIENT（流量不足，无 FAIL/WARN）
 *   - 全部满足 match >= minMatch + mismatch=0 + error=0 → PASS
 *
 * @param {ReturnType<typeof computeDelta>} delta
 * @param {{ minMatch?: number }} [options]
 * @returns {{ verdict: string, perRoute: object, summary: string }}
 */
export function judge(delta, { minMatch = 1000 } = {}) {
  const perRoute = {};
  let hasFail  = false;
  let hasWarn  = false;
  let hasInsuf = false;

  for (const key of ACTIVE_SHADOW_KEYS) {
    const d = delta[key] ?? { match: 0, mismatch: 0, error: 0 };
    let routeVerdict = VERDICT.PASS;

    if (d.mismatch > 0) {
      routeVerdict = VERDICT.FAIL;
      hasFail = true;
    } else if (d.error > 0) {
      routeVerdict = VERDICT.WARN;
      hasWarn = true;
    } else if (d.match < minMatch) {
      routeVerdict = VERDICT.INSUFFICIENT;
      hasInsuf = true;
    }

    perRoute[key] = {
      verdict:  routeVerdict,
      match:    d.match,
      mismatch: d.mismatch,
      error:    d.error,
    };
  }

  let verdict;
  if (hasFail)       verdict = VERDICT.FAIL;
  else if (hasWarn)  verdict = VERDICT.WARN;
  else if (hasInsuf) verdict = VERDICT.INSUFFICIENT;
  else               verdict = VERDICT.PASS;

  const lines = ACTIVE_SHADOW_KEYS.map(key => {
    const r = perRoute[key];
    return `  ${key}: ${r.verdict} (match=${r.match}, mismatch=${r.mismatch}, error=${r.error})`;
  });
  const summary = [`verdict=${verdict}`, ...lines].join('\n');

  return { verdict, perRoute, summary };
}
