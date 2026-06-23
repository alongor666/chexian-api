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
 * 多省 Phase B B2 gated 写侧开关：是否启用 `current/<省>/` 子目录布局。
 *
 * **专用开关 `POLICY_CURRENT_SUBDIR_LAYOUT`**（codex 闸-1 P0-3：不复用 `BRANCH_RLS_ENABLED`——后者是
 * 服务端 RLS 安全开关，绑定 ETL 写布局会让开 RLS 意外触发 SC 物理迁移）。默认 off → SC 落顶层扁平
 * `current/`（现状，字节安全）；on → SC 落 `current/SC/`（子目录隔离）。
 *
 * ⚠️ 开启后 ETL 会**写子目录但不自动清顶层扁平**（B2 不做物理迁移 flat-clear，留 cutover SOP，
 * 带 dry-run/备份/回滚）；顶层与子目录并存会被 B1 装载层互斥闸 + overlap 闸 fail-closed 拦下，
 * 且 daily.mjs 在此布局下强制 `--no-sync`（防 rsync 推子目录到生产，B3 sync 退役前）。
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {boolean}
 */
export function isPolicyCurrentSubdirLayout(env = process.env) {
  return env.POLICY_CURRENT_SUBDIR_LAYOUT === 'true';
}

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
export function branchOutputRoot(warehouseRoot, branchCode, { subdirLayout = isPolicyCurrentSubdirLayout() } = {}) {
  if (!branchCode || branchCode === 'SC') {
    const current = join(warehouseRoot, 'fact', 'policy', 'current');
    // B2 gated 写侧：subdirLayout 开启 → SC 落 current/SC/（子目录隔离）；默认 current/（扁平，现状）。
    // 默认参数调用时求值 isPolicyCurrentSubdirLayout()，故所有调用点自动一致 gated；测试可显式覆盖。
    return subdirLayout ? join(current, 'SC') : current;
  }
  const out = join(warehouseRoot, 'validation', branchCode);
  if (out.includes(join('policy', 'current'))) {
    throw new Error(
      `[branch-naming] 省份 ${branchCode} 输出根不得落入 policy/current（ADR D5：SX 不进共享 runtime）：${out}`
    );
  }
  return out;
}

/**
 * 转换质量报告路径（多省按分公司隔离）。
 * @param reportBaseDir  质量报告根目录（相对/绝对均可，如 "./数据分析报告"）
 * @param branchCode     CHAR(2)；SC/空＝四川默认链路
 * @returns SC/空＝reportBaseDir/转换质量报告.json（现状，字节安全）；
 *          其余省＝reportBaseDir/<省>/转换质量报告.json（隔离，不覆盖四川报告）
 *
 * 注：此函数只做路径计算，无文件系统副作用，可被 vitest 直接 import。
 * Python 侧（transform.py）按相同逻辑独立实现（无需调用本函数）；两侧保持一致。
 */
export function branchQualityReportPath(reportBaseDir, branchCode) {
  const FILENAME = '转换质量报告.json';
  if (!branchCode || branchCode === 'SC') {
    return join(reportBaseDir, FILENAME);
  }
  return join(reportBaseDir, branchCode, FILENAME);
}
