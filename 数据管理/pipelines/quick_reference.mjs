import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { getParquetColumnCount, getParquetRowCount } from './parquet_stats.mjs';
import { listPolicyCurrentShards, toDuckdbReadParquetList } from '../../scripts/lib/policy-current-shards.mjs';

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWan(value) {
  return Math.round(value / 10_000);
}

const PY_POLICY_SUMMARY = `
import json, sys
import duckdb

# B2：read_target = DuckDB read_parquet 数组字面量（JS toDuckdbReadParquetList 显式枚举顶层扁平 +
# 省份子目录 current/<省>/ 的精确文件列表，已 SQL 单引号转义）——与 helper ^[A-Z]{2}$ 单层语义一致，
# 不用宽 ** glob（避免吃到 archive/ 等 helper 排除的文件，codex 闸-2 P1）。
read_target = sys.argv[1]
row = duckdb.sql(f"""
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT policy_no) AS unique_policy_count,
  SUM(CASE WHEN CAST(policy_date AS DATE) >= DATE '2024-01-01' THEN 1 ELSE 0 END) AS active_2024_row_count
FROM read_parquet({read_target}, union_by_name=true)
""").fetchone()

print(json.dumps({
  "rowCount": int(row[0] or 0),
  "uniquePolicyCount": int(row[1] or 0),
  "active2024RowCount": int(row[2] or 0),
}, ensure_ascii=False))
`;

function getPolicyCurrentSummary(python, readTarget) {
  const result = spawnSync(python, ['-', readTarget], {
    input: PY_POLICY_SUMMARY,
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  return out ? JSON.parse(out) : null;
}

export function buildQuickReferenceLine({ date = todayString(), rowCount, fieldCount, shardCount }) {
  const rowWan = formatWan(rowCount);
  return `**更新**: ${date} | **数据规模**: ~${rowWan} 万条 / ${fieldCount} 字段 | **分片**: ${shardCount} 个 Parquet（policy/current/）`;
}

export function updateQuickReferenceText(text, stats) {
  const newLine = buildQuickReferenceLine(stats);
  const pattern = /\*\*更新\*\*:.*?\*\*分片\*\*:.*(?:\r?\n|$)/;
  if (!pattern.test(text)) {
    throw new Error('QUICK_REFERENCE.md 缺少顶部数据规模行');
  }
  let updated = text.replace(pattern, `${newLine}\n`);

  if (stats.uniquePolicyCount != null && stats.active2024RowCount != null) {
    updated = updated
      .replace(
        /\| 原始记录 \| .*? \| .*? \|/,
        `| 原始记录 | ~${formatWan(stats.rowCount)} 万行 | policy/current UNION ALL 行数 |`
      )
      .replace(
        /\| 唯一保单 \| .*? \| .*? \|/,
        `| 唯一保单 | ~${formatWan(stats.uniquePolicyCount)} 万 | COUNT DISTINCT policy_no |`
      )
      .replace(
        /\| 2024\+ 活跃 \| .*? \| .*? \|/,
        `| 2024+ 活跃 | ~${formatWan(stats.active2024RowCount)} 万行 | policy_date >= 2024-01-01 |`
      );
  }

  return updated;
}

export function extractQuickReferenceStats(text) {
  const match = text.match(/\*\*数据规模\*\*:\s*~?(\d+)\s*万条\s*\/\s*(\d+)\s*字段\s*\|\s*\*\*分片\*\*:\s*(\d+)\s*个\s*Parquet/);
  if (!match) return null;
  return {
    rowCountApprox: parseInt(match[1], 10) * 10_000,
    fieldCount: parseInt(match[2], 10),
    shardCount: parseInt(match[3], 10),
  };
}

export function collectPolicyCurrentStats(
  python,
  policyCurrentDir,
  statFns = { getParquetRowCount, getParquetColumnCount, getPolicyCurrentSummary }
) {
  if (!existsSync(policyCurrentDir)) return null;

  // B2：下钻顶层扁平 + 省份子目录 current/<省>/（共享 helper），防子目录失明致 shardCount 0。
  // 扁平布局下与历史 readdirSync(policyCurrentDir) 枚举逐字节等价。
  const shards = listPolicyCurrentShards(policyCurrentDir).sort((a, b) => a.path.localeCompare(b.path));
  if (shards.length === 0) return null;

  let rowCount = 0;
  let fieldCount = 0;
  for (const shard of shards) {
    const shardPath = shard.path;
    const rows = statFns.getParquetRowCount(python, shardPath);
    const cols = statFns.getParquetColumnCount(python, shardPath);
    if (rows == null || cols == null) {
      throw new Error(`无法读取 Parquet 元数据: ${shardPath}`);
    }
    rowCount += rows;
    fieldCount = Math.max(fieldCount, cols);
  }

  // summary 用显式文件列表（与 shardCount/逐分片统计同一组 shards），不下钻宽 glob
  const summary = statFns.getPolicyCurrentSummary?.(python, toDuckdbReadParquetList(shards.map((s) => s.path)));

  return {
    rowCount: summary?.rowCount ?? rowCount,
    fieldCount,
    shardCount: shards.length,
    ...(summary?.uniquePolicyCount != null ? { uniquePolicyCount: summary.uniquePolicyCount } : {}),
    ...(summary?.active2024RowCount != null ? { active2024RowCount: summary.active2024RowCount } : {}),
  };
}

export function syncQuickReferenceFile(qrPath, stats) {
  if (!existsSync(qrPath)) return null;
  const date = todayString();
  const text = readFileSync(qrPath, 'utf-8');
  const updated = updateQuickReferenceText(text, { date, ...stats });
  writeFileSync(qrPath, updated, 'utf-8');
  return buildQuickReferenceLine({ date, ...stats });
}
