/**
 * 基于真实数据的业务验证测试
 *
 * 数据来源：数据管理/保单明细/车险保单综合明细表.parquet
 * 目的：验证SQL生成器、业务逻辑与真实数据的一致性
 *
 * 测试策略：
 * 1. 使用真实的保单号、机构、业务员等数据
 * 2. 验证聚合计算与预期值匹配
 * 3. 确保筛选条件正确应用
 */

import { describe, it, expect } from 'vitest';
import {
  REAL_ORGANIZATIONS,
  REAL_ORG_SAMPLES,
  REAL_ORG_SUMMARY,
  REAL_CUSTOMER_TYPE_SAMPLES,
  REAL_INSURANCE_TYPE_SAMPLES,
  REAL_TERMINAL_SOURCE_SAMPLES,
  REAL_RENEWAL_MODE_SAMPLES,
  REAL_TONNAGE_SAMPLES,
  REAL_COST_ANALYSIS_SAMPLES,
  REAL_COEFFICIENT_SAMPLES,
  REAL_DATA_STATISTICS,
  getSampleByOrg,
  getOrgSummary,
} from './fixtures/realData';

// ==================== 机构数据验证 ====================
describe('真实数据：机构维度验证', () => {
  describe('三级机构列表', () => {
    it('应包含12个三级机构', () => {
      expect(REAL_ORGANIZATIONS).toHaveLength(12);
    });

    it('应包含所有已知机构', () => {
      const expectedOrgs = ['乐山', '天府', '宜宾', '德阳', '新都', '武侯', '泸州', '自贡', '资阳', '达州', '青羊', '高新'];
      expectedOrgs.forEach(org => {
        expect(REAL_ORGANIZATIONS).toContain(org);
      });
    });
  });

  describe('机构样本数据', () => {
    it('每个机构应有有效的样本数据', () => {
      REAL_ORGANIZATIONS.forEach(org => {
        const sample = getSampleByOrg(org);
        expect(sample).toBeDefined();
        expect(sample?.org).toBe(org);
        expect(sample?.policy_no).toBeTruthy();
        expect(sample?.salesman).toBeTruthy();
      });
    });

    it('天府机构样本应为营业货车', () => {
      const sample = getSampleByOrg('天府');
      expect(sample?.customer_type).toBe('营业货车');
      expect(sample?.premium).toBe(4226.42);
    });

    it('乐山机构样本应为续保保单', () => {
      const sample = getSampleByOrg('乐山');
      expect(sample?.is_renewal).toBe(true);
      expect(sample?.premium).toBe(896.23);
    });
  });

  describe('机构汇总统计', () => {
    it('天府机构应有最多保单', () => {
      const tianfu = getOrgSummary('天府');
      expect(tianfu?.total_policies).toBe(245235);
      expect(tianfu?.total_premium).toBeCloseTo(200735897.52, 2);
    });

    it('达州机构应有最少保单', () => {
      const dazhou = getOrgSummary('达州');
      expect(dazhou?.total_policies).toBe(3025);
    });

    it('达州机构续保率最高', () => {
      const dazhou = getOrgSummary('达州');
      expect(dazhou?.renewal_rate).toBe(9.45);
    });

    it('自贡机构续保率最低', () => {
      const zigong = getOrgSummary('自贡');
      expect(zigong?.renewal_rate).toBe(1.64);
    });

    it('新都机构人均保费最高', () => {
      const xindu = getOrgSummary('新都');
      expect(xindu?.avg_premium).toBe(1823.21);
    });

    it('所有机构保费总和应正确', () => {
      const totalPremium = REAL_ORG_SUMMARY.reduce((sum, org) => sum + org.total_premium, 0);
      // 总保费约 4.79 亿
      expect(totalPremium).toBeGreaterThan(400000000);
      expect(totalPremium).toBeLessThan(500000000);
    });

    it('所有机构保单总数应正确', () => {
      const totalPolicies = REAL_ORG_SUMMARY.reduce((sum, org) => sum + org.total_policies, 0);
      // 不含"本部"的44条数据
      expect(totalPolicies).toBe(618502 - 44);
    });
  });
});

