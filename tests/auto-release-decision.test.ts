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
  unmetDependencies,
  selectBatchProvinceState,
  mergeBatchProvinceState,
  unmetProvinceDependencies,
  selectBatchGapAlertDay,
  withBatchGapAlertDay,
  planProvinceReleases,
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

  it('🔴 P1-3：旧扁平 released → 先写 late 时早批幂等记录不丢（否则早批被重复发布）', () => {
    // 旧扁平 schema：今天已 released（单批时代）。升级后晚批首次写入 batches。
    const legacy = { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 };
    const merged = mergeBatchState(legacy, 'late',
      nextState('released', { todayBeijing: TODAY, prevState: null, nowISO: 't' }));
    // 早批 slice 必须被物化保留（= 迁移自旧扁平态），否则 select 回 null → 早批当没跑过重复发布
    const early = selectBatchState(merged, 'early');
    expect(early).not.toBeNull();
    expect(early).toMatchObject({ status: 'released', beijingDay: TODAY });
    expect(merged.batches.late.status).toBe('released');
  });

  it('P1-3：旧扁平态首写 early 时，目标 slice 覆盖迁移种子（不重复/不冲突）', () => {
    const legacy = { beijingDay: TODAY, status: 'failed', attempts: 2, consecutiveMissedDays: 0 };
    const merged = mergeBatchState(legacy, 'early',
      nextState('released', { todayBeijing: TODAY, prevState: selectBatchState(legacy, 'early'), nowISO: 't' }));
    // early 用新结果（released, attempts=3=2+1），不是迁移种子的 failed
    expect(merged.batches.early).toMatchObject({ status: 'released', attempts: 3 });
  });
});

describe('unmetDependencies（🔴 P1-2：晚批依赖早批 fail-closed）', () => {
  it('早批今日 released → 晚批依赖满足（[]）', () => {
    const full = { beijingDay: TODAY, batches: { early: { beijingDay: TODAY, status: 'released', attempts: 1 } } };
    expect(unmetDependencies(LATE_BATCH, full, TODAY)).toEqual([]);
  });

  it('早批今日 failed → 晚批依赖未满足（[early]）', () => {
    const full = { beijingDay: TODAY, batches: { early: { beijingDay: TODAY, status: 'failed', attempts: 6 } } };
    expect(unmetDependencies(LATE_BATCH, full, TODAY)).toEqual(['early']);
  });

  it('早批昨日 released（非今天）→ 晚批依赖未满足', () => {
    const full = { beijingDay: '2026-07-04', batches: { early: { beijingDay: '2026-07-04', status: 'released', attempts: 1 } } };
    expect(unmetDependencies(LATE_BATCH, full, TODAY)).toEqual(['early']);
  });

  it('早批今日未跑（无 slice）→ 晚批依赖未满足', () => {
    expect(unmetDependencies(LATE_BATCH, { beijingDay: TODAY, batches: {} }, TODAY)).toEqual(['early']);
    expect(unmetDependencies(LATE_BATCH, null, TODAY)).toEqual(['early']);
  });

  it('早批无前置依赖 → 永远满足（[]）', () => {
    expect(unmetDependencies(EARLY_BATCH, null, TODAY)).toEqual([]);
  });
});

