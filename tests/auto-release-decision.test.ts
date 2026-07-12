import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  DEFAULT_WINDOW,
  DEFAULT_MAX_ATTEMPTS,
  isValidHHMM,
  decideTickAction,
  nextState,
  computeConsecutiveMissedDays,
} from '../数据管理/lib/auto-release-decision.mjs';

const TODAY = '2026-07-05';
const base = { todayBeijing: TODAY, window: DEFAULT_WINDOW, maxAttempts: DEFAULT_MAX_ATTEMPTS };

describe('isValidHHMM', () => {
  it('合法/非法格式', () => {
    expect(isValidHHMM('10:35')).toBe(true);
    expect(isValidHHMM('23:59')).toBe(true);
    expect(isValidHHMM('24:00')).toBe(false);
    expect(isValidHHMM('9:5')).toBe(false);
    expect(isValidHHMM(undefined)).toBe(false);
  });
});

describe('decideTickAction（窗口 × 当日状态机）', () => {
  it('窗口前 → skip', () => {
    const d = decideTickAction({ ...base, state: null, nowHHMM: '09:00' });
    expect(d.action).toBe('skip');
  });

  it('窗口内无状态 → probe', () => {
    expect(decideTickAction({ ...base, state: null, nowHHMM: '10:35' }).action).toBe('probe');
    expect(decideTickAction({ ...base, state: null, nowHHMM: '19:59' }).action).toBe('probe');
  });

  it('🔴 窗口结束仍未成功 → mark-missed（告警，禁止默默不发布）', () => {
    const d = decideTickAction({ ...base, state: null, nowHHMM: DEFAULT_WINDOW.end });
    expect(d.action).toBe('mark-missed');
  });

  it('🔴 当天已 released → 全天幂等跳过（含窗口内与 --once）', () => {
    const state = { beijingDay: TODAY, status: 'released', attempts: 1 };
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00', once: true }).action).toBe('skip');
  });

  it('昨天的 released 状态不影响今天（跨天重置）', () => {
    const state = { beijingDay: '2026-07-04', status: 'released', attempts: 1 };
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00' }).action).toBe('probe');
  });

  it('failed 且未达上限 → 窗口内继续 probe 重试', () => {
    const state = { beijingDay: TODAY, status: 'failed', attempts: 1 };
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00' }).action).toBe('probe');
  });

  it('🔴 failed 达上限 → skip 停手等人工（--once 也不放行，防手抖连发）', () => {
    const state = { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MAX_ATTEMPTS };
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state, nowHHMM: '11:00', once: true }).action).toBe('skip');
  });

  it('missed 后当天不再自动尝试；--once 可人工放行', () => {
    const state = { beijingDay: TODAY, status: 'missed', attempts: 0 };
    expect(decideTickAction({ ...base, state, nowHHMM: '15:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state, nowHHMM: '15:00', once: true }).action).toBe('probe');
  });

  it('--once 跳过窗口判断（窗口前也 probe）', () => {
    expect(decideTickAction({ ...base, state: null, nowHHMM: '08:00', once: true }).action).toBe('probe');
  });
});

describe('nextState（状态迁移纯函数）', () => {
  it('released/failed 消耗尝试次数；跨天从 0 起算', () => {
    const s1 = nextState('failed', { todayBeijing: TODAY, prevState: null, nowISO: 't1' });
    expect(s1).toMatchObject({ beijingDay: TODAY, status: 'failed', attempts: 1 });
    const s2 = nextState('released', { todayBeijing: TODAY, prevState: s1, nowISO: 't2' });
    expect(s2.attempts).toBe(2);
    const s3 = nextState('failed', { todayBeijing: '2026-07-06', prevState: s2, nowISO: 't3' });
    expect(s3.attempts).toBe(1);
  });

  it('missed 是终态标记，不计尝试', () => {
    const prev = { beijingDay: TODAY, status: 'failed', attempts: 1 };
    const s = nextState('missed', { todayBeijing: TODAY, prevState: prev, nowISO: 't' });
    expect(s.attempts).toBe(1);
    expect(s.status).toBe('missed');
  });
});

describe('computeConsecutiveMissedDays（🔴 告警升级依据 — 单日故障只告警一次容易被忽略，2026-07-12）', () => {
  const YESTERDAY = '2026-07-04';
  const TODAY2 = '2026-07-05';

  it('released → 归零，不管之前多少天没发布', () => {
    const prevState = { beijingDay: YESTERDAY, status: 'missed', consecutiveMissedDays: 3 };
    expect(computeConsecutiveMissedDays('released', { todayBeijing: TODAY2, prevState })).toBe(0);
  });

  it('同一天内多次 failed/missed 不重复计数', () => {
    const prevState = { beijingDay: TODAY2, status: 'failed', consecutiveMissedDays: 1 };
    expect(computeConsecutiveMissedDays('missed', { todayBeijing: TODAY2, prevState })).toBe(1);
  });

  it('跨天且昨天是 released → 全新一天出问题，从 0 起算', () => {
    const prevState = { beijingDay: YESTERDAY, status: 'released', consecutiveMissedDays: 0 };
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: TODAY2, prevState })).toBe(0);
  });

  it('跨天且昨天不是 released → +1（连续多日未发布累加）', () => {
    const prevState = { beijingDay: YESTERDAY, status: 'missed', consecutiveMissedDays: 1 };
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: TODAY2, prevState })).toBe(2);
  });

  it('无历史状态（首次运行）→ 0', () => {
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: TODAY2, prevState: null })).toBe(0);
  });

  it('nextState 透传 consecutiveMissedDays 字段', () => {
    const s1 = nextState('missed', { todayBeijing: YESTERDAY, prevState: null, nowISO: 't1' });
    expect(s1.consecutiveMissedDays).toBe(0);
    const s2 = nextState('missed', { todayBeijing: TODAY2, prevState: s1, nowISO: 't2' });
    expect(s2.consecutiveMissedDays).toBe(1); // 昨天也是 missed，跨天 +1
    const s3 = nextState('released', { todayBeijing: '2026-07-06', prevState: s2, nowISO: 't3' });
    expect(s3.consecutiveMissedDays).toBe(0); // 今天成功，归零
  });
});