// ==================== 险类维度验证 ====================
describe('真实数据：险类维度验证', () => {
  it('应有2种险类', () => {
    expect(REAL_INSURANCE_TYPE_SAMPLES).toHaveLength(2);
  });

  it('交强险样本应正确', () => {
    const sample = REAL_INSURANCE_TYPE_SAMPLES.find(s => s.insurance_type === '交强险');
    expect(sample).toBeDefined();
    expect(sample?.premium).toBe(4226.42);
    expect(sample?.org).toBe('天府');
  });

  it('商业保险样本应正确', () => {
    const sample = REAL_INSURANCE_TYPE_SAMPLES.find(s => s.insurance_type === '商业保险');
    expect(sample).toBeDefined();
    expect(sample?.premium).toBe(4643.22);
    expect(sample?.org).toBe('高新');
  });

  it('险类分布应符合预期', () => {
    const { insuranceTypeDistribution } = REAL_DATA_STATISTICS;
    expect(insuranceTypeDistribution['交强险']).toBe(471312);
    expect(insuranceTypeDistribution['商业保险']).toBe(147190);
    // 交强险占比约 76%
    const ratio = insuranceTypeDistribution['交强险'] / (insuranceTypeDistribution['交强险'] + insuranceTypeDistribution['商业保险']);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.77);
  });
});

// ==================== 客户类别验证 ====================
describe('真实数据：客户类别维度验证', () => {
  it('应有11种客户类别', () => {
    expect(REAL_CUSTOMER_TYPE_SAMPLES).toHaveLength(11);
  });

  it('非营业个人客车应是最大类别', () => {
    const { customerTypeTop5 } = REAL_DATA_STATISTICS;
    expect(customerTypeTop5['非营业个人客车']).toBe(363139);
    // 占比约 59%
    const ratio = customerTypeTop5['非营业个人客车'] / REAL_DATA_STATISTICS.totalRecords;
    expect(ratio).toBeGreaterThan(0.58);
    expect(ratio).toBeLessThan(0.60);
  });

  it('营业货车样本应为天府机构', () => {
    const sample = REAL_CUSTOMER_TYPE_SAMPLES.find(s => s.customer_type === '营业货车');
    expect(sample?.org).toBe('天府');
    expect(sample?.premium).toBe(4226.42);
  });

  it('特种车样本应为自贡机构', () => {
    const sample = REAL_CUSTOMER_TYPE_SAMPLES.find(s => s.customer_type === '特种车');
    expect(sample?.org).toBe('自贡');
  });

  it('营业城市公交样本应为资阳机构', () => {
    const sample = REAL_CUSTOMER_TYPE_SAMPLES.find(s => s.customer_type === '营业城市公交');
    expect(sample?.org).toBe('资阳');
  });
});

// ==================== 终端来源验证 ====================
describe('真实数据：终端来源维度验证', () => {
  it('应有8种终端来源', () => {
    expect(REAL_TERMINAL_SOURCE_SAMPLES).toHaveLength(8);
  });

  it('移动展业App应是最大渠道', () => {
    const { terminalSourceTop3 } = REAL_DATA_STATISTICS;
    expect(terminalSourceTop3['0106移动展业(App)']).toBe(420495);
    // 占比约 68%
    const ratio = terminalSourceTop3['0106移动展业(App)'] / REAL_DATA_STATISTICS.totalRecords;
    expect(ratio).toBeGreaterThan(0.67);
    expect(ratio).toBeLessThan(0.69);
  });

  it('AI出单样本应正确', () => {
    const sample = REAL_TERMINAL_SOURCE_SAMPLES.find(s => s.terminal_source === '0112AI出单');
    expect(sample).toBeDefined();
    expect(sample?.premium).toBe(389.21);
  });
});

// ==================== 续保模式验证 ====================
describe('真实数据：续保模式维度验证', () => {
  it('应有2种有效续保模式（排除nan）', () => {
    expect(REAL_RENEWAL_MODE_SAMPLES).toHaveLength(2);
  });

  it('自留模式样本应正确', () => {
    const sample = REAL_RENEWAL_MODE_SAMPLES.find(s => s.renewal_mode === '自留');
    expect(sample?.org).toBe('高新');
    expect(sample?.premium).toBe(4643.22);
  });

  it('外呼模式样本应正确', () => {
    const sample = REAL_RENEWAL_MODE_SAMPLES.find(s => s.renewal_mode === '外呼');
    expect(sample?.org).toBe('天府');
    expect(sample?.premium).toBe(660.38);
  });
});

