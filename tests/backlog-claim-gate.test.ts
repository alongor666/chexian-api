/**
 * claim / release 状态转移判定（claim-gate.mjs）单测
 *
 * 背景：spawn_task 派发任务卡与 backlog 状态互不联动 —— PROPOSED 任务被派发后看板无痕迹，
 * 别的 Agent 会重复认领撞车（实证：2026-07-10 山西维修域 2815e4 已有 Agent 在做仍被重复 spawn）。
 * claim = 派发即登记（置 DOING + owner），已认领则 fail-closed 拒绝。本测锁死转移规则两条路径。
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateClaim,
  evaluateRelease,
  CLAIM_BLOCKED_ACTIVE,
} from '../scripts/backlog/claim-gate.mjs';

const TERMINAL = ['DONE', 'CANCELLED', 'WONTFIX'];
const task = (status: string, owner = '') => ({ status, owner, uid: '2026-07-10-claude-abc123' });

describe('evaluateClaim — 派发认领判定（防重复派发核心闸）', () => {
  it('可认领态（PROPOSED/TRIAGED/PARTIAL/BLOCKED/TODO）一律放行', () => {
    for (const s of ['PROPOSED', 'TRIAGED', 'PARTIAL', 'BLOCKED', 'TODO']) {
      expect(evaluateClaim(task(s), TERMINAL).allowed).toBe(true);
    }
  });

  it('已 DOING（已被认领）→ 拒绝，code=already-claimed，reason 带 owner', () => {
    const v = evaluateClaim(task('DOING', '另一 Agent'), TERMINAL);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe('already-claimed');
    expect(v.reason).toContain('另一 Agent');
  });

  it('已 IN_PROGRESS（实质在做）→ 拒绝，code=already-claimed', () => {
    const v = evaluateClaim(task('IN_PROGRESS'), TERMINAL);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe('already-claimed');
  });

  it('终态（DONE/CANCELLED/WONTFIX）→ 拒绝，code=terminal', () => {
    for (const s of TERMINAL) {
      const v = evaluateClaim(task(s), TERMINAL);
      expect(v.allowed).toBe(false);
      expect(v.code).toBe('terminal');
    }
  });

  it('task 为空 → 拒绝，code=no-task（不抛异常）', () => {
    const v = evaluateClaim(null, TERMINAL);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe('no-task');
  });

  it('CLAIM_BLOCKED_ACTIVE 恰好锁定 DOING + IN_PROGRESS 两态（防未来误扩）', () => {
    expect([...CLAIM_BLOCKED_ACTIVE].sort()).toEqual(['DOING', 'IN_PROGRESS']);
  });
});

describe('evaluateRelease — 撤回认领判定', () => {
  it('DOING（claim 产生态）→ 放行', () => {
    expect(evaluateRelease(task('DOING')).allowed).toBe(true);
  });

  it('非 DOING（含 IN_PROGRESS/PARTIAL/PROPOSED）→ 拒绝，code=not-doing', () => {
    for (const s of ['IN_PROGRESS', 'PARTIAL', 'PROPOSED', 'BLOCKED', 'DONE']) {
      const v = evaluateRelease(task(s));
      expect(v.allowed).toBe(false);
      expect(v.code).toBe('not-doing');
    }
  });

  it('task 为空 → 拒绝，code=no-task', () => {
    expect(evaluateRelease(null).code).toBe('no-task');
  });
});
