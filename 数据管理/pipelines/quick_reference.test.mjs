import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildQuickReferenceLine,
  collectPolicyCurrentStats,
  extractQuickReferenceStats,
  updateQuickReferenceText,
} from './quick_reference.mjs';

describe('quick_reference governance helpers', () => {
  it('builds the top metadata line from full policy/current stats', () => {
    expect(
      buildQuickReferenceLine({
        date: '2026-04-23',
        rowCount: 2_529_776,
        fieldCount: 41,
        shardCount: 9,
      })
    ).toBe('**更新**: 2026-04-23 | **数据规模**: ~253 万条 / 41 字段 | **分片**: 9 个 Parquet（policy/current/）');
  });

  it('updates only the top metadata line', () => {
    const text = [
      '# 车险数据快速参考 (~300 tokens)',
      '',
      '**更新**: 2026-04-22 | **数据规模**: ~0 万条 / 41 字段 | **分片**: 4 个 Parquet（policy/current/）',
      '',
      '## 数据规模（三层口径）',
    ].join('\n');

    const updated = updateQuickReferenceText(text, {
      date: '2026-04-23',
      rowCount: 2_529_776,
      fieldCount: 41,
      shardCount: 9,
    });

    expect(updated).toContain('**数据规模**: ~253 万条 / 41 字段 | **分片**: 9 个 Parquet');
    expect(updated).toContain('## 数据规模（三层口径）');
  });

  it('refreshes the data scale table when full policy stats are available', () => {
    const text = [
      '# 车险数据快速参考 (~300 tokens)',
      '',
      '**更新**: 2026-04-22 | **数据规模**: ~0 万条 / 41 字段 | **分片**: 4 个 Parquet（policy/current/）',
      '',
      '## 数据规模（三层口径）',
      '',
      '| 口径 | 数值 | 说明 |',
      '|------|------|------|',
      '| 原始记录 | ~354 万行 | UNION ALL 含交强商业分行 |',
      '| 唯一保单 | ~150 万 | COUNT DISTINCT policy_no |',
      '| 2024+ 活跃 | ~88 万 | policy_date >= 2024-01-01 |',
    ].join('\n');

    const updated = updateQuickReferenceText(text, {
      date: '2026-04-23',
      rowCount: 2_533_221,
      fieldCount: 41,
      shardCount: 11,
      uniquePolicyCount: 2_468_817,
      active2024RowCount: 1_198_871,
    });

    expect(updated).toContain('| 原始记录 | ~253 万行 | policy/current UNION ALL 行数 |');
    expect(updated).toContain('| 唯一保单 | ~247 万 | COUNT DISTINCT policy_no |');
    expect(updated).toContain('| 2024+ 活跃 | ~120 万行 | policy_date >= 2024-01-01 |');
  });

  it('extracts the declared row, field, and shard counts', () => {
    expect(
      extractQuickReferenceStats('**更新**: 2026-04-23 | **数据规模**: ~253 万条 / 41 字段 | **分片**: 9 个 Parquet（policy/current/）')
    ).toEqual({
      rowCountApprox: 2_530_000,
      fieldCount: 41,
      shardCount: 9,
    });
  });

  it('collects stats from every parquet shard instead of one transform output', () => {
    const dir = join(tmpdir(), `quick-reference-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, '2021.parquet'), '');
      writeFileSync(join(dir, '2022.parquet'), '');
      writeFileSync(join(dir, 'ignore.txt'), '');

      const stats = collectPolicyCurrentStats('python3', dir, {
        getParquetRowCount: (_python, filePath) => (filePath.endsWith('2021.parquet') ? 10 : 25),
        getParquetColumnCount: (_python, filePath) => (filePath.endsWith('2021.parquet') ? 39 : 41),
      });

      expect(stats).toEqual({
        rowCount: 35,
        fieldCount: 41,
        shardCount: 2,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // B2 防沉默失败：省份子目录 current/<省>/ 分片必须计入 shardCount/rowCount（否则知识库自愈写错）
  it('counts province subdir shards (current/<省>/) — no subdir blindness', () => {
    const dir = join(tmpdir(), `quick-reference-subdir-${process.pid}-${Date.now()}`);
    mkdirSync(join(dir, 'SC'), { recursive: true });
    try {
      writeFileSync(join(dir, 'SC', '2021.parquet'), '');
      writeFileSync(join(dir, 'SC', '2022.parquet'), '');

      const stats = collectPolicyCurrentStats('python3', dir, {
        getParquetRowCount: (_python, filePath) => (filePath.endsWith('2021.parquet') ? 10 : 25),
        getParquetColumnCount: () => 41,
      });

      expect(stats).toEqual({ rowCount: 35, fieldCount: 41, shardCount: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
