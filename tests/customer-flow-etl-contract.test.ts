import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('customer_flow ETL contract', () => {
  it('merges incrementals with history and blocks single-day replacement', () => {
    const dataSourcesPath = resolve(process.cwd(), '数据管理/data-sources.json');
    const dataSources = JSON.parse(readFileSync(dataSourcesPath, 'utf-8'));
    const customerFlow = dataSources.domains.find((domain: { id: string }) => domain.id === 'customer_flow');

    expect(customerFlow).toBeTruthy();
    expect(customerFlow.trigger.input_strategy).toBe('multi_file_merge');
    expect(customerFlow.trigger.merge_with_history).toBe(true);
    expect(customerFlow.trigger.merge_dedup_key).toBe('policy_no, insurance_start_date');
    expect(customerFlow.trigger.merge_order_by).toBe(
      'insurance_start_date DESC NULLS LAST, (next_insurer IS NULL) ASC, (previous_insurer IS NULL) ASC',
    );
    expect(customerFlow.trigger.validation).toMatchObject({
      min_rows: 900000,
      min_date: '2025-01-01',
      require_non_null: {
        previous_insurer: 1,
        next_insurer: 1,
      },
    });
  });

  it('rejects candidate parquet when date validation is enabled but date stats are empty', () => {
    const dailySourcePath = resolve(process.cwd(), '数据管理/daily.mjs');
    const dailySource = readFileSync(dailySourcePath, 'utf-8');

    expect(dailySource).toContain('validation.min_date && !stats.min_date');
    expect(dailySource).toContain('min_date is empty; required <=');
    expect(dailySource).toContain('validation.max_date && !stats.max_date');
    expect(dailySource).toContain('max_date is empty; required >=');
  });
});
