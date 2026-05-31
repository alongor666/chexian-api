/**
 * 分片判定纯函数 — 从 daily.mjs 抽出以便单测
 *
 * 这些函数无副作用、不触碰文件系统/子进程，因此可被 vitest 直接 import
 * （daily.mjs 顶层会执行 main()，无法直接 import 测试其内部函数）。
 *
 * - formatDate(d)         今天的 YYYYMMDD（可注入日期，便于测试 openEnd 分支）
 * - extractDateRange(name, today)  从文件名提取 { start, end }
 * - getShardType(name, config)     判定 static / weekly / daily
 */

/** 返回 YYYYMMDD（默认今天，可注入 Date 便于测试） */
export function formatDate(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 从文件名提取日期范围，支持下划线和连字符 */
export function extractDateRange(filename, today = formatDate()) {
  // 新前缀格式（2026-04-26 起）：20260426_01_签单清单.xlsx → single-day（归入 weekly 处理）
  const newPrefix = filename.match(/^(\d{8})_\d{2}_/);
  if (newPrefix) {
    return { start: newPrefix[1], end: newPrefix[1] };
  }
  // 新格式：01_签单清单_21-23年.xlsx → { start: '20210101', end: '20231231' }
  const newFmt = filename.match(/(\d{2})-(\d{2})年/);
  if (newFmt) {
    return { start: `20${newFmt[1]}0101`, end: `20${newFmt[2]}1231` };
  }
  // 开放结束格式：01_签单清单_剔摩_24年至.xlsx → { start: '20240101', end: 今天 }
  const openEnd = filename.match(/(\d{2})年至/);
  if (openEnd) {
    return { start: `20${openEnd[1]}0101`, end: today };
  }
  // 增量格式：01_签单清单_增量_20260411.xlsx → single-day（归入 weekly 处理）
  const incr = filename.match(/增量_(\d{8})/);
  if (incr) {
    return { start: incr[1], end: incr[1] };
  }
  // 显式日期范围格式（无中文锚点）：01_签单清单_剔摩_20240101_20260504.xlsx
  // 上游 2026-05-05 起改用此格式替代「24年至YYYYMMDD」
  const explicitRange = filename.match(/_(\d{8})_(\d{8})\.xlsx?$/i);
  if (explicitRange) {
    return { start: explicitRange[1], end: explicitRange[2] };
  }
  // 旧格式：每日数据_20240101_20260407.xlsx
  const m = filename.match(/每日数据_(\d{8})[_-](\d{8})/);
  return m ? { start: m[1], end: m[2] } : null;
}

/** 判断分片类型：static / weekly / daily，无法识别返回 null */
export function getShardType(filename, config) {
  const range = extractDateRange(filename);
  if (!range) return null;
  // 增量文件 / 新前缀单日文件 强制归入 weekly（以新格式处理，输出到 current/）
  if (filename.match(/增量_\d{8}/) || filename.match(/^\d{8}_\d{2}_/)) return 'weekly';

  const cutoff = parseInt(config.static_cutoff.replace(/-/g, ''));
  const weeklyStart = config.weekly_start.replace(/-/g, '');

  if (parseInt(range.end) <= cutoff) return 'static';
  if (range.start === weeklyStart) return 'weekly';
  return 'daily';
}
