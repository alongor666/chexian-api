import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  BRANCH_PUBLISH_DOMAINS,
  nonScBranchCodes,
  buildBranchEtlSteps,
} from '../数据管理/lib/branch-publish.mjs';

describe('nonScBranchCodes（非 SC 注册省·数据驱动单一来源）', () => {
  it('过滤掉 SC，返回非 SC 省（当前含 SX）', () => {
    const codes = nonScBranchCodes();
    expect(codes).not.toContain('SC');
    expect(codes).toContain('SX');
  });
});

describe('BRANCH_PUBLISH_DOMAINS', () => {
  it('含 premium / claims_detail / repair（对应上游 01签单/05理赔/03维修）', () => {
    expect([...BRANCH_PUBLISH_DOMAINS]).toEqual(['premium', 'claims_detail', 'repair']);
  });
});

describe('buildBranchEtlSteps（分省逐域命令生成，闸-1 B2）', () => {
  it('默认：每个非 SC 省 × 核心域', () => {
    const steps = buildBranchEtlSteps();
    expect(steps.length).toBe(nonScBranchCodes().length * BRANCH_PUBLISH_DOMAINS.length);
  });
  it('🔴 SC 不在 steps（SC 走原默认链路，字节安全）', () => {
    const steps = buildBranchEtlSteps();
    expect(steps.every((s) => s.env.BRANCH_CODE !== 'SC')).toBe(true);
  });
  it('每个 step 带 BRANCH_CODE + BRANCH_PUBLISH=1 env + 逐域参数', () => {
    const steps = buildBranchEtlSteps(['SX'], ['claims_detail']);
    expect(steps).toHaveLength(1);
    expect(steps[0].env).toEqual({ BRANCH_CODE: 'SX', BRANCH_PUBLISH: '1' });
    expect(steps[0].args).toEqual(['数据管理/daily.mjs', 'claims_detail', '--no-sync', '--skip-report']);
    expect(steps[0].label).toBe('ETL:SX:claims_detail');
  });
  it('逐域（非 daily.mjs all）—— 每域独立 step（因非 SC premium 跑完 return 跳过 all 追加域）', () => {
    const steps = buildBranchEtlSteps(['SX'], ['premium', 'claims_detail']);
    expect(steps.map((s) => s.args[1])).toEqual(['premium', 'claims_detail']);
  });
  it('空省列表 → 空 steps（无非 SC 省时不追加分省发布）', () => {
    expect(buildBranchEtlSteps([], BRANCH_PUBLISH_DOMAINS)).toEqual([]);
  });
  it('多省 × 多域 笛卡尔积', () => {
    const steps = buildBranchEtlSteps(['SX', 'GD'], ['premium', 'claims_detail']);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.label)).toEqual([
      'ETL:SX:premium', 'ETL:SX:claims_detail', 'ETL:GD:premium', 'ETL:GD:claims_detail',
    ]);
  });
});
