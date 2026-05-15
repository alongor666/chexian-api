/**
 * policy/current Parquet 时间范围重叠门禁（共享纯函数）
 *
 * 三处引用：scripts/check-governance.mjs、scripts/sync-vps.mjs、数据管理/daily.mjs
 * 任意一处变更逻辑都会污染另外两处，故抽到此模块。
 *
 * 互补豁免：剔摩（非摩托）+ 限摩（仅摩托）按险类切分，时间重叠不构成数据翻倍；
 * 单独存在的限摩（无配对剔摩）= 反模式，必须报错。
 */

import { existsSync, readdirSync } from 'fs';

export function parseDateRangeFromFilename(filename) {
  const match = filename.match(/_(\d{8})_(\d{8})\.parquet$/);
  if (!match) return null;
  return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
}

export function isComplementaryPair(a, b) {
  const aTuomo = /_剔摩_/.test(a);
  const aXianmo = /_限摩_/.test(a);
  const bTuomo = /_剔摩_/.test(b);
  const bXianmo = /_限摩_/.test(b);
  return (aTuomo && bXianmo) || (aXianmo && bTuomo);
}

/**
 * 计算所有重叠对（含互补豁免）。
 * @returns {{count:number, files:number, overlaps:Array<{a:string,b:string,aRange:[number,number],bRange:[number,number]}>}}
 */
export function detectPolicyCurrentOverlap(currentDir) {
  if (!existsSync(currentDir)) {
    return { count: 0, files: 0, overlaps: [], skipped: true, reason: 'dir-not-exist' };
  }

  const parquetFiles = readdirSync(currentDir)
    .filter((f) => f.endsWith('.parquet') && !f.startsWith('test-data'))
    .map((f) => ({ name: f, range: parseDateRangeFromFilename(f) }))
    .filter((f) => f.range !== null);

  if (parquetFiles.length <= 1) {
    return { count: 0, files: parquetFiles.length, overlaps: [], skipped: false };
  }

  const overlaps = [];
  for (let i = 0; i < parquetFiles.length; i++) {
    for (let j = i + 1; j < parquetFiles.length; j++) {
      const a = parquetFiles[i];
      const b = parquetFiles[j];
      if (a.range.start <= b.range.end && b.range.start <= a.range.end) {
        if (isComplementaryPair(a.name, b.name)) continue;
        overlaps.push({
          a: a.name,
          b: b.name,
          aRange: [a.range.start, a.range.end],
          bRange: [b.range.start, b.range.end],
        });
      }
    }
  }

  return { count: overlaps.length, files: parquetFiles.length, overlaps, skipped: false };
}

/**
 * 命令行入口（独立可执行）：检查 policy/current 重叠，发现则 exit(1)。
 * 用于 daily.mjs / sync-vps.mjs 在关键节点 spawn 调用，或本地手测。
 */
export function assertNoPolicyCurrentOverlap(currentDir, { onPass, onFail } = {}) {
  const result = detectPolicyCurrentOverlap(currentDir);

  if (result.skipped) {
    if (onPass) onPass(`policy/current 目录不存在，跳过重叠检测`);
    return true;
  }

  if (result.count === 0) {
    if (onPass) onPass(`policy/current 重叠检测通过（${result.files} 个文件，区间互补无重叠）`);
    return true;
  }

  if (onFail) {
    const lines = result.overlaps.map(
      (o) => `  - "${o.a}" [${o.aRange[0]}~${o.aRange[1]}] ↔ "${o.b}" [${o.bRange[0]}~${o.bRange[1]}]`
    );
    onFail(
      `policy/current Parquet 时间范围重叠（将导致数据翻倍）：\n${lines.join('\n')}\n` +
        `  ▶ 修复：删除冗余文件（裸名主分片+限摩=反模式），或确保剔摩↔限摩成对存在`
    );
  }
  return false;
}
