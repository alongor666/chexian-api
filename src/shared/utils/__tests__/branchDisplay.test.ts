/**
 * 省份显示派生纯函数单测 — 省份身份贯穿 UI（阶段1）
 *
 * 覆盖：字节安全（SC 路径与改动前一致）+ 山西修复 + codex 闸-1 抓到的边界
 * （branchCode 漏配兜底 P0-1 / 精确匹配防误判 P1 / 全国视图语义）。
 */
import { describe, it, expect } from 'vitest';
import {
  BRANCH_LABELS,
  branchLabel,
  branchCompanyName,
  resolveEffectiveBranch,
  isBranchSummaryRow,
} from '../branchDisplay';

describe('BRANCH_LABELS（前端省份映射，与后端 BRANCH_NAMES 镜像）', () => {
  it('含 SC=四川 + SX=山西（山西已上线）', () => {
    expect(BRANCH_LABELS.SC).toBe('四川');
    expect(BRANCH_LABELS.SX).toBe('山西');
  });
});

describe('branchLabel', () => {
  it('SC→四川（字节安全：与改动前一致）', () => {
    expect(branchLabel('SC')).toBe('四川');
  });
  it('SX→山西（修复）', () => {
    expect(branchLabel('SX')).toBe('山西');
  });
  it('ALL / null / undefined → 全国', () => {
    expect(branchLabel('ALL')).toBe('全国');
    expect(branchLabel(null)).toBe('全国');
    expect(branchLabel(undefined)).toBe('全国');
  });
  it('未注册码 → 回落码本身', () => {
    expect(branchLabel('GD')).toBe('GD');
  });
});

describe('branchCompanyName（语义对齐后端 getBranchCompanyName）', () => {
  it('SC→四川分公司（字节安全：与改动前硬编码一致）', () => {
    expect(branchCompanyName('SC')).toBe('四川分公司');
  });
  it('SX→山西分公司（修复山西用户标题）', () => {
    expect(branchCompanyName('SX')).toBe('山西分公司');
  });
  it('ALL / null / undefined → 全国汇总', () => {
    expect(branchCompanyName('ALL')).toBe('全国汇总');
    expect(branchCompanyName(null)).toBe('全国汇总');
    expect(branchCompanyName(undefined)).toBe('全国汇总');
  });
  it('未注册码 → code+分公司', () => {
    expect(branchCompanyName('GD')).toBe('GD分公司');
  });
});

describe('resolveEffectiveBranch（当前有效省解析）', () => {
  it('超管显式切省优先', () => {
    expect(
      resolveEffectiveBranch({ selectedBranch: 'SX', branchCode: 'SC', branches: ['SC', 'SX'] }),
    ).toBe('SX');
  });
  it('未切省 → 用户本省 branchCode', () => {
    expect(resolveEffectiveBranch({ selectedBranch: null, branchCode: 'SX', branches: [] })).toBe('SX');
  });
  it('四川单省用户 branchCode=SC → SC（字节安全核心）', () => {
    expect(resolveEffectiveBranch({ selectedBranch: null, branchCode: 'SC', branches: [] })).toBe('SC');
  });
  it('codex P0-1：branchCode 漏配但单可见省 → 回落该省（防四川回归）', () => {
    expect(
      resolveEffectiveBranch({ selectedBranch: null, branchCode: undefined, branches: ['SC'] }),
    ).toBe('SC');
  });
  it('显式切到全国合并视图 ALL → ALL', () => {
    expect(
      resolveEffectiveBranch({ selectedBranch: 'ALL', branchCode: 'SC', branches: ['SC', 'SX'] }),
    ).toBe('ALL');
  });
  it('完全无省份信息（系统超管看全部）→ null', () => {
    expect(resolveEffectiveBranch({ selectedBranch: null, branchCode: null, branches: [] })).toBeNull();
  });
});

describe('isBranchSummaryRow（汇总行识别：精确匹配防误判）', () => {
  const sc = branchCompanyName('SC'); // 四川分公司
  const sx = branchCompanyName('SX'); // 山西分公司

  it('SC 视角识别「四川分公司」汇总行（与改动前 /四川分公司/ 等价）', () => {
    expect(isBranchSummaryRow('四川分公司', sc)).toBe(true);
  });
  it('SX 视角识别「山西分公司」汇总行（修复）', () => {
    expect(isBranchSummaryRow('山西分公司', sx)).toBe(true);
  });
  it('通用关键字（合计/汇总/全部/整体/全国汇总）始终识别', () => {
    expect(isBranchSummaryRow('合计', sc)).toBe(true);
    expect(isBranchSummaryRow('汇总', sc)).toBe(true);
    expect(isBranchSummaryRow('全部', sc)).toBe(true);
    expect(isBranchSummaryRow('整体', sc)).toBe(true);
    expect(isBranchSummaryRow('全国汇总', sc)).toBe(true); // 含「汇总」
  });
  it('真实机构名不误判为汇总行', () => {
    for (const org of ['乐山', '天府', '高新', '太原一部', '经代、车商、重客']) {
      expect(isBranchSummaryRow(org, sc)).toBe(false);
    }
  });
  it('codex P1：名为「XX分公司」的假想机构不被误判（精确匹配已知省，胜过含「分公司」通配）', () => {
    expect(isBranchSummaryRow('成都分公司', sc)).toBe(false); // 成都非已知省
    expect(isBranchSummaryRow('成都分公司')).toBe(false); // 不传 companyName 也不误判
  });
  it('不传 companyName 时靠已知省集合识别任意省分公司（全国超管 ALL 多省视角）', () => {
    expect(isBranchSummaryRow('四川分公司')).toBe(true);
    expect(isBranchSummaryRow('山西分公司')).toBe(true);
    expect(isBranchSummaryRow('全国汇总')).toBe(true);
  });
  it('null/空名 + 空 companyName 安全', () => {
    expect(isBranchSummaryRow(null, sc)).toBe(false);
    expect(isBranchSummaryRow('天府', '')).toBe(false);
    expect(isBranchSummaryRow('合计', '')).toBe(true); // 通用关键字仍生效
  });
});
