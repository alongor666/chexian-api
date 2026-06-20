/**
 * 立方体影子对账（通用可加性立方体 · 灰度安全网）
 *
 * CUBE_SHADOW_COMPARE=true 时：路由对外仍返回原路径结果，同时后台跑立方体
 * 查询并逐行逐字段比对，结果只进日志与计数器 —— 连续观察零差异后才
 * 切 CUBE_ROUTING_ENABLED=true。对应设计文档 §4 阶段 1 的"影子对账"。
 */

export interface ShadowStats {
  match: number;
  mismatch: number;
  error: number;
  lastMismatchDetail: string | null;
}

/**
 * 脱敏差异摘要：保留行号/字段名/值的"形状"（日期与短枚举可见），
 * 业务数值打码 —— 供 /health 公开端点暴露做远程诊断（完整明细仍在 PM2 日志）。
 */
export function redactMismatchDetail(detail: string | null): string | null {
  if (detail === null) return null;
  // 把"长得像业务数值"的片段打码：含小数点或 ≥5 位的整数；
  // 保留日期（YYYY-MM-DD 不匹配该模式因含连字符分隔后每段 ≤4 位）与行号/短计数
  return detail.replace(/\d{5,}(\.\d+)?|\d+\.\d+/g, '#');
}

const statsByRoute = new Map<string, ShadowStats>();

export function getShadowStats(): Record<string, ShadowStats> {
  return Object.fromEntries(statsByRoute);
}

/** @internal 测试用 */
export function resetShadowStatsForTest(): void {
  statsByRoute.clear();
}

function statsFor(route: string): ShadowStats {
  let s = statsByRoute.get(route);
  if (!s) {
    s = { match: 0, mismatch: 0, error: 0, lastMismatchDetail: null };
    statsByRoute.set(route, s);
  }
  return s;
}

/** 数值容差比较（DuckDB 浮点聚合在不同执行计划下的求和顺序差异） */
const NUMERIC_TOLERANCE = 1e-9;

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    const scale = Math.max(1, Math.abs(na), Math.abs(nb));
    return Math.abs(na - nb) / scale < NUMERIC_TOLERANCE;
  }
  return String(a) === String(b);
}

/**
 * 比对两个结果集（行序应一致：两条 SQL 同 ORDER BY）。
 * 返回 null 表示一致，否则返回首个差异描述。
 */
export function diffRows(
  legacyRows: Array<Record<string, unknown>>,
  cubeRows: Array<Record<string, unknown>>
): string | null {
  if (legacyRows.length !== cubeRows.length) {
    return `行数不一致: legacy=${legacyRows.length} cube=${cubeRows.length}`;
  }
  for (let i = 0; i < legacyRows.length; i++) {
    const a = legacyRows[i];
    const b = cubeRows[i];
    for (const key of Object.keys(a)) {
      if (!valuesEqual(a[key], b[key])) {
        return `行 ${i} 字段 ${key}: legacy=${String(a[key])} cube=${String(b[key])}`;
      }
    }
  }
  return null;
}

/**
 * 后台影子对账（fire-and-forget，不影响请求时延与结果）。
 * @param route       - 路由标识（统计分组）
 * @param legacyRows  - 已返回给前端的原路径结果
 * @param runCubeQuery - 立方体查询执行闭包
 */
export function runShadowCompare(
  route: string,
  legacyRows: Array<Record<string, unknown>>,
  runCubeQuery: () => Promise<Array<Record<string, unknown>>>
): void {
  void runCubeQuery()
    .then((cubeRows) => {
      const s = statsFor(route);
      const diff = diffRows(legacyRows, cubeRows);
      if (diff === null) {
        s.match++;
      } else {
        s.mismatch++;
        s.lastMismatchDetail = diff;
        console.error(`[CubeShadow] ❌ MISMATCH route=${route}: ${diff}`);
      }
      // 周期性输出累计（每 50 次比对一行，避免刷屏）
      if ((s.match + s.mismatch) % 50 === 1) {
        console.log(`[CubeShadow] route=${route} match=${s.match} mismatch=${s.mismatch} error=${s.error}`);
      }
    })
    .catch((err: unknown) => {
      const s = statsFor(route);
      s.error++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CubeShadow] 影子查询执行失败 route=${route}: ${message}`);
    });
}

/**
 * 切流后采样影子（R3 缺口闭环，BACKLOG bf2c4e）。
 *
 * 切流后该路由对外直返 cube 结果、影子期双跑已停。本函数对【采样命中】的请求
 * 后台 fire-and-forget 跑 legacy，并与已返回前端的 cube 结果对账，计数并入同一
 * statsByRoute（哨兵 / cube-promote 可见，与影子期共用计数器）。
 *
 * 与 runShadowCompare 的方向差异：影子期对外返回 legacy、后台跑 cube；切流后
 * 对外返回 cube、后台跑 legacy。diffRows(legacy, cube) 入参顺序保持一致，
 * match/mismatch 语义不变。
 *
 * @param route          - 路由标识（与影子期共用计数器）
 * @param servedCubeRows - 已返回给前端的立方体结果
 * @param runLegacyQuery - 原路径查询执行闭包
 */
export function runPostCutoverShadowSample(
  route: string,
  servedCubeRows: Array<Record<string, unknown>>,
  runLegacyQuery: () => Promise<Array<Record<string, unknown>>>
): void {
  void runLegacyQuery()
    .then((legacyRows) => {
      const s = statsFor(route);
      const diff = diffRows(legacyRows, servedCubeRows);
      if (diff === null) {
        s.match++;
      } else {
        s.mismatch++;
        s.lastMismatchDetail = diff;
        console.error(`[CubeShadow] ❌ 切流后采样 MISMATCH route=${route}: ${diff}`);
      }
      if ((s.match + s.mismatch) % 50 === 1) {
        console.log(`[CubeShadow] (切流后采样) route=${route} match=${s.match} mismatch=${s.mismatch} error=${s.error}`);
      }
    })
    .catch((err: unknown) => {
      const s = statsFor(route);
      s.error++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CubeShadow] 切流后采样 legacy 查询失败 route=${route}: ${message}`);
    });
}
