import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('raw_parquet object-type compatibility contract', () => {
  it('builds a staging table before the typed transactional relation swap', () => {
    // dropRelationIfExists 实现已迁移到 duckdb-infra.ts（Phase 04 重构）
    const infraContent = readSource('server/src/services/duckdb-infra.ts');
    const serviceContent = readSource('server/src/services/duckdb.ts');
    const loaderContent = readSource('server/src/services/duckdb-parquet-loader.ts');

    // duckdb-infra.ts 包含实际的 DROP 逻辑
    expect(infraContent).toContain('async function dropRelationIfExists');
    expect(infraContent).toContain('FROM information_schema.tables');
    expect(infraContent).toContain("if (tableType === 'VIEW') {");
    expect(infraContent).toContain('DROP VIEW IF EXISTS');
    expect(infraContent).toContain('DROP TABLE IF EXISTS');

    // duckdb.ts 通过委托方法暴露清理能力；加载路径必须先构建 staging 再事务换表。
    expect(serviceContent).toContain('async dropRelationIfExists(name: string)');
    expect(serviceContent).toContain('await replaceTableFromSelect(');
    expect(serviceContent).not.toContain('await this.dropRelationIfExists(sanitizeTableName(tableName))');
    expect(loaderContent).toContain('CREATE TABLE ${stagingTableName} AS ${selectSql}');
    expect(loaderContent).toContain('await db.transaction(swapStatements)');
  });
});
