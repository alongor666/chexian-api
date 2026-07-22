import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅发布链内部使用）
import {
  MAY_JUL_RENEWAL_WECOM_LAST_DAY,
  buildWecomTasks,
  filterActiveWecomTasks,
  summarizeWecomFailures,
  evaluateWecomOutcome,
} from '../scripts/lib/wecom-sync-tasks.mjs';
// @ts-expect-error — 纯 JS 模块
import { beijingDayOf } from '../数据管理/lib/bi-export-pull.mjs';
// @ts-expect-error — 纯 JS 模块
import { LATE_BATCH, EARLY_BATCH } from '../数据管理/lib/release-batches.mjs';
// @ts-expect-error — 纯 JS 模块
import { mergeBatchState, unmetDependencies, nextState } from '../数据管理/lib/auto-release-decision.mjs';

const RENEWAL_LABELS = ['WeCom renewal sync', 'WeCom 电销5-7月续保 sync'];
const SIGNING_LABELS = ['WeCom postal sync', 'WeCom 山西邮政 sync', 'WeCom 任卫军台账 sync'];

describe('企微任务清单 SSOT（buildWecomTasks）', () => {
  it('共 5 张表：2 张续保类带停推日 2026-07-31，3 张签单类无停推日', () => {
    const tasks = buildWecomTasks();
    expect(tasks).toHaveLength(5);
    const withRetire = tasks.filter((t: any) => t.retireAfterBeijingDay);
    expect(withRetire.map((t: any) => t.label).sort()).toEqual([...RENEWAL_LABELS].sort());
    expect(withRetire.every((t: any) => t.retireAfterBeijingDay === MAY_JUL_RENEWAL_WECOM_LAST_DAY)).toBe(true);
    const withoutRetire = tasks.filter((t: any) => !t.retireAfterBeijingDay);
    expect(withoutRetire.map((t: any) => t.label).sort()).toEqual([...SIGNING_LABELS].sort());
  });

  it('execute 模式续保 2 表带 --execute、签单 3 表不带 --dry-run；dry-run 模式反之', () => {
    const run = buildWecomTasks({ dryRun: false });
    expect(run[0].args).toContain('--execute');
    expect(run[1].args).toContain('--execute');
    for (const t of run.slice(2)) expect(t.args).not.toContain('--dry-run');
    const dry = buildWecomTasks({ dryRun: true });
    expect(dry[0].args).not.toContain('--execute');
    expect(dry[1].args).not.toContain('--execute');
    for (const t of dry.slice(2)) expect(t.args).toContain('--dry-run');
  });
});

describe('F2 · 到期停推闸（filterActiveWecomTasks，北京时区日期回归锁定）', () => {
  const tasks = buildWecomTasks();

  it('北京 2026-07-31（停推日当天，含）：5 个任务全部保留', () => {
    const { active, retired } = filterActiveWecomTasks(tasks, '2026-07-31');
    expect(active).toHaveLength(5);
    expect(retired).toHaveLength(0);
  });

  it('北京 2026-08-01：只剔除 2 个续保任务，3 个签单任务继续', () => {
    const { active, retired } = filterActiveWecomTasks(tasks, '2026-08-01');
    expect(active.map((t: any) => t.label).sort()).toEqual([...SIGNING_LABELS].sort());
    expect(retired.map((t: any) => t.label).sort()).toEqual([...RENEWAL_LABELS].sort());
  });

  it('UTC 时刻边界：15:59:59Z → 北京 7/31 全保留；16:00:00Z → 北京 8/1 剔除续保 2 表', () => {
    const beforeCutoff = beijingDayOf('2026-07-31T15:59:59Z');
    expect(beforeCutoff).toBe('2026-07-31');
    expect(filterActiveWecomTasks(tasks, beforeCutoff).active).toHaveLength(5);

    const afterCutoff = beijingDayOf('2026-07-31T16:00:00Z');
    expect(afterCutoff).toBe('2026-08-01');
    const { active, retired } = filterActiveWecomTasks(tasks, afterCutoff);
    expect(active).toHaveLength(3);
    expect(retired.map((t: any) => t.label).sort()).toEqual([...RENEWAL_LABELS].sort());
  });

  it('todayBeijing 解析失败（null）时保守放行全部任务（不静默漏推有效表）', () => {
    const { active, retired } = filterActiveWecomTasks(tasks, null);
    expect(active).toHaveLength(5);
    expect(retired).toHaveLength(0);
  });
});

