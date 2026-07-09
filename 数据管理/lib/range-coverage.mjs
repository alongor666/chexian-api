/**
 * 区间覆盖归档纯函数 — 被新全量日期区间完全包含的旧文件归档（防 ETL concat 双倍）
 *
 * 背景：daily.mjs 多处「归档被覆盖旧文件」防双倍逻辑原仅按「同 start 留 end 最新」，
 * 漏了跨 start 的窗口增量被全量区间覆盖（如 20260614-20260625 被 20250601-20260628 覆盖）。
 * 本模块抽「区间覆盖 + 同品类互斥」判定为纯函数，统一 premium xlsx / claims / premium parquet 三处。
 *
 * 关键护栏（闸-1 B3 审查）：
 * - **同区间不同品类禁互相归档**（剔摩 `_剔摩` vs 限摩 `_限摩` 多文件共存，同 [start,end] 不同
 *   qualifier）→ 防误归档合法多文件致数据丢失（B3-01，最严重）
 * - **start>end 畸形区间 → 返回 null**（防 isRangeCovered 产出不可预期结论 B3-03）
 * - **调用方须先过滤 null**，不构造条目（否则 null 端点参与比较抛错 B3-04）
 * - 历史不重叠分段（start 各异、互不包含）→ 都保留
 *
 * 无副作用，可被 vitest 直接 import。
 */
import { stripProvincePrefix } from './source-file-routing.mjs';

// 范围前缀 + 日期段后的「品类标识」：YYYYMMDD-YYYYMMDD_<qualifier>
// qualifier = 区分剔摩/限摩/定稿等内容拆分的关键（同区间不同 qualifier 不互斥）。
const RANGE_QUALIFIER_RE = /^(\d{8})-(\d{8})_(.+)$/;

/**
 * 解析文件名的日期区间 + 品类标识（先剥离 sichuan_/shanxi_ 省前缀）。
 * @param {string} name
 * @returns {{start:string,end:string,qualifier:string}|null}
 *   非范围命名（legacy 每日数据_ / 无范围前缀如 02_理赔明细_报案时间）→ null；
 *   start>end 畸形 → null（B3-03 防御）。
 */
export function parseRangePrefix(name) {
  if (typeof name !== 'string') return null;
  const m = stripProvincePrefix(name).match(RANGE_QUALIFIER_RE);
  if (!m) return null;
  const [, start, end, rawQualifier] = m;
  if (start > end) return null; // 畸形区间防御（B3-03）：字符串 YYYYMMDD 比较等价数值比较
  // qualifier 去文件扩展名，使 xlsx 源层与 parquet 产物层跨层可比（同内容 .xlsx/.parquet 视为同品类）
  const qualifier = rawQualifier.replace(/\.(xlsx|parquet)$/i, '');
  return { start, end, qualifier };
}

