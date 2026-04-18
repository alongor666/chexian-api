// Parquet 行/列数统计工具 — daily.mjs 抽出
//
// 设计：路径通过 argv 传 Python（不拼 shell 字符串），Python 内部做单引号转义
// 后嵌入 DuckDB SQL。消除原 daily.mjs 中"shell f-string → Python f-string →
// DuckDB SQL"的三层嵌套。
//
// 错误一律返回 null（沿用原函数契约），调用方自行判断。

import { spawnSync } from 'child_process';

const PY_ROW_COUNT = `
import sys, pyarrow.parquet as pq
print(pq.read_metadata(sys.argv[1]).num_rows)
`;

const PY_COL_COUNT = `
import sys, pyarrow.parquet as pq
print(len(pq.read_schema(sys.argv[1]).names))
`;

const PY_PARTITIONED_ROW_COUNT = `
import sys, os, duckdb
pattern = os.path.join(sys.argv[1], 'claims_*.parquet').replace("'", "''")
print(duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{pattern}')").fetchone()[0])
`;

const PY_PARTITIONED_COL_COUNT = `
import sys, os, duckdb
pattern = os.path.join(sys.argv[1], 'claims_*.parquet').replace("'", "''")
rows = duckdb.sql(f"DESCRIBE SELECT * FROM read_parquet('{pattern}', union_by_name=true) LIMIT 0").fetchall()
print(len(rows))
`;

function runStat(python, script, arg) {
  const result = spawnSync(python, ['-', arg], {
    input: script,
    encoding: 'utf-8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  return out ? parseInt(out, 10) : null;
}

/** pyarrow 读单个 parquet 文件的行数 */
export const getParquetRowCount = (python, parquetPath) =>
  runStat(python, PY_ROW_COUNT, parquetPath);

/** pyarrow 读单个 parquet 文件的 schema 列数 */
export const getParquetColumnCount = (python, parquetPath) =>
  runStat(python, PY_COL_COUNT, parquetPath);

/** DuckDB glob 读 claims_*.parquet 分区总行数 */
export const getPartitionedRowCount = (python, dir) =>
  runStat(python, PY_PARTITIONED_ROW_COUNT, dir);

/** DuckDB union_by_name 读 claims_*.parquet 分区 schema 并集列数（兼容年度 schema 漂移） */
export const getPartitionedColumnCount = (python, dir) =>
  runStat(python, PY_PARTITIONED_COL_COUNT, dir);
