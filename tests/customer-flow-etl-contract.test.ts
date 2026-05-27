import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('customer_flow ETL contract', () => {
  it('builds customer_flow from the new split 08/09 products', () => {
    const dataSourcesPath = resolve(process.cwd(), '数据管理/data-sources.json');
    const dataSources = JSON.parse(readFileSync(dataSourcesPath, 'utf-8'));
    const customerFlow = dataSources.domains.find((domain: { id: string }) => domain.id === 'customer_flow');

    expect(customerFlow).toBeTruthy();
    expect(customerFlow.source_pattern).toBe('????????_08_商业险续保流失公司.xlsx + ????????_09_商业险转保上年公司.xlsx');
    expect(customerFlow.trigger.input_strategy).toBe('full_snapshot');
    expect(customerFlow.trigger.snapshot_mode).toBe('full_batch_replace');
    expect(customerFlow.trigger.required_same_batch).toBe(true);
    expect(customerFlow.trigger.input_globs).toEqual([
      '????????_08_商业险续保流失公司.xlsx',
      '????????_09_商业险转保上年公司.xlsx',
    ]);
    expect(customerFlow.trigger.merge_with_history).toBeUndefined();
    expect(customerFlow.trigger.validation).toMatchObject({
      min_rows: 180000,
      min_date: '2025-01-01',
      require_non_null: {
        previous_insurer: 1,
        next_insurer: 1,
      },
    });
    expect(customerFlow.field_count).toBe(5);
  });

  it('rejects candidate parquet when date validation is enabled but date stats are empty', () => {
    const dailySourcePath = resolve(process.cwd(), '数据管理/daily.mjs');
    const dailySource = readFileSync(dailySourcePath, 'utf-8');

    expect(dailySource).toContain('validateDomainCandidate(python, id, tmpOutput, trigger.validation)');
    expect(dailySource).toContain('validation.min_date && !stats.min_date');
    expect(dailySource).toContain('min_date is empty; required <=');
    expect(dailySource).toContain('validation.max_date && !stats.max_date');
    expect(dailySource).toContain('max_date is empty; required >=');
  });
});