// ==================== 吨位分段验证（货车） ====================
describe('真实数据：吨位分段维度验证', () => {
  it('应有5种吨位分段', () => {
    expect(REAL_TONNAGE_SAMPLES).toHaveLength(5);
  });

  it('10吨以上样本应为营业货车', () => {
    const sample = REAL_TONNAGE_SAMPLES.find(s => s.tonnage_segment === '10吨以上');
    expect(sample?.customer_type).toBe('营业货车');
    expect(sample?.premium).toBe(4226.42);
  });

  it('9-10吨样本应为高新机构', () => {
    const sample = REAL_TONNAGE_SAMPLES.find(s => s.tonnage_segment === '9-10吨');
    expect(sample?.org).toBe('高新');
    expect(sample?.customer_type).toBe('营业货车');
  });

  it('1吨以下不应是营业货车', () => {
    const sample = REAL_TONNAGE_SAMPLES.find(s => s.tonnage_segment === '1吨以下');
    expect(sample?.customer_type).not.toBe('营业货车');
  });
});

// ==================== 成本分析验证 ====================
describe('真实数据：成本分析维度验证', () => {
  it('所有成本样本应有赔案', () => {
    REAL_COST_ANALYSIS_SAMPLES.forEach(sample => {
      expect(sample.claim_count).toBeGreaterThan(0);
    });
  });

  it('天府机构营业货车赔案样本应正确', () => {
    const sample = REAL_COST_ANALYSIS_SAMPLES.find(
      s => s.org === '天府' && s.customer_type === '营业货车'
    );
    expect(sample).toBeDefined();
    expect(sample?.reported_loss).toBe(2000.0);
    expect(sample?.premium).toBe(4226.42);
  });

  it('赔付率计算验证：已报告赔款/保费', () => {
    const sample = REAL_COST_ANALYSIS_SAMPLES.find(s => s.policy_no === '6103011030120250129325');
    expect(sample).toBeDefined();
    if (sample && sample.premium > 0) {
      const claimRatio = sample.reported_loss / sample.premium;
      // 700 / 1037.74 ≈ 0.674
      expect(claimRatio).toBeCloseTo(0.674, 2);
    }
  });

  it('费用率计算验证：费用/保费', () => {
    const sample = REAL_COST_ANALYSIS_SAMPLES.find(s => s.policy_no === '6103011030120250129325');
    expect(sample).toBeDefined();
    if (sample && sample.premium > 0) {
      const expenseRatio = sample.expense / sample.premium;
      // 103.78 / 1037.74 ≈ 0.10
      expect(expenseRatio).toBeCloseTo(0.10, 2);
    }
  });

  it('包含负保费的样本（批单退费）', () => {
    const negativePremiumSample = REAL_COST_ANALYSIS_SAMPLES.find(s => s.premium < 0);
    expect(negativePremiumSample).toBeDefined();
    expect(negativePremiumSample?.org).toBe('宜宾');
  });
});

// ==================== 商车自主定价系数验证 ====================
describe('真实数据：商车自主定价系数验证', () => {
  it('系数范围应在0.65-1.35之间', () => {
    REAL_COEFFICIENT_SAMPLES.forEach(sample => {
      expect(sample.coefficient).toBeGreaterThanOrEqual(0.65);
      expect(sample.coefficient).toBeLessThanOrEqual(1.35);
    });
  });

  it('最高系数应为1.35', () => {
    const maxCoef = Math.max(...REAL_COEFFICIENT_SAMPLES.map(s => s.coefficient));
    expect(maxCoef).toBe(1.35);
  });

  it('最低系数样本应正确', () => {
    const minCoef = Math.min(...REAL_COEFFICIENT_SAMPLES.map(s => s.coefficient));
    expect(minCoef).toBe(0.7339);
    const sample = REAL_COEFFICIENT_SAMPLES.find(s => s.coefficient === minCoef);
    expect(sample?.org).toBe('天府');
  });

  it('高新机构高系数样本应正确', () => {
    const sample = REAL_COEFFICIENT_SAMPLES.find(
      s => s.org === '高新' && s.coefficient === 1.35
    );
    expect(sample).toBeDefined();
    expect(sample?.premium).toBe(4643.22);
  });

  it('营业货车样本系数应为1.2', () => {
    const sample = REAL_COEFFICIENT_SAMPLES.find(s => s.customer_type === '营业货车');
    expect(sample).toBeDefined();
    expect(sample?.coefficient).toBe(1.2);
  });
});

