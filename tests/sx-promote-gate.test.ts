/**
 * SX 自动晋升安全闸单测（数据管理/lib/sx-promote-gate.mjs）
 *
 * 锁定 evaluateSxAutoPromoteReadiness 三态：
 *   - 本地无 validation/SX/ → skip（纯 SC 场景零行为变化）
 *   - RLS 实时核实为 true → promote
 *   - RLS 实时核实为 false / 查询失败（null）→ block（安全默认拒绝，fail-closed）
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明
import { evaluateSxAutoPromoteReadiness } from '../数据管理/lib/sx-promote-gate.mjs';

describe('evaluateSxAutoPromoteReadiness', () => {
  it('本地无 validation/SX 目录 → skip，不因 RLS 状态而变', () => {
    expect(evaluateSxAutoPromoteReadiness({ validationSxExists: false, rlsEnabled: true }).verdict).toBe('skip');
    expect(evaluateSxAutoPromoteReadiness({ validationSxExists: false, rlsEnabled: false }).verdict).toBe('skip');
    expect(evaluateSxAutoPromoteReadiness({ validationSxExists: false, rlsEnabled: null }).verdict).toBe('skip');
  });

  it('存在 validation/SX 且 RLS 实时核实为 true → promote', () => {
    const r = evaluateSxAutoPromoteReadiness({ validationSxExists: true, rlsEnabled: true });
    expect(r.verdict).toBe('promote');
    expect(r.reason).toContain('BRANCH_RLS_ENABLED=true');
  });

  it('存在 validation/SX 且 RLS 实时核实为 false（非查询失败）→ block，原因区分"已核实关闭"', () => {
    const r = evaluateSxAutoPromoteReadiness({ validationSxExists: true, rlsEnabled: false });
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('BRANCH_RLS_ENABLED=false');
    expect(r.reason).toContain('已实时核实，非查询失败');
  });

  it('存在 validation/SX 且 RLS 查询失败（null）→ block，安全默认拒绝，原因区分"查询失败"', () => {
    const r = evaluateSxAutoPromoteReadiness({ validationSxExists: true, rlsEnabled: null });
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('查询失败');
  });

  it('block 分支的 reason 均指向人工兜底命令，便于运维直接照抄', () => {
    const falseCase = evaluateSxAutoPromoteReadiness({ validationSxExists: true, rlsEnabled: false });
    const nullCase = evaluateSxAutoPromoteReadiness({ validationSxExists: true, rlsEnabled: null });
    expect(falseCase.reason).toContain('sx-promote.mjs --apply --rls-confirmed');
    expect(nullCase.reason).toContain('sx-promote.mjs --apply --rls-confirmed');
  });
});
