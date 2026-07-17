/**
 * 黄金基线端点排除语义（纯函数层，供 scripts/golden-baseline.mjs 与 vitest 共用）。
 *
 * 背景（2026-07-17 评审 P1）：--compare 读的是**旧 manifest**，历史实现只排除
 * 「当前定义中标记 deprecated/volatile 的 slug」。两个坑：
 *   1. 端点定义被整行删除后，旧 manifest 里的该 slug 不在任何排除集合 → compare
 *      仍去抓取，若端点行为已变（如 admin 访问 auth-users 收口后恒 403）→ 整轮基线红，
 *      必须依赖用户先重新 --build 覆盖 oracle 才能用（等于丢了 oracle）。
 *   2. 直接删定义还会让高敏感端点从基线中永久消失，dry-run 不再可审计。
 *
 * 语义（本模块固化）：
 *   - deprecated / volatile：沿用既有含义，不纳入 oracle；
 *   - skipped（新增，值为非空原因字符串）：端点**保留在定义清单**（dry-run 可审计、
 *     原因可追溯），但 --build 不抓取、--compare 跳过——无论旧 manifest 是否还含该 slug；
 *   - orphaned（旧 manifest 有、当前定义已无的 slug）：**警告跳过而非失败**——
 *     定义删除是显式意图，不应让旧 manifest 把 compare 整轮拖红；警告提示重新 --build 收敛。
 */

/** 端点是否被排除出 oracle（不抓取、不对比） */
export function isExcludedFromOracle(ep) {
  return Boolean(ep.deprecated || ep.volatile || ep.skipped);
}

/**
 * 由当前定义 + 旧 manifest 计算本轮可对比端点。
 * @param {Array<{slug:string,deprecated?:boolean,volatile?:boolean,skipped?:string}>} definitions 当前 ENDPOINT_DEFINITIONS
 * @param {Array<{slug:string,deprecated?:boolean}>} manifestEndpoints 旧 manifest 的 endpoints
 * @returns {{comparable: any[], excluded: string[], orphaned: string[]}}
 *   comparable=参与对比的 manifest 条目；excluded=被当前定义排除的 slug（deprecated/volatile/skipped
 *   或 manifest 自带 deprecated）；orphaned=定义中已消失的 slug（警告跳过）
 */
export function resolveComparableEndpoints(definitions, manifestEndpoints) {
  const excludedSlugs = new Set(definitions.filter(isExcludedFromOracle).map((e) => e.slug));
  const knownSlugs = new Set(definitions.map((e) => e.slug));
  const comparable = [];
  const excluded = [];
  const orphaned = [];
  for (const ep of manifestEndpoints) {
    if (ep.deprecated || excludedSlugs.has(ep.slug)) {
      excluded.push(ep.slug);
    } else if (!knownSlugs.has(ep.slug)) {
      orphaned.push(ep.slug);
    } else {
      comparable.push(ep);
    }
  }
  return { comparable, excluded, orphaned };
}
