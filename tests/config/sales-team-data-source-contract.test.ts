import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sales_team_performance 数据源发布契约', () => {
  it('data-sources.output 指向运行时实际加载的 enriched Parquet', () => {
    const config = JSON.parse(readFileSync('数据管理/data-sources.json', 'utf8')) as {
      domains: Array<{ id: string; output?: string }>;
    };
    const domain = config.domains.find((item) => item.id === 'sales_team_performance');
    expect(domain?.output).toBe(
      'warehouse/fact/sales_team_performance/biaobao_enriched.parquet',
    );
  });
});
