import { describe, it, expect } from 'vitest';
import { buildOrgSalesmanCache, getAvailableSalesmen } from '../src/features/dashboard/orgSalesman';

describe('机构-业务员联动', () => {
  it('should build cache and dedupe salesmen', () => {
    const cache = buildOrgSalesmanCache([
      { org_level_3: '成都', salesman_name: '张三' },
      { org_level_3: '成都', salesman_name: '张三' },
      { org_level_3: '成都', salesman_name: '李四' },
      { org_level_3: '宜宾', salesman_name: '王五' },
    ]);
    expect(cache['成都']).toEqual(['张三', '李四']);
    expect(cache['宜宾']).toEqual(['王五']);
  });

  it('should return all salesmen when no org selected', () => {
    const cache = { 成都: ['张三', '李四'] };
    const all = getAvailableSalesmen([], cache, ['张三', '李四', '王五']);
    expect(all).toEqual(['张三', '李四', '王五']);
  });

  it('should return filtered salesmen for selected orgs', () => {
    const cache = { 成都: ['张三', '李四'], 宜宾: ['王五', '赵六'] };
    const available = getAvailableSalesmen(['宜宾'], cache, ['张三', '李四', '王五', '赵六']);
    expect(available).toEqual(['王五', '赵六']);
  });
});