/** inner 日期区间是否被 outer 完全覆盖（含端点相等）。 */
export function isRangeCovered(inner, outer) {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * inner 是否被 outer **同品类**严格覆盖（同 qualifier + 区间被覆盖 + 不是同一文件）。
 * 供 claims / premium parquet 单一 outer 场景使用。
 * @param {{start,end,qualifier}} inner
 * @param {{start,end,qualifier}} outer
 */
export function isCoveredBySameQualifier(inner, outer) {
  return inner.qualifier === outer.qualifier && isRangeCovered(inner, outer);
}

/**
 * 从一组带区间+品类的项中，找出「被同品类其他项区间覆盖」的 key（应归档者）。
 * - 仅 **qualifier 相同** 的文件对才互斥（剔摩/限摩等不同品类多文件共存不互相归档·B3-01）
 * - 同区间同品类：保留 key 字典序最大的一个（新命名带 sichuan_ 前缀字典序大、优先保留），其余 loser
 * - 历史不重叠分段（互不包含）→ 都保留
 * 调用方须先用 parseRangePrefix 过滤 null（不构造条目），否则 null 端点抛错（B3-04）。
 * @param {Array<{key:string,start:string,end:string,qualifier:string}>} items
 * @returns {Set<string>} loser keys（应归档的文件 key）
 */
export function findCoveredKeys(items) {
  const losers = new Set();
  for (const a of items) {
    for (const b of items) {
      if (a.key === b.key) continue;
      if (a.qualifier !== b.qualifier) continue; // 仅同品类互斥（B3-01：剔摩 vs 限摩不互斥）
      if (!isRangeCovered(a, b)) continue;
      const sameRange = a.start === b.start && a.end === b.end;
      if (sameRange) {
        if (b.key > a.key) { losers.add(a.key); break; } // 同区间同品类：留字典序最大
      } else {
        losers.add(a.key); break; // b 严格覆盖 a（跨 start 窗口被全量覆盖亦在此）
      }
    }
  }
  return losers;
}

// 旧格式周更 parquet 命名（下划线分隔日期）：每日数据_20250601_20260707.parquet
// 与 RANGE_QUALIFIER_RE（连字符分隔）不同源，parseRangePrefix 对此类文件名返回 null，
// 故被覆盖判定需要单独实现（2026-07-09 山西数据晋升事故：该判定此前用全局
// shard-config.json 的 weekly_start 硬编码比较起点，实际滚动窗口起点与配置不符，
// 导致同起点旧文件从未被判定为「同起点」，归档从未触发）。
const OLD_WEEKLY_RE = /^每日数据_(\d{8})_(\d{8})\.parquet$/;

/**
 * 找出被本次转换文件完全覆盖（含端点相等）的旧格式周更 parquet（应归档者）。
 * 覆盖判定用本次转换文件的**实际**日期区间，不依赖任何全局配置值——避免配置漂移
 * 导致误判「不同起点」而漏归档（2026-07-09 山西/四川实证：旧逻辑靠 shard-config.json
 * 的 weekly_start 与文件名日期比较，两者早已不一致，归档静默失效数日）。
 * @param {string[]} existingFilenames  currentDir 下现有 .parquet 文件名（含本次输出文件名）
 * @param {{start:string,end:string}} incoming  本次转换文件的实际日期区间
 * @param {string} outputName  本次转换文件的输出文件名（排除自身，防自归档）
 * @returns {string[]} 应归档的旧文件名（保持传入顺序）
 */
export function findSupersededOldWeeklyFiles(existingFilenames, incoming, outputName) {
  const superseded = [];
  for (const f of existingFilenames) {
    if (f === outputName) continue;
    const m = f.match(OLD_WEEKLY_RE);
    if (!m) continue;
    const old = { start: m[1], end: m[2] };
    if (isRangeCovered(old, incoming)) superseded.push(f);
  }
  return superseded;
}

/**
 * 找出「同品类但仅部分重叠——谁都不完全包含谁」的区间对。
 *
 * findCoveredKeys 只处理「一方严格覆盖另一方」的归档场景；上游导出窗口起点前移时
 * （2026-07-06 四川实测：老全量 25-06-01~26-06-28 与新全量 26-06-01~26-07-05——新窗口
 * 起点更晚、终点更晚，谁都不是谁的子集），两份文件会同时留在 current/，重叠区间
 * （26-06-01~26-06-28）被算两次。此函数把这类 pair 挑出来，交给调用方按「不重复不遗漏」
 * 原则合并（保留较早文件重叠前的部分 + 采纳较晚文件全部）。
 *
 * @param {Array<{key:string,start:string,end:string,qualifier:string}>} items
 * @returns {Array<{a:{key,start,end,qualifier}, b:{key,start,end,qualifier}}>}
 *   a.start <= b.start，按 key 去重（同一对不会正反各出现一次）
 */
export function findPartialOverlapPairs(items) {
  const pairs = [];
  const seen = new Set();
  for (const a of items) {
    for (const b of items) {
      if (a.key === b.key) continue;
      if (a.qualifier !== b.qualifier) continue; // 同品类才互斥判定
      if (isRangeCovered(a, b) || isRangeCovered(b, a)) continue; // 完全覆盖交给 findCoveredKeys
      const overlaps = a.start <= b.end && b.start <= a.end;
      if (!overlaps) continue;
      const pairKey = [a.key, b.key].sort().join('|');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      pairs.push(a.start <= b.start ? { a, b } : { a: b, b: a });
    }
  }
  return pairs;
}
