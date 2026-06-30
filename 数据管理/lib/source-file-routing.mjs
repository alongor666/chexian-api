/**
 * 多省源文件「命名路由」纯函数 — 从文件名拼音前缀派生省份 + 按省防混省过滤
 *
 * 背景：上游 BI 导出的源 xlsx 带省份拼音前缀（sichuan_/shanxi_，如
 * `sichuan_20250601-20260628_05_理赔明细.xlsx`）。daily.mjs 的文件发现 glob、
 * shard-classify 分片判定（^\d{8} 锚定开头）、premium/claims 归档守卫原先只认
 * 无前缀命名，带前缀文件会失配 → 静默跳过或 getShardType 返回 null → ETL
 * process.exit(1) 中止。本模块把「拼音前缀↔branch_code」与「按省过滤」抽成无副作用
 * 纯函数，集中省份前缀知识，避免散落到 daily.mjs / shard-classify 多处。
 *
 * ⚠️ 省份合法集的唯一事实源 = server/src/config/field-registry/fields.json 的
 * branch_code.derivation.mapping（610→SC / 618→SX）。本文件的
 * PROVINCE_FILENAME_PREFIX_TO_CODE 是「文件名拼音前缀→branch_code」补充映射
 * （拼音不在 fields.json 里），其 VALUE 必须 ⊆ 上述 mapping 的 values。新增省份须
 * 双向同步；一致性由 governance「省份前缀映射一致」静态对比闸强制（B2 接入）。
 *
 * 设计与 ADR D5（branch-naming.mjs）共存：staging 目录 + BRANCH_CODE env 负责
 * 「省份物理目录路由」；本模块负责「同目录多省文件混放时的防污」与「发现带前缀新命名」
 * 两个独立问题，不替代也不破坏 staging+env 机制。
 *
 * 无副作用、不读文件系统 / env，可被 vitest 直接 import。
 */

// 文件名拼音前缀 → branch_code（CHAR(2)）。须与 fields.json branch_code.derivation.mapping
// 的 values 同步（610→SC / 618→SX）。新增省份在此加一条 `拼音: 码`。
export const PROVINCE_FILENAME_PREFIX_TO_CODE = Object.freeze({
  sichuan: 'SC',
  shanxi: 'SX',
});

// ^<拼音>_ 前缀正则（大小写不敏感，防上游命名 Sichuan_/SICHUAN_ 漏判 → 混省，闸-1 P1-3）。
const PREFIX_RE = new RegExp(
  '^(' + Object.keys(PROVINCE_FILENAME_PREFIX_TO_CODE).join('|') + ')_',
  'i',
);

/**
 * 从文件名前缀派生 branch_code。
 * 无已知省前缀（数字开头 / 每日数据_ / 01_ / 02_ / 05_ 等合法无省命名）→ null
 * （归当前运行省，向后兼容旧无前缀命名）。未知字母前缀（如 foo_）也返回 null，但此类
 * 文件不在 buildBranchAwareGlobs 生成的 glob 内，天然不会被发现，无需额外 fail-closed。
 * @param {string} name 文件名（basename）
 * @returns {'SC'|'SX'|null}
 */
export function provinceCodeFromFilename(name) {
  if (typeof name !== 'string') return null;
  const m = name.match(PREFIX_RE);
  if (!m) return null;
  return PROVINCE_FILENAME_PREFIX_TO_CODE[m[1].toLowerCase()] ?? null;
}

/**
 * 剥离已知省前缀，返回 core 文件名（无前缀则原样返回；幂等）。
 * 供 shard-classify 的 extractDateRange / getShardType 在入口复用，使带前缀文件能走
 * 原有「^日期」日期解析与分片判定逻辑（闸-1 P0-2：否则 getShardType 返回 null →
 * unrecognized → ETL process.exit(1)）。
 * @param {string} name
 * @returns {string}
 */
export function stripProvincePrefix(name) {
  if (typeof name !== 'string') return name;
  return name.replace(PREFIX_RE, '');
}

/**
 * 文件是否属于指定运行省（防混省过滤，闸-1 P0-1）：前缀省 == 运行省，或无前缀
 * （归当前省，向后兼容）。必须在 daily.mjs 的「源文件收集完毕之后、传入 getShardType /
 * 归档逻辑之前」插入此过滤，否则带前缀的他省文件若误放本省 sourceDir，会被 ETL 消化、
 * 由 transform.py 按 policy_no 前缀派生出他省 branch_code 行混入本省 current/ →
 * RLS 静默泄漏。
 * @param {string} name
 * @param {string} branchCode 当前运行省；'' / undefined / 'SC' 均归四川（对称处理，闸-1 P1-4）
 * @returns {boolean}
 */
