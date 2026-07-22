import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_CAPABILITIES,
  ANALYSIS_CAPABILITIES_VERSION,
  buildAnalysisCapabilitiesData,
  getAnalysisCapabilityAllowedParams,
  getAnalysisCapability,
  validateAnalysisCapabilities,
} from '../analysis-capabilities.js';
import { computeEtag } from '../../services/route-cache.js';

describe('远程分析能力目录', () => {
  it('全部映射到已登记的只读查询路由及参数', () => {
    expect(validateAnalysisCapabilities()).toEqual([]);
  });

  it('能力 id 唯一且可按 id 查询', () => {
    const ids = ANALYSIS_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getAnalysisCapability('loss-development')?.domain).toBe('claims');
    expect(getAnalysisCapability('missing')).toBeUndefined();
  });

  it('从路由元数据生成参数白名单并额外允许统一 RLS 分公司参数', () => {
    const trend = getAnalysisCapability('operating-trend')!;
    expect(getAnalysisCapabilityAllowedParams(trend)).toEqual(expect.arrayContaining([
      'startDate',
      'endDate',
      'granularity',
      'targetBranch',
    ]));
    expect(getAnalysisCapabilityAllowedParams(trend)).not.toContain('notAParam');
  });

  it('经代满期出险率锁定维度指标，只允许精确经代和明确时间口径', () => {
    const capability = getAnalysisCapability('agent-earned-loss-frequency')!;
    expect(capability.fixedParams).toEqual({
      dimensions: 'agent_name',
      metrics: 'earned_loss_frequency,policy_count',
      limit: '500',
    });
    expect(getAnalysisCapabilityAllowedParams(capability)).toEqual(expect.arrayContaining([
      'startDate', 'endDate', 'dateField', 'agentNames', 'targetBranch',
    ]));
    expect(getAnalysisCapabilityAllowedParams(capability)).not.toContain('dimensions');
    expect(getAnalysisCapabilityAllowedParams(capability)).not.toContain('metrics');
    expect(getAnalysisCapabilityAllowedParams(capability)).not.toContain('limit');

    const published = buildAnalysisCapabilitiesData().capabilities.find(
      (item) => item.id === capability.id,
    )!;
    expect(published.timeWindow).toBe('window');
    expect(published.parameters.find((parameter) => parameter.name === 'agentNames')).toMatchObject({
      type: 'string', required: true,
    });
  });

  it('目录版本与响应体 ETag 随代码契约变化，不依赖 ETL 版本', () => {
    const current = buildAnalysisCapabilitiesData();
    expect(current.version).toBe(ANALYSIS_CAPABILITIES_VERSION);
    expect(current.version).toBe(6);
    expect(current.minCliVersion).toBe('1.3.0');

    const changed = structuredClone(current);
    changed.capabilities[0].allowedParams.push('futureParam');
    expect(computeEtag(changed)).not.toBe(computeEtag(current));
  });

  it('每项能力公开稳定结果语义，维度与指标均属于必需字段', () => {
    for (const capability of buildAnalysisCapabilitiesData().capabilities) {
      expect(capability.resultSchema.id).toMatch(/\.v[1-9][0-9]*$/);
      expect(capability.resultSchema.version).toBeGreaterThan(0);
      expect(['$', '$.rows']).toContain(capability.resultSchema.recordsPath);
      for (const field of [
        ...capability.resultSchema.dimensionFields,
        ...capability.resultSchema.metricFields,
      ]) {
        expect(capability.resultSchema.requiredFields).toContain(field);
      }
    }
  });

  it('扩展 cohort、分群、续保与定价能力，并锁定可复核聚合形态', () => {
    expect(getAnalysisCapability('portfolio-segment')).toMatchObject({
      domain: 'operating',
      fixedParams: {
        dimensions: 'customer_category',
        metrics: 'total_premium,policy_count,earned_claim_ratio',
      },
    });
    expect(getAnalysisCapability('cohort-loss-development')?.requiredParams).toContain('cohortYears');
    expect(getAnalysisCapability('renewal-org-diagnosis')).toMatchObject({
      domain: 'renewal',
      fixedParams: { metric: 'renewal_due_count', dimensions: 'org_level_3' },
    });
    expect(getAnalysisCapability('quote-conversion-funnel')?.resultSchema.requiredFields)
      .toEqual(expect.arrayContaining(['l1_total', 'l4_insured']));
    expect(getAnalysisCapability('pricing-risk-segment')?.fixedParams)
      .toEqual({ dimension: 'insurance_grade' });

    const risk = getAnalysisCapability('pricing-risk-segment')!;
    expect(getAnalysisCapabilityAllowedParams(risk)).not.toContain('dimension');
    expect(getAnalysisCapabilityAllowedParams(risk)).toContain('targetBranch');
  });
});