describe('逐省状态读写（🔴 B255：批次 × 省 × 天 幂等——已发省不因另一省补齐而重发）', () => {
  const relSlice = (day = TODAY) => nextState('released', { todayBeijing: day, prevState: null, nowISO: 't' });
  const failSlice = (day = TODAY) => nextState('failed', { todayBeijing: day, prevState: null, nowISO: 't' });

  it('selectBatchProvinceState 读 v3 provinces 子图；缺该省 → null', () => {
    const full = {
      beijingDay: TODAY,
      batches: { early: { provinces: { SX: { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 } } } },
    };
    expect(selectBatchProvinceState(full, 'early', 'SX')).toMatchObject({ status: 'released', beijingDay: TODAY });
    expect(selectBatchProvinceState(full, 'early', 'SC')).toBeNull(); // 四川该批今天尚未跑
    expect(selectBatchProvinceState(full, 'late', 'SX')).toBeNull();
    expect(selectBatchProvinceState(null, 'early', 'SX')).toBeNull();
  });

  it('🔴 核心：山西早批 released 后、四川补齐时山西 slice 不被覆盖（decideTickAction 对山西仍 skip）', () => {
    // 山西先就绪先发
    let full = mergeBatchProvinceState(null, 'early', 'SX', relSlice());
    // 四川此刻上游还没到，四川无 slice → 探测；山西已 released → 幂等跳过（用窗口内时刻 11:00）
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(full, 'early', 'SX'), nowHHMM: '11:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(full, 'early', 'SC'), nowHHMM: '11:00' }).action).toBe('probe');
    // 四川恢复后补齐：写四川 released
    full = mergeBatchProvinceState(full, 'early', 'SC', relSlice());
    // 山西 slice 必须原样保留（released），绝不因四川补齐而被判为"没跑过"重发
    expect(selectBatchProvinceState(full, 'early', 'SX')).toMatchObject({ status: 'released', beijingDay: TODAY });
    expect(selectBatchProvinceState(full, 'early', 'SC')).toMatchObject({ status: 'released', beijingDay: TODAY });
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(full, 'early', 'SX'), nowHHMM: '13:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(full, 'early', 'SC'), nowHHMM: '13:00' }).action).toBe('skip');
  });

  it('省与批交叉独立：早批 SC released、晚批 SX failed 互不覆盖', () => {
    let full = mergeBatchProvinceState(null, 'early', 'SC', relSlice());
    full = mergeBatchProvinceState(full, 'late', 'SX', failSlice());
    expect(full.batches.early.provinces.SC.status).toBe('released');
    expect(full.batches.late.provinces.SX.status).toBe('failed');
    expect(selectBatchProvinceState(full, 'early', 'SX')).toBeNull();
  });

  it('round-trip：merge 后 select 回来可作为下一次 nextState 的 prevState 累加 attempts', () => {
    let full = mergeBatchProvinceState(null, 'early', 'SC', failSlice());
    const prev = selectBatchProvinceState(full, 'early', 'SC');
    expect(prev.attempts).toBe(1);
    full = mergeBatchProvinceState(full, 'early', 'SC',
      nextState('released', { todayBeijing: TODAY, prevState: prev, nowISO: 't2' }));
    expect(full.batches.early.provinces.SC).toMatchObject({ status: 'released', attempts: 2 });
  });

  it('🔴 v2 扁平批 slice 迁移：旧「整批 released」被读作每个省的延续（各省都 skip）', () => {
    const v2 = { beijingDay: TODAY, batches: { early: { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 } } };
    expect(selectBatchProvinceState(v2, 'early', 'SC')).toMatchObject({ status: 'released' });
    expect(selectBatchProvinceState(v2, 'early', 'SX')).toMatchObject({ status: 'released' });
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(v2, 'early', 'SC'), nowHHMM: '10:00' }).action).toBe('skip');
    expect(decideTickAction({ ...base, state: selectBatchProvinceState(v2, 'early', 'SX'), nowHHMM: '10:00' }).action).toBe('skip');
  });

  it('🔴 v1 顶层扁平迁移：旧 released + 首写晚批某省 → 早批幂等不丢（各省仍读到 released）', () => {
    const v1 = { beijingDay: TODAY, status: 'released', attempts: 1, consecutiveMissedDays: 0 };
    const merged = mergeBatchProvinceState(v1, 'late', 'SX', relSlice());
    expect(selectBatchProvinceState(merged, 'early', 'SC')).toMatchObject({ status: 'released' });
    expect(selectBatchProvinceState(merged, 'early', 'SX')).toMatchObject({ status: 'released' });
    expect(merged.batches.late.provinces.SX.status).toBe('released');
  });

  it('🔴 unmetProvinceDependencies：晚批某省依赖早批同省 released', () => {
    // 早批 SC released、SX 未发 → 晚批 SC 依赖满足，晚批 SX 依赖未满足
    const full = mergeBatchProvinceState(null, 'early', 'SC', relSlice());
    expect(unmetProvinceDependencies(LATE_BATCH, full, TODAY, 'SC')).toEqual([]);
    expect(unmetProvinceDependencies(LATE_BATCH, full, TODAY, 'SX')).toEqual(['early']);
    // 早批 SX 昨天 released（非今天）→ 晚批 SX 仍未满足
    const stale = mergeBatchProvinceState(null, 'early', 'SX', relSlice('2026-07-04'));
    expect(unmetProvinceDependencies(LATE_BATCH, stale, TODAY, 'SX')).toEqual(['early']);
    // 早批无前置 → 恒满足
    expect(unmetProvinceDependencies(EARLY_BATCH, null, TODAY, 'SC')).toEqual([]);
  });

  it('🔴 planProvinceReleases 补齐点 willCoverAll：报告/企微是跨省产物，只在两省齐备时产出', () => {
    const PROV = ['SC', 'SX'];
    const relEarly = mergeBatchProvinceState(null, 'early', 'SC', relSlice());

    // 常态：两省同 tick 都就绪 → 全省待发、willCoverAll（= 旧 allTogether）
    const both = planProvinceReleases({
      provinces: PROV, probeProvinces: ['SC', 'SX'], readyProvinces: ['SC', 'SX'],
      batch: EARLY_BATCH, fullState: null, todayBeijing: TODAY,
    });
    expect(both.toRelease.sort()).toEqual(['SC', 'SX']);
    expect(both.staleWaiting).toEqual([]);
    expect(both.willCoverAll).toBe(true);

    // 部分：四川就绪、山西陈旧 → 只发 SC、SX 陈旧、非补齐点（报告不产出，逐省发布）
    const partial = planProvinceReleases({
      provinces: PROV, probeProvinces: ['SC', 'SX'], readyProvinces: ['SC'],
      batch: EARLY_BATCH, fullState: null, todayBeijing: TODAY,
    });
    expect(partial.toRelease).toEqual(['SC']);
    expect(partial.staleWaiting).toEqual(['SX']);
    expect(partial.willCoverAll).toBe(false);

    // 补齐：四川已 released（上一 tick），本 tick 山西恢复就绪 → SX 待发 + SC 已发 = 全省齐 → willCoverAll
    const completing = planProvinceReleases({
      provinces: PROV, probeProvinces: ['SX'], readyProvinces: ['SX'],
      batch: EARLY_BATCH, fullState: relEarly, todayBeijing: TODAY,
    });
    expect(completing.toRelease).toEqual(['SX']);
    expect(completing.willCoverAll).toBe(true); // 关键：不同 tick 补齐也走全量发布刷新报告
  });

  it('🔴 planProvinceReleases 逐省依赖闸：晚批某省依赖早批同省 released，未满足 → depBlocked 非 toRelease', () => {
    const PROV = ['SC', 'SX'];
    // 早批 SC released、SX 未发；晚批两省上游都就绪
    const earlyScOnly = mergeBatchProvinceState(null, 'early', 'SC', relSlice());
    const plan = planProvinceReleases({
      provinces: PROV, probeProvinces: ['SC', 'SX'], readyProvinces: ['SC', 'SX'],
      batch: LATE_BATCH, fullState: earlyScOnly, todayBeijing: TODAY,
    });
    expect(plan.toRelease).toEqual(['SC']);      // 晚批 SC 依赖满足
    expect(plan.depBlocked).toEqual(['SX']);      // 晚批 SX 依赖早批 SX（未 released）→ 暂缓
    expect(plan.willCoverAll).toBe(false);         // SX 未发也非已发 → 非补齐点
    // 应急放行 allowMissingDep → SX 进 toRelease
    const forced = planProvinceReleases({
      provinces: PROV, probeProvinces: ['SC', 'SX'], readyProvinces: ['SC', 'SX'],
      batch: LATE_BATCH, fullState: earlyScOnly, todayBeijing: TODAY, allowMissingDep: true,
    });
    expect(forced.toRelease.sort()).toEqual(['SC', 'SX']);
    expect(forced.depBlocked).toEqual([]);
    expect(forced.willCoverAll).toBe(true);
  });

  it('planProvinceReleases：无省可发（全陈旧）→ willCoverAll=false（不触发空的全量发布）', () => {
    const plan = planProvinceReleases({
      provinces: ['SC', 'SX'], probeProvinces: ['SC', 'SX'], readyProvinces: [],
      batch: EARLY_BATCH, fullState: null, todayBeijing: TODAY,
    });
    expect(plan.toRelease).toEqual([]);
    expect(plan.staleWaiting.sort()).toEqual(['SC', 'SX']);
    expect(plan.willCoverAll).toBe(false);
  });

  it('缺口告警去重标记：withBatchGapAlertDay 写、selectBatchGapAlertDay 读，且保留 provinces 子图', () => {
    let full = mergeBatchProvinceState(null, 'early', 'SX', relSlice());
    expect(selectBatchGapAlertDay(full, 'early')).toBeNull();
    full = withBatchGapAlertDay(full, 'early', TODAY);
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY);
    // 打标记后 provinces 子图不丢
    expect(selectBatchProvinceState(full, 'early', 'SX')).toMatchObject({ status: 'released' });
    // 打标记后仍可继续写省 slice（四川补齐）
    full = mergeBatchProvinceState(full, 'early', 'SC', relSlice());
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY); // gapAlertDay 不被 merge 冲掉
    expect(selectBatchProvinceState(full, 'early', 'SC')).toMatchObject({ status: 'released' });
  });

  it('🔴 缺口告警先于任何省 release：{gapAlertDay} 独占批 slice 时，首个省 release 不丢标记（去重不失效）', () => {
    // watcher 真实顺序：本 tick 先发缺口告警（withBatchGapAlertDay，批 slice 此刻只有 gapAlertDay、无 provinces），
    // 再逐省 release（mergeBatchProvinceState）。若 merge 把只含 gapAlertDay 的批 slice 当空处理，标记会丢 → 下 tick 重发。
    let full = withBatchGapAlertDay(null, 'early', TODAY);
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY);
    full = mergeBatchProvinceState(full, 'early', 'SX', relSlice());
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY); // 关键断言：首个省 release 后标记仍在
    expect(selectBatchProvinceState(full, 'early', 'SX')).toMatchObject({ status: 'released' });
  });

  it('🔴 v2 扁平 slice 上打 gapAlertDay 后首个省 release：标记不被 v2 迁移清空（去重不失效）', () => {
    // 真实迁移日顺序：批 slice 还是 v2 扁平（有 .status），watcher 同一 tick 先 withBatchGapAlertDay
    //（此刻 slice 同时含 .status 与 .gapAlertDay），再 mergeBatchProvinceState 发省。旧实现按 .status
    // 判 v2 扁平→整批清空→gapAlertDay 丢。
    const v2 = { beijingDay: TODAY, batches: { early: { beijingDay: TODAY, status: 'failed', attempts: 2, consecutiveMissedDays: 0 } } };
    let full = withBatchGapAlertDay(v2, 'early', TODAY);
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY);
    full = mergeBatchProvinceState(full, 'early', 'SX', relSlice());
    expect(selectBatchGapAlertDay(full, 'early')).toBe(TODAY); // 关键：v2 扁平迁移不误清 gapAlertDay
    expect(selectBatchProvinceState(full, 'early', 'SX')).toMatchObject({ status: 'released' });
    // v2 扁平标量仍不抬进批级
    expect(full.batches.early.status).toBeUndefined();
  });

  it('v2 扁平批 slice 的扁平字段不污染 v3 批级（迁移只经 select v2 分支读一次即弃）', () => {
    const v2 = { beijingDay: TODAY, batches: { early: { beijingDay: TODAY, status: 'failed', attempts: 3, consecutiveMissedDays: 0 } } };
    const merged = mergeBatchProvinceState(v2, 'early', 'SC', relSlice());
    // 批级只应有 provinces（+ 可能 gapAlertDay），不该把 v2 的 status/attempts 抬到批级
    expect(merged.batches.early.status).toBeUndefined();
    expect(merged.batches.early.attempts).toBeUndefined();
    expect(merged.batches.early.provinces.SC).toMatchObject({ status: 'released' });
    // 兄弟省 SX：v2 扁平已被目标批转成 provinces 结构，SX 读不到 → null（升级当天从零起，可接受）
    expect(selectBatchProvinceState(merged, 'early', 'SX')).toBeNull();
  });
});
