import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  BRANCH_PUBLISH_DOMAINS,
  nonScBranchCodes,
  buildBranchEtlSteps,
  shouldEnableValidationBranchSync,
} from '../数据管理/lib/branch-publish.mjs';

describe('nonScBranchCodes（非 SC 注册省·数据驱动单一来源）', () => {
  it('过滤掉 SC，返回非 SC 省（当前含 SX）', () => {
    const codes = nonScBranchCodes();
    expect(codes).not.toContain('SC');
    expect(codes).toContain('SX');
  });
});

describe('BRANCH_PUBLISH_DOMAINS', () => {
  it('含 premium / claims_detail / quotes / repair / renewal_tracker（01签单/05理赔/02报价/03维修 + 续保追踪派生域）', () => {
    expect([...BRANCH_PUBLISH_DOMAINS]).toEqual(['premium', 'claims_detail', 'quotes', 'repair', 'renewal_tracker']);
  });
  it('🔴 renewal_tracker 必须排在 premium 与 quotes 之后（派生域依赖本省 policy + quotes_conversion 当日产物）', () => {
    const order = [...BRANCH_PUBLISH_DOMAINS];
    expect(order.indexOf('renewal_tracker')).toBeGreaterThan(order.indexOf('premium'));
    expect(order.indexOf('renewal_tracker')).toBeGreaterThan(order.indexOf('quotes'));
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

describe('shouldEnableValidationBranchSync（release:daily 携带山西派生域同步的判定，2026-07-07）', () => {
  it('分省 ETL 在编排内 + 未显式设 env → 携带（山西派生域随日常发布同步，不再停更）', () => {
    expect(shouldEnableValidationBranchSync({
      explicitEnv: undefined, branchStepCount: 4, fullSnapshotDomainCount: 0,
    })).toBe(true);
  });
  it('操作者显式设置 env（含 "0"）→ 尊重显式值，发布链不注入（人工关闭出口）', () => {
    for (const v of ['0', '1', 'false', 'yes']) {
      expect(shouldEnableValidationBranchSync({
        explicitEnv: v, branchStepCount: 4, fullSnapshotDomainCount: 0,
      })).toBe(false);
    }
  });
  it('空字符串 env 视同未设置 → 携带', () => {
    expect(shouldEnableValidationBranchSync({
      explicitEnv: '', branchStepCount: 4, fullSnapshotDomainCount: 0,
    })).toBe(true);
  });
  it('full_snapshot 单域模式 → 不携带（该模式不跑分省 ETL，validation 产物未必新鲜）', () => {
    expect(shouldEnableValidationBranchSync({
      explicitEnv: undefined, branchStepCount: 4, fullSnapshotDomainCount: 1,
    })).toBe(false);
  });
  it('🔴 无注册非 SC 省（分省步骤为空）→ 不携带（单省时代行为逐字节一致）', () => {
    expect(shouldEnableValidationBranchSync({
      explicitEnv: undefined, branchStepCount: 0, fullSnapshotDomainCount: 0,
    })).toBe(false);
  });
});
