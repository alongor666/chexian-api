/**
 * merge_parquet.py 命令行参数构造纯函数（从 daily.mjs runStrategyMultiMerge 抽出，可单测）。
 *
 * 背景（Bug 1）：runStrategyMultiMerge 是 daily.mjs 顶层独立函数，原先内联引用了仅定义在
 * 调用方 runStandardDomain 作用域内的 `BRANCH_CODE` → `ReferenceError: BRANCH_CODE is not
 * defined`，使任何多分片合并域（如 SC repair_resource 39 个 03_维修资源 分片）在 merge 步骤
 * 崩溃，并连带中止 `daily.mjs all` 中其后的域。修法：branchCode 经 ctx 显式透传，args 构造
 * 抽到本纯函数集中省份知识，并锁死 `--declared-branch "<省码>"` 透传契约（daily.mjs 顶层执行
 * main() 无法被 import 单测，同 lib/full-snapshot-cache-key.mjs / shard-classify.mjs 模式）。
 *
 * 引号语义：与 daily.mjs 其余 runPythonScript 调用点一致——每个值用 `"${...}"` 包裹，由
 * runPythonScript 内的 stripArgQuotes 在交给 spawnSync 前剥离（见 lib/arg-quotes.mjs 契约 +
 * governance「spawn 参数引号安全」闸）。本函数只负责拼装，不负责剥离。
 *
 * 无副作用、不读文件系统 / env，可被 vitest 直接 import。
 */

/**
 * 构造 merge_parquet.py 的 dedup 合并参数数组。
 *
 * @param {object}   o
 * @param {string[]} o.mergeInputs    待合并 parquet 路径（裸路径，本函数负责加引号）
 * @param {string}   o.tmpOutput      合并产物临时输出路径
 * @param {string}   o.mergeDedupKey  去重主键列名（trigger.merge_dedup_key）
 * @param {string}   o.mergeOrderBy   dedup 排序表达式（trigger.merge_order_by）
 * @param {string}   [o.branchCode='SC']  当前运行省份码；空 / undefined 归 'SC'（SC 默认链路
 *   也透传 'SC'，使 merge_parquet 的 strictNonNull+assertDeclaredBranch 在 SC 链路同样守卫）
 * @returns {string[]} 透传给 runPythonScript 的参数数组（值已带外层双引号）
 */
export function buildMergeParquetArgs({ mergeInputs, tmpOutput, mergeDedupKey, mergeOrderBy, branchCode = 'SC' }) {
  if (!Array.isArray(mergeInputs) || mergeInputs.length === 0) {
    throw new Error('buildMergeParquetArgs: mergeInputs 不能为空');
  }
  // 防御（PR #861 review MEDIUM）：dedup-key / order-by 缺失会生成 `"undefined"` 字面量传给
  // merge_parquet.py，_validate_sql_identifier 放行（全字母）→ DuckDB 以 undefined 为列名
  // PARTITION BY，运行期才报错。改为参数构造阶段 fail-fast，定位更早。
  if (!mergeDedupKey || !mergeOrderBy) {
    throw new Error('buildMergeParquetArgs: mergeDedupKey / mergeOrderBy 不能为空（multi_file_merge 域须声明 merge_dedup_key + merge_order_by）');
  }
  const code = branchCode || 'SC';
  return [
    '-i', ...mergeInputs.map(f => `"${f}"`),
    '-o', `"${tmpOutput}"`,
    '--dedup-key', `"${mergeDedupKey}"`,
    '--order-by', `"${mergeOrderBy}"`,
    '--declared-branch', `"${code}"`,
  ];
}