export function fileBelongsToBranch(name, branchCode) {
  const code = branchCode || 'SC';
  const p = provinceCodeFromFilename(name);
  return p === null || p === code;
}

/**
 * 把「无前缀 glob」扩展为「无前缀 + 各已知省前缀」glob 列表，使 daily.mjs 既能发现
 * 旧无前缀文件，也能发现带 sichuan_/shanxi_ 前缀的新文件。省份枚举来自
 * PROVINCE_FILENAME_PREFIX_TO_CODE keys（数据驱动，加省自动扩展，禁硬编码省数组）。
 *
 * 幂等守卫（PR #861 review HIGH）：若传入 glob 自身已含已知省前缀（如调用方在
 * data-sources.json 里显式声明了 `sichuan_*` glob），不再二次扩展 —— 否则会生成
 * `sichuan_sichuan_*` 这类匹配不到任何文件的无意义 glob，污染发现日志、增加排查难度。
 * 当前所有声明 glob 均无省前缀，故对现状是 no-op；本守卫是面向未来声明的防御。
 * @param {string} coreGlobNoPrefix 无前缀 glob，如 '????????-????????_01_签单清单*.xlsx'
 * @returns {string[]}
 */
export function buildBranchAwareGlobs(coreGlobNoPrefix) {
  if (PREFIX_RE.test(coreGlobNoPrefix)) return [coreGlobNoPrefix];
  return [
    coreGlobNoPrefix,
    ...Object.keys(PROVINCE_FILENAME_PREFIX_TO_CODE).map((p) => `${p}_${coreGlobNoPrefix}`),
  ];
}

/** 已注册 branch_code 集合（拼音 map values 去重），供校验 / 遍历用。 */
export function registeredBranchCodesFromPrefixMap() {
  return [...new Set(Object.values(PROVINCE_FILENAME_PREFIX_TO_CODE))];
}

/**
 * 「省前缀感知」的源文件收集 + 防混省过滤（Bug 2 修复，daily.mjs collectSourceFiles 的纯内核）。
 *
 * 背景：daily.mjs 标准域（repair_resource / brand 等走 multi_file_merge / single 策略的域）原先
 * 用原始 `trigger.input_globs` 直接 ls()，未经 buildBranchAwareGlobs 省前缀扩展（不像
 * runClaimsDetail / premium 那样显式扩展）。结果带 `sichuan_`/`shanxi_` 前缀的新命名文件
 * （如 `sichuan_20250601-20260628_03_维修资源.xlsx`）匹配不上 `????????-????????_03_维修资源*.xlsx`，
 * 被静默漏掉 —— repair 域既漏 SC 新文件也漏 SX 新文件（SX repair 直接报"未找到源"跳过）。
 *
 * 本函数把每个声明 glob 经 buildBranchAwareGlobs 扩展为「无前缀 + 各省前缀」三态后 ls()，
 * 再按 fileBelongsToBranch(name, branchCode) 过滤防混省（与 runClaimsDetail / premium 一致）。
 * lsFn 注入便于单测（daily.mjs 的 ls 触碰文件系统；本函数仅编排，纯逻辑可被 vitest 验证）。
 *
 * 返回结构与原 collectSourceFiles 保持一致：`{ groups, all }`，groups[i].glob 保留**未扩展的
 * 声明 glob**（供 full_batch 错误信息回显声明口径），groups[i].files 为该声明 glob 命中且属本省
 * 的文件（跨 glob 按 path 去重）。
 *
 * @param {string[]} inputGlobs  声明的核心 glob 列表（无前缀，如 ['07_维修资源*.xlsx', ...]）
 * @param {string}   scriptDir   源文件搜索根目录
 * @param {string}   branchCode  当前运行省份码；'' / undefined / 'SC' 均归四川
 * @param {(pattern: string, dir: string) => Array<{name: string, path: string}>} lsFn  目录列举函数
 * @returns {{ groups: Array<{glob: string, files: Array<{name: string, path: string}>}>, all: Array<{name: string, path: string}> }}
 */
export function collectBranchAwareFiles(inputGlobs, scriptDir, branchCode, lsFn) {
  const seen = new Set();
  const groups = inputGlobs.map((glob) => ({
    glob,
    files: buildBranchAwareGlobs(glob)
      .flatMap((g) => lsFn(g, scriptDir))
      .filter((f) => {
        if (seen.has(f.path)) return false;
        seen.add(f.path);
        // 防混省：他省前缀文件若误放本省源根，必须在传入归档 / 转换前剔除，否则会被 ETL
        // 消化、由 transform.py 按 policy_no 前缀派生出他省 branch_code 行混入本省产物。
        return fileBelongsToBranch(f.name, branchCode);
      }),
  }));
  return { groups, all: groups.flatMap((g) => g.files) };
}
