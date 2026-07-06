/**
 * check-merged-drift 误报压制判定（drift-dismissal.mjs）单测
 *
 * 背景：漂移检测启发式会命中「记账/引用」类提交（2026-07-06 逐条权威核实当轮 6 条
 * 命中全部误报，且 note 登记「系误报」后复跑仍原样再报——先例 b714a7 的 PR #874）。
 * 压制必须精确到 (uid, 提交) 对：点名的 SHA/PR 跳过，同 uid 新的不同实现提交仍上报。
 */
import { describe, it, expect } from 'vitest';
import {
  extractDismissals,
  isDismissed,
  partitionByDismissal,
} from '../scripts/backlog/drift-dismissal.mjs';

// 真实误报形态取材：b714a7 命中 PR #874 squash 提交与其分支提交
const SQUASH_874 = {
  hash: '3b8d82cf00000000000000000000000000000000',
  subject: 'fix(security): 安全审计 M2 落地 SPA CSP 基线 + 5 项发现登记 BACKLOG (#874)',
};
const BRANCH_874 = {
  hash: '98d73afb00000000000000000000000000000000',
  subject: 'fix(security): 安全审计 M2 落地 SPA CSP 基线 + 5 项发现登记 BACKLOG',
};
const NEW_IMPL = {
  hash: 'aaefd48c00000000000000000000000000000000',
  subject: 'feat(diagnose): 落地 diagnose-* skills HTML 转义 (#999)',
};

describe('extractDismissals — 压制声明提取', () => {
  it('含「系误报」且点名 PR 号的 note 构成压制声明', () => {
    const notes = ['check-merged-drift 命中 PR #874 系误报：该 PR 未动 diagnose-* skills HTML 转义，保持 PROPOSED'];
    const d = extractDismissals(notes);
    expect(d).toHaveLength(1);
    expect(d[0].prs).toEqual(['874']);
    expect(d[0].shas).toEqual([]);
  });

  it('含「系误报」且点名 ≥7 位短 SHA 的 note 构成压制声明', () => {
    const d = extractDismissals(['check-merged-drift 命中 98d73afb 系误报：仅记账/引用，未实现']);
    expect(d).toHaveLength(1);
    expect(d[0].shas).toEqual(['98d73afb']);
  });

  it('一条 note 可同时点名多个 SHA 与 PR 号', () => {
    const d = extractDismissals(['命中 2adc3011 / 98d73afb 及 PR #874 系误报：核实为记账']);
    expect(d[0].shas).toEqual(['2adc3011', '98d73afb']);
    expect(d[0].prs).toEqual(['874']);
  });

  it('无「系误报」标记的 note 不构成压制声明（哪怕点名了 PR）', () => {
    expect(extractDismissals(['开放 PR #874 处理中，勿重复实现'])).toHaveLength(0);
  });

  it('含标记但未点名任何 SHA/PR 的 note 不构成压制声明（禁止 uid 级全量静音）', () => {
    expect(extractDismissals(['上轮命中系误报，已核实'])).toHaveLength(0);
  });

  it('6 位十六进制是 uid 短后缀长度，不当作提交 SHA', () => {
    const d = extractDismissals(['03f6f0 命中系误报（仅提及 uid，未点名提交）']);
    expect(d).toHaveLength(0);
  });
});

describe('isDismissed — (uid, 提交) 逐对判定', () => {
  const dismissals = extractDismissals([
    'check-merged-drift 命中 PR #874 系误报：仅记账',
    'check-merged-drift 命中 98d73afb 系误报：squash 前分支提交，同上',
  ]);

  it('subject 含被点名 PR 号的 squash 提交被压制', () => {
    expect(isDismissed(SQUASH_874, dismissals)).toBe(true);
  });

  it('note 短 SHA 前缀匹配检测器全 SHA，分支提交（subject 无 PR 号）被压制', () => {
    expect(isDismissed(BRANCH_874, dismissals)).toBe(true);
  });

  it('同 uid 新的不同实现提交（SHA、PR 号均未点名）不被压制', () => {
    expect(isDismissed(NEW_IMPL, dismissals)).toBe(false);
  });

  it('点名 PR 号不误伤其他 PR 的提交', () => {
    const other = { hash: 'deadbeef00', subject: 'fix: 别的修复 (#875)' };
    expect(isDismissed(other, dismissals)).toBe(false);
  });
});

describe('partitionByDismissal — 压制与再报两条路径', () => {
  const notes = ['check-merged-drift 命中 PR #874、98d73afb 系误报：核实为记账/引用，未实现'];

  it('压制路径：已登记误报的候选提交全部进 dismissed，任务不再上报', () => {
    const { kept, dismissed } = partitionByDismissal([SQUASH_874, BRANCH_874], notes);
    expect(kept).toHaveLength(0);
    expect(dismissed.map(c => c.hash)).toEqual([SQUASH_874.hash, BRANCH_874.hash]);
  });

  it('再报路径：同 uid 出现新的不同实现提交时，仅新提交进 kept 继续上报', () => {
    const { kept, dismissed } = partitionByDismissal([SQUASH_874, BRANCH_874, NEW_IMPL], notes);
    expect(kept).toEqual([NEW_IMPL]);
    expect(dismissed).toHaveLength(2);
  });

  it('无压制声明时全部保留（行为与压制机制引入前一致）', () => {
    const { kept, dismissed } = partitionByDismissal([SQUASH_874], []);
    expect(kept).toEqual([SQUASH_874]);
    expect(dismissed).toHaveLength(0);
  });
});
