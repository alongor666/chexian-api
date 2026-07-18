import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  DEFAULT_WINDOW,
  DEFAULT_MAX_ATTEMPTS,
  isValidHHMM,
  decideTickAction,
  nextState,
  computeConsecutiveMissedDays,
  selectBatchState,
  mergeBatchState,
} from '../数据管理/lib/auto-release-decision.mjs';
// @ts-expect-error — 纯 JS 模块
import { EARLY_BATCH, LATE_BATCH } from '../数据管理/lib/release-batches.mjs';

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

  it('跨天（相邻一天）且昨天不是 released → +1（连续多日未发布累加）', () => {
    const prevState = { beijingDay: YESTERDAY, status: 'missed', consecutiveMissedDays: 1 };
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: TODAY2, prevState })).toBe(2);
  });

  it('🔴 跨越多天的真实间隔（Mac 睡眠/关机导致 launchd 数天未触发）→ 按实际天数累加，非固定 +1', () => {
    // 上次记录停在 07-01（missed），watcher 因 Mac 睡眠一直没触发，直到 07-05 才又跑起来——
    // 07-02/03/04 这 3 天虽无 tick 记录，但显然也都没有成功发布，真实滞后是 4 天而非 1 天。
    const prevState = { beijingDay: '2026-07-01', status: 'missed', consecutiveMissedDays: 0 };
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: '2026-07-05', prevState })).toBe(4);
  });

  it('多天间隔叠加历史计数：昨天已经是第 3 天没发布，又跳过 2 天才恢复 tick', () => {
    const prevState = { beijingDay: '2026-07-01', status: 'missed', consecutiveMissedDays: 2 };
    // 07-01 → 07-04 相差 3 天，累加到已有的 2 天历史上
    expect(computeConsecutiveMissedDays('failed', { todayBeijing: '2026-07-04', prevState })).toBe(5);
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

describe('批次状态读写（🔴 双批发布：早批 released 不得让晚批被幂等跳过）', () => {
  it('selectBatchState 从 batches schema 取该批 slice；缺该批 → null', () => {
    const full = {
      beijingDay: TODAY,
      batches: {
        early: { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 },
      },
    };
    expect(selectBatchState(full, 'early')).toMatchObject({ status: 'released', beijingDay: TODAY });
    expect(selectBatchState(full, 'late')).toBeNull(); // 晚批今天尚未跑过
    expect(selectBatchState(null, 'early')).toBeNull();
  });

  it('🔴 早批 released 时晚批仍 probe（互不干扰，正是拆批的核心目的）', () => {
    // 早批已成功；同一状态文件里晚批无 slice → 晚批照常探测发布
    let full = mergeBatchState(null, 'early',
      nextState('released', { todayBeijing: TODAY, prevState: null, nowISO: 't1' }));
    const earlyDecision = decideTickAction({
      ...base, state: selectBatchState(full, 'early'), nowHHMM: '13:00',
    });
    const lateDecision = decideTickAction({
      ...base, state: selectBatchState(full, 'late'), nowHHMM: '13:00',
    });
    expect(earlyDecision.action).toBe('skip');  // 早批幂等跳过
    expect(lateDecision.action).toBe('probe');  // 晚批照常探测（不被早批幂等波及）
  });

  it('mergeBatchState 保留兄弟批 slice，不互相覆盖', () => {
    let full = mergeBatchState(null, 'early',
      nextState('released', { todayBeijing: TODAY, prevState: null, nowISO: 't1' }));
    full = mergeBatchState(full, 'late',
      nextState('failed', { todayBeijing: TODAY, prevState: null, nowISO: 't2' }));
    expect(full.batches.early.status).toBe('released'); // 早批未被晚批写入覆盖
    expect(full.batches.late.status).toBe('failed');
  });

  it('批次 slice 各自跨天独立（早批今天、晚批昨天 → 晚批判为跨天从头）', () => {
    const full = {
      beijingDay: TODAY,
      batches: {
        early: { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 },
        late: { beijingDay: '2026-07-04', status: 'missed', attempts: 0, consecutiveMissedDays: 2 },
      },
    };
    // 晚批 slice 的 beijingDay 是昨天 → decideTickAction 视为跨天，窗口内 probe（attempts 归零）
    expect(decideTickAction({ ...base, state: selectBatchState(full, 'late'), nowHHMM: '13:00' }).action).toBe('probe');
  });

  it('🔴 旧扁平 schema 向后兼容：当作早批延续读一次，晚批从零起', () => {
    const legacy = { beijingDay: TODAY, status: 'failed', attempts: 3, consecutiveMissedDays: 0 };
    const early = selectBatchState(legacy, EARLY_BATCH.id);
    expect(early).toMatchObject({ status: 'failed', attempts: 3, beijingDay: TODAY });
    expect(selectBatchState(legacy, LATE_BATCH.id)).toBeNull(); // 旧 schema 无晚批概念
  });

  it('round-trip：merge 后 select 回来的 slice 可作为下一次 nextState 的 prevState 累加 attempts', () => {
    let full = mergeBatchState(null, 'early',
      nextState('failed', { todayBeijing: TODAY, prevState: null, nowISO: 't1' }));
    const prev = selectBatchState(full, 'early');
    expect(prev.attempts).toBe(1);
    full = mergeBatchState(full, 'early',
      nextState('released', { todayBeijing: TODAY, prevState: prev, nowISO: 't2' }));
    expect(full.batches.early).toMatchObject({ status: 'released', attempts: 2 });
  });
});
