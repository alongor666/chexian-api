/**
 * claims 源文件拼接顺序 — 纯函数，可单测
 *
 * 背景（BACKLOG 2026-06-11-claude-9ba379）：runClaimsDetail 把「新命名全量/增量文件」
 * (newFiles) 与「legacy 车险报立结案清单_*.xlsx」(legacyFiles) 拼成 sourceFiles 数组，
 * 按序传给 convert_claims_detail.py `-i file1 file2 ...`。该脚本 `pd.concat(frames)` 保序
 * 后 `drop_duplicates(subset=['赔案号'], keep='last')`——数组里排在**后面**的文件，其同赔案号
 * 行会覆盖排在前面的。
 *
 * 原代码 `[...newFiles, ...legacyFiles]` 把 legacy 文件恒定排在最后，于是同一赔案号若
 * 同时出现在 newFiles（当日最新全量）与 legacyFiles（历史遗留快照）中，**旧快照覆盖新全量**，
 * 与"存量更新铁律"（喂最新全量才能刷新已决/未决金额）直接相悖。
 *
 * 且 legacyFiles 文件名（车险报立结案清单_*.xlsx）不含 8 位日期区间前缀，daily.mjs 的自动
 * 归档护栏（matchFull 正则要求 8 位日期）无法识别、永远不会被归档，只要还在源目录里就会
 * 一直参与 concat 并持续覆盖新全量。
 *
 * 修复：newFiles（新命名，代表当日最新全量口径）恒排最后，legacyFiles（旧格式遗留快照）
 * 恒排最前 —— 保证"最新全量"在 concat 后处于数组尾部，keep='last' 去重时新全量胜出。
 * 对现状最小侵入：不改变每组内部已有的字典序排序，只调换两组顺序。
 *
 * 无副作用，可被 vitest 直接 import。
 */

/**
 * 拼接 claims 源文件列表，确保「新命名文件」(newFiles) 恒排在「legacy 遗留文件」
 * (legacyFiles) 之后 —— 使 `drop_duplicates(keep='last')` 时最新全量覆盖旧快照，
 * 而不是被旧快照覆盖。
 *
 * @param {Array<{name:string,path:string}>} newFiles 新命名全量/增量文件（已按名排序）
 * @param {Array<{name:string,path:string}>} legacyFiles legacy 车险报立结案清单_*.xlsx（已按名排序）
 * @returns {Array<{name:string,path:string}>} 拼接后的顺序，legacy 在前、new 在后
 */
export function orderClaimsSourceFiles(newFiles, legacyFiles) {
  return [...(legacyFiles ?? []), ...(newFiles ?? [])];
}
