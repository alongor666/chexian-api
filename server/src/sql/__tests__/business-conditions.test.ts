import { describe, it, expect } from 'vitest';
import { QUALITY_BUSINESS_CONDITION as SSOT } from '../shared/business-conditions.js';
import { QUALITY_BUSINESS_CONDITION as fromKpi } from '../kpi.js';
import { QUALITY_BUSINESS_CONDITION as fromTrendShared } from '../trend/shared.js';

/**
 * B301: 优质业务定义统一到单一事实源回归测试
 *
 * 此前三处（kpi.ts / trend/shared.ts / salesman-ranking.ts）独立定义，
 * 且 salesman-ranking 口径（营业客车）与 kpi/trend（非营业客车）语义相反。
 * 现统一到 shared/business-conditions.ts，以 kpi/trend 口径为准。
 */
describe('B301 优质业务定义单一事实源', () => {
  it('kpi.ts re-export 与 SSOT 严格相等（同一引用）', () => {
    expect(fromKpi).toBe(SSOT);
  });

  it('trend/shared.ts re-export 与 SSOT 严格相等（同一引用）', () => {
    expect(fromTrendShared).toBe(SSOT);
  });

  it('SSOT 采用非营业客车口径（含 is_nev = false + 非营业/企业/机关）', () => {
    expect(SSOT).toContain('is_nev = false');
    expect(SSOT).toContain('非营业个人');
    expect(SSOT).toContain('企业');
    expect(SSOT).toContain('机关');
  });

  it('SSOT 不再包含旧 salesman-ranking 的营业客车口径（网约车/出租车 + insurance_type）', () => {
    expect(SSOT).not.toContain('网约车');
    expect(SSOT).not.toContain('出租车');
    expect(SSOT).not.toContain('insurance_type');
  });

  it('SSOT 保留货车吨位口径（1吨以下 / 2-9吨）', () => {
    expect(SSOT).toContain('货车');
    expect(SSOT).toContain('1吨以下');
    expect(SSOT).toContain('2-9吨');
  });
});