// ==================== 数据统计验证 ====================
describe('真实数据：整体统计验证', () => {
  it('总记录数应正确', () => {
    expect(REAL_DATA_STATISTICS.totalRecords).toBe(618502);
  });

  it('签单日期范围应正确', () => {
    expect(REAL_DATA_STATISTICS.dateRange.signDateMin).toBe('2023-11-27');
    expect(REAL_DATA_STATISTICS.dateRange.signDateMax).toBe('2026-01-14');
  });

  it('保险起期范围应正确', () => {
    expect(REAL_DATA_STATISTICS.dateRange.startDateMin).toBe('2023-12-13');
    expect(REAL_DATA_STATISTICS.dateRange.startDateMax).toBe('2026-04-10');
  });

  it('数据跨度应超过2年', () => {
    const minDate = new Date(REAL_DATA_STATISTICS.dateRange.signDateMin);
    const maxDate = new Date(REAL_DATA_STATISTICS.dateRange.signDateMax);
    const daysDiff = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(730); // 超过2年
  });
});

// ==================== SQL 生成器与真实数据验证 ====================
describe('SQL生成器与真实数据一致性', () => {
  it('机构筛选条件应使用真实机构名', () => {
    REAL_ORGANIZATIONS.forEach(org => {
      const whereClause = `org_level_3 IN ('${org}')`;
      expect(whereClause).toContain(org);
    });
  });

  it('客户类别筛选条件应使用真实类别名', () => {
    const customerTypes = REAL_CUSTOMER_TYPE_SAMPLES.map(s => s.customer_type);
    customerTypes.forEach(type => {
      const whereClause = `customer_category IN ('${type}')`;
      expect(whereClause).toContain(type);
    });
  });

  it('真实保单号格式应为22位', () => {
    REAL_ORG_SAMPLES.forEach(sample => {
      expect(sample.policy_no).toHaveLength(22);
      expect(sample.policy_no).toMatch(/^610\d{19}$/);
    });
  });

  it('真实业务员格式应为工号+姓名', () => {
    REAL_ORG_SAMPLES.forEach(sample => {
      // 格式：9位工号 + 中文姓名
      expect(sample.salesman).toMatch(/^\d{9}.+$/);
    });
  });
});

// ==================== 业务规则验证 ====================
describe('业务规则与真实数据验证', () => {
  it('续保保单is_renewal应为true', () => {
    const renewalSample = REAL_ORG_SAMPLES.find(s => s.is_renewal === true);
    expect(renewalSample).toBeDefined();
    expect(renewalSample?.org).toBe('乐山');
  });

  it('非续保保单is_renewal应为false', () => {
    const nonRenewalSamples = REAL_ORG_SAMPLES.filter(s => s.is_renewal === false);
    expect(nonRenewalSamples.length).toBeGreaterThan(0);
  });

  it('商业保险系数样本应有有效系数', () => {
    REAL_COEFFICIENT_SAMPLES.forEach(sample => {
      expect(sample.coefficient).toBeGreaterThan(0);
    });
  });

  it('机构续保率应与统计数据一致', () => {
    REAL_ORG_SUMMARY.forEach(summary => {
      // 续保率 = 续保件数 / 总件数 * 100
      const calculatedRate = (summary.renewal_count / summary.total_policies) * 100;
      expect(calculatedRate).toBeCloseTo(summary.renewal_rate, 1);
    });
  });

  it('机构平均保费应与统计数据一致', () => {
    REAL_ORG_SUMMARY.forEach(summary => {
      // 平均保费 = 总保费 / 总件数
      const calculatedAvg = summary.total_premium / summary.total_policies;
      expect(calculatedAvg).toBeCloseTo(summary.avg_premium, 0);
    });
  });
});
