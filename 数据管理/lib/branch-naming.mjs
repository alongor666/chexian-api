/**
 * 多省 ETL 路由纯函数 — 0a：SX 输出隔离，绝不进 current/
 *
 * 设计依据：ADR D5（开发文档/multi-branch/全国多省架构决策_2026-06-19.md）
 *   - current/ 在 0a 期保持 SC-only；服务端本地优先加载 current/（server/src/config/paths.ts）。
 *   - SX premium ETL 产物只落隔离目录 warehouse/validation/<省>，不进共享 runtime、不 sync VPS。
 *   - 省份身份来自 BRANCH_CODE env（列注入）+ staging 目录，不靠文件名前缀 → shard-classify 无需改。
 *
 * 无副作用、不触碰文件系统/子进程，可被 vitest 直接 import。
 */
import { join } from 'node:path';

/**
 * 当前省的源 staging 目录。
 * @param scriptDir daily.mjs 所在根目录（数据管理/）
 * @param branchCode CHAR(2)；SC/空＝四川（现状，读脚本根）；其余＝staging/<省>/
 */
export function branchSourceDir(scriptDir, branchCode) {
  return (!branchCode || branchCode === 'SC') ? scriptDir : join(scriptDir, 'staging', branchCode);
}

/**
 * 当前省 premium ETL 的输出根目录。
 * @param warehouseRoot 数据管理/warehouse 根
 * @param branchCode CHAR(2)
 * @returns SC/空＝warehouse/fact/policy/current（现状，进共享 runtime）；
 *          其余省＝warehouse/validation/<省>（隔离，0a 期绝不进 current/）
 * @throws 非 SC 省的输出根若落入 policy/current（如 warehouseRoot 被误传成 current 目录）→ 抛错，
 *         防 ADR D5「SX 不进共享 runtime」回归。
 */
export function branchOutputRoot(warehouseRoot, branchCode) {
  if (!branchCode || branchCode === 'SC') {
    return join(warehouseRoot, 'fact', 'policy', 'current');
  }
  const out = join(warehouseRoot, 'validation', branchCode);
  if (out.includes(join('policy', 'current'))) {
    throw new Error(
      `[branch-naming] 省份 ${branchCode} 输出根不得落入 policy/current（ADR D5：SX 不进共享 runtime）：${out}`
    );
  }
  return out;
}