describe('F1 · 企微失败非阻断策略（evaluateWecomOutcome 恒不阻断发布）', () => {
  it('存在失败：releaseBlocking 恒 false（🔴 不变式）、alertNeeded true、note 含失败表名', () => {
    const failures = [
      { label: 'WeCom postal sync', reason: '退出码 1' },
      { label: 'WeCom renewal sync', reason: '超时' },
    ];
    const outcome = evaluateWecomOutcome(failures);
    expect(outcome.releaseBlocking).toBe(false);
    expect(outcome.alertNeeded).toBe(true);
    expect(outcome.note).toContain('WeCom postal sync');
    expect(outcome.note).toContain('非阻断');
  });

  it('无失败：不告警、note 为空、依然不阻断', () => {
    const outcome = evaluateWecomOutcome([]);
    expect(outcome.releaseBlocking).toBe(false);
    expect(outcome.alertNeeded).toBe(false);
    expect(outcome.note).toBe('');
  });

  it('summarizeWecomFailures 从 allSettled 结果按索引提取失败标签与原因', () => {
    const tasks = buildWecomTasks();
    const settled = [
      { status: 'fulfilled', value: 0 },
      { status: 'rejected', reason: new Error('webhook 401') },
      { status: 'fulfilled', value: 0 },
      { status: 'rejected', reason: new Error('超时') },
      { status: 'fulfilled', value: 0 },
    ];
    const failures = summarizeWecomFailures(settled, tasks);
    expect(failures).toEqual([
      { label: tasks[1].label, reason: 'webhook 401' },
      { label: tasks[3].label, reason: '超时' },
    ]);
  });
});

describe('F1 · 集成：早批核心成功 + 企微失败 → 晚批仍可发布（状态机不连坐）', () => {
  const today = '2026-07-22';

  it('企微失败按非阻断策略不改早批状态（released）→ 晚批依赖闸放行', () => {
    // 模拟发布链行为：早批核心（ETL/VPS/reload/health）成功、企微 2 个任务失败——
    // evaluateWecomOutcome.releaseBlocking=false ⇒ sync-and-reload 退出码 0 ⇒
    // watcher 把早批写成 released（企微失败只进标记文件独立告警，不影响批次状态）。
    const wecomFailures = [{ label: 'WeCom postal sync', reason: '退出码 1' }];
    expect(evaluateWecomOutcome(wecomFailures).releaseBlocking).toBe(false);

    const earlySlice = nextState('released', {
      todayBeijing: today, prevState: null, note: '自动发布成功', nowISO: `${today}T08:00:00+08:00`,
    });
    const state = mergeBatchState({}, EARLY_BATCH.id, earlySlice);

    // 晚批依赖闸：早批当天 released ⇒ 无未满足依赖 ⇒ 晚批照常发布
    expect(unmetDependencies(LATE_BATCH, state, today)).toEqual([]);
  });

  it('对照：若早批被标 failed（旧的阻断行为），晚批会被连坐拒发——即本次修复消除的路径', () => {
    const earlySlice = nextState('failed', {
      todayBeijing: today, prevState: null, note: 'WeCom 同步失败（旧行为）', nowISO: `${today}T08:00:00+08:00`,
    });
    const state = mergeBatchState({}, EARLY_BATCH.id, earlySlice);
    expect(unmetDependencies(LATE_BATCH, state, today)).toEqual([EARLY_BATCH.id]);
  });
});
