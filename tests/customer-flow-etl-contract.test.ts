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
    expect(customerFlow.trigger.merge_dedup_key).toBe('policy_no');
    expect(customerFlow.trigger.merge_order_by).toBe('insurance_start_date DESC NULLS LAST');
    expect(customerFlow.trigger.validation).toMatchObject({
      min_rows: 900000,
      min_date: '2025-01-01',
      require_non_null: {
        previous_insurer: 1,
        next_insurer: 1,
      },
    });
  });
});
