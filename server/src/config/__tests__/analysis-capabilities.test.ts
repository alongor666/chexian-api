import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_CAPABILITIES,
  getAnalysisCapabilityAllowedParams,
  getAnalysisCapability,
  validateAnalysisCapabilities,
} from '../analysis-capabilities.js';

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
});
