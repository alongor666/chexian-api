import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('raw_parquet object-type compatibility contract', () => {
  it('uses typed relation drop helper before recreating raw_parquet', () => {
    // dropRelationIfExists 实现已迁移到 duckdb-infra.ts（Phase 04 重构）
    const infraContent = readSource('server/src/services/duckdb-infra.ts');
    const serviceContent = readSource('server/src/services/duckdb.ts');

    // duckdb-infra.ts 包含实际的 DROP 逻辑
    expect(infraContent).toContain('async function dropRelationIfExists');
    expect(infraContent).toContain('FROM information_schema.tables');
    expect(infraContent).toContain("if (tableType === 'VIEW') {");
    expect(infraContent).toContain('DROP VIEW IF EXISTS');
    expect(infraContent).toContain('DROP TABLE IF EXISTS');

    // duckdb.ts 通过委托方法暴露该能力，并在 loadParquet 中调用
    expect(serviceContent).toContain('async dropRelationIfExists(name: string)');
    expect(serviceContent).toContain('await this.dropRelationIfExists(sanitizeTableName(tableName))');
  });
});
