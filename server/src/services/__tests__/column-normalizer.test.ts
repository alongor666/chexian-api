import { describe, expect, it } from 'vitest';

import { generateColumnMappingSQL } from '../column-normalizer.js';

describe('column-normalizer', () => {
  it('CN-01: raw_parquet 中未被标准映射命中的原始列也要透传到 PolicyFact', () => {
    const sql = generateColumnMappingSQL('raw_parquet', [
      '保单号',
      '签单/批改保费含税',
      '签单日期',
      '保险起期',
      '业务员',
      '三级机构',
      '客户类别',
      '险类',
      '险别组合',
      '是否新车',
      '是否过户车',
      '是否新能源',
      '是否电销',
      '代理人/经纪人',
    ]);

    // 代理人/经纪人 现在是 agent_name 的别名，会被映射而非透传
    expect(sql).toContain('agent_name');
  });
});
