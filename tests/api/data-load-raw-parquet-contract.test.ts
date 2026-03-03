import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('raw_parquet object-type compatibility contract', () => {
  it('drops both view and table before recreating raw_parquet as table', () => {
    const content = readSource('server/src/services/duckdb.ts');

    const dropViewToken = 'await this.query(`DROP VIEW IF EXISTS ${safeTableName}`)';
    const dropTableToken = 'await this.query(`DROP TABLE IF EXISTS ${safeTableName}`)';
    const createToken = 'CREATE OR REPLACE TABLE ${safeTableName} AS';

    const dropViewPos = content.indexOf(dropViewToken);
    const dropTablePos = content.indexOf(dropTableToken);
    const createPos = content.indexOf(createToken);

    expect(dropViewPos).toBeGreaterThan(-1);
    expect(dropTablePos).toBeGreaterThan(-1);
    expect(createPos).toBeGreaterThan(-1);
    expect(dropViewPos).toBeLessThan(createPos);
    expect(dropTablePos).toBeLessThan(createPos);
  });
});
