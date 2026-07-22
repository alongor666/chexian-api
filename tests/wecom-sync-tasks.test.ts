import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅发布链内部使用）
import {
  MAY_JUL_RENEWAL_WECOM_LAST_DAY,
  WECOM_FAILURE_EXIT_CODE,
  buildWecomTasks,
  filterActiveWecomTasks,
  summarizeWecomFailures,
  evaluateWecomOutcome,
  runWecomStage,
  interpretReleaseExit,
  buildWecomFailureAlert,
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

describe('summarizeWecomFailures / evaluateWecomOutcome（失败提取与策略常量）', () => {
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

  it('evaluateWecomOutcome：releaseBlocking 恒 false，失败时 alertNeeded + note 含表名', () => {
    const outcome = evaluateWecomOutcome([{ label: 'WeCom postal sync', reason: '退出码 1' }]);
    expect(outcome.releaseBlocking).toBe(false);
    expect(outcome.alertNeeded).toBe(true);
    expect(outcome.note).toContain('WeCom postal sync');
    expect(evaluateWecomOutcome([]).alertNeeded).toBe(false);
  });
});

describe('F1 · 真实编排链路（runWecomStage 注入 runner，生产 Stage 5 执行体）', () => {
  const today = '2026-07-22';
  const failingRunner = (failLabels: string[]) => (task: any) =>
    failLabels.includes(task.label)
      ? Promise.reject(new Error(`${task.label} 退出码 1`))
      : Promise.resolve(0);

  it('企微子任务失败：不抛错、返回专用退出码 86（非 0 → 手动入口不静默成功）、标记绑定 runId 落盘', async () => {
    const persisted: any[] = [];
    // 若恢复旧的 throw 行为，这里 await 会 reject，本测试即打红（变异防护）
    const result = await runWecomStage({
      todayBeijing: today,
      runId: '20260722-080000',
      runner: failingRunner(['WeCom postal sync', 'WeCom renewal sync']),
      persistMarker: (m: any) => persisted.push(m),
    });
    expect(result.exitCode).toBe(WECOM_FAILURE_EXIT_CODE);
    expect(result.exitCode).not.toBe(0);
    expect(result.failures.map((f: any) => f.label).sort()).toEqual(['WeCom postal sync', 'WeCom renewal sync'].sort());
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ beijingDay: today, runId: '20260722-080000' });
    expect(persisted[0].failures).toHaveLength(2);
  });

  it('全部成功：退出码 0、标记落盘且失败清单清空（清除告警态）', async () => {
    const persisted: any[] = [];
    const result = await runWecomStage({
      todayBeijing: today,
      runId: 'r1',
      runner: () => Promise.resolve(0),
      persistMarker: (m: any) => persisted.push(m),
    });
    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
    expect(persisted[0].failures).toEqual([]);
  });

  it('企微级 dry-run：不落盘标记（演练不污染真实告警态）', async () => {
    const persistMarker = vi.fn();
    await runWecomStage({
      wecomDryRun: true, todayBeijing: today, runner: () => Promise.resolve(0), persistMarker,
    });
    expect(persistMarker).not.toHaveBeenCalled();
  });

  it('到期停推闸在编排体内生效：北京 2026-08-01 只有 3 张签单表被 runner 执行', async () => {
    const invoked: string[] = [];
    await runWecomStage({
      todayBeijing: '2026-08-01',
      runner: (task: any) => { invoked.push(task.label); return Promise.resolve(0); },
      persistMarker: () => {},
    });
    expect(invoked.sort()).toEqual([...SIGNING_LABELS].sort());
  });

  it('persistMarker 抛错被吞掉（标记写失败不阻断、不改变退出码）', async () => {
    const result = await runWecomStage({
      todayBeijing: today,
      runner: () => Promise.resolve(0),
      persistMarker: () => { throw new Error('磁盘只读'); },
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('F1 · 退出码契约（interpretReleaseExit，watcher runReleaseDaily 真实消费）', () => {
  it('0=全成功；86=核心成功仅企微失败；1/null=核心失败', () => {
    expect(interpretReleaseExit(0)).toEqual({ coreReleased: true, wecomFailed: false });
    expect(interpretReleaseExit(WECOM_FAILURE_EXIT_CODE)).toEqual({ coreReleased: true, wecomFailed: true });
    expect(interpretReleaseExit(1)).toEqual({ coreReleased: false, wecomFailed: false });
    expect(interpretReleaseExit(null)).toEqual({ coreReleased: false, wecomFailed: false });
  });

  it('端到端状态机：退出码 86 → watcher 标早批 released → 晚批依赖闸放行（不连坐）', () => {
    const today = '2026-07-22';
    // watcher runBatch 的真实判定链：interpretReleaseExit(86).coreReleased → nextState('released')
    const interp = interpretReleaseExit(WECOM_FAILURE_EXIT_CODE);
    expect(interp.coreReleased).toBe(true);
    const earlySlice = nextState(interp.coreReleased ? 'released' : 'failed', {
      todayBeijing: today, prevState: null, note: '自动发布成功', nowISO: `${today}T08:00:00+08:00`,
    });
    const state = mergeBatchState({}, EARLY_BATCH.id, earlySlice);
    expect(unmetDependencies(LATE_BATCH, state, today)).toEqual([]);
    // 同时独立告警必须触发
    expect(interp.wecomFailed).toBe(true);
  });

  it('对照：核心失败（exit 1）→ 早批 failed → 晚批被依赖闸拦截（该拦截保持不变）', () => {
    const today = '2026-07-22';
    const interp = interpretReleaseExit(1);
    const earlySlice = nextState(interp.coreReleased ? 'released' : 'failed', {
      todayBeijing: today, prevState: null, note: '核心发布失败', nowISO: `${today}T08:00:00+08:00`,
    });
    const state = mergeBatchState({}, EARLY_BATCH.id, earlySlice);
    expect(unmetDependencies(LATE_BATCH, state, today)).toEqual([EARLY_BATCH.id]);
  });
});

describe('F1 · 独立告警文案（buildWecomFailureAlert，watcher wecomFailed 时调用）', () => {
  const today = '2026-07-22';

  it('标记新鲜（同北京日 + 同 runId + 有失败）→ 文案含具体失败表名与重试命令', () => {
    const alert = buildWecomFailureAlert(
      { beijingDay: today, runId: 'r1', failures: [{ label: 'WeCom postal sync' }] },
      { todayBeijing: today, runId: 'r1' }
    );
    expect(alert.title).toContain('发布未受阻断');
    expect(alert.body).toContain('WeCom postal sync');
    expect(alert.body).toContain('wecom-sync.mjs');
  });

  it('标记陈旧（隔天）/ runId 不匹配 / 缺失 → 回退通用文案（告警不丢失）', () => {
    const stale = buildWecomFailureAlert(
      { beijingDay: '2026-07-21', runId: 'r0', failures: [{ label: 'WeCom postal sync' }] },
      { todayBeijing: today, runId: 'r1' }
    );
    expect(stale.body).not.toContain('WeCom postal sync');
    expect(stale.body).toContain('缺失或陈旧');

    const mismatch = buildWecomFailureAlert(
      { beijingDay: today, runId: 'r0', failures: [{ label: 'WeCom postal sync' }] },
      { todayBeijing: today, runId: 'r1' }
    );
    expect(mismatch.body).not.toContain('WeCom postal sync');

    const missing = buildWecomFailureAlert(null, { todayBeijing: today, runId: 'r1' });
    expect(missing.body).toContain('缺失或陈旧');
    expect(missing.body).toContain('wecom-sync.mjs');
  });
});
