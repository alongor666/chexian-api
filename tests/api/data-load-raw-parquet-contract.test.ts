import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('raw_parquet object-type compatibility contract', () => {
  it('uses typed relation drop helper before recreating raw_parquet', () => {
    const content = readSource('server/src/services/duckdb.ts');

    expect(content).toContain('async dropRelationIfExists(relationName: string): Promise<void>');
    expect(content).toContain('FROM information_schema.tables');
    expect(content).toContain("if (tableType === 'VIEW') {");
    expect(content).toContain('await this.query(`DROP VIEW IF EXISTS ${safeRelationName}`)');
    expect(content).toContain('await this.query(`DROP TABLE IF EXISTS ${safeRelationName}`)');
    expect(content).toContain('await this.dropRelationIfExists(safeTableName);');
    expect(content).toContain("await this.dropRelationIfExists('raw_parquet');");
  });
});
