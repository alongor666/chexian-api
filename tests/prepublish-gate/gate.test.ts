import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// .mjs 没类型；这里只做行为测试，断言用 expect 即可
import {
  parseArgs,
  runGateChecks,
  writeBypassAudit,
  currentBusinessMonthStart,
  evaluateInspection,
  // @ts-expect-error mjs without types
} from '../../scripts/prepublish-gate/prepublish-gate.mjs';

const NORMAL_SERIES = [
  { time_period: '2025-01', value: 100 },
  { time_period: '2025-02', value: 102 },
  { time_period: '2025-03', value: 98 },
  { time_period: '2025-04', value: 101 },
  { time_period: '2025-05', value: 99 },
  { time_period: '2025-06', value: 50 }, // 未成熟近期，被 excludeRecent=1 排除
];

const SPIKE_SERIES = [
  { time_period: '2025-01', value: 100 },
  { time_period: '2025-02', value: 102 },
  { time_period: '2025-03', value: 98 },
  { time_period: '2025-04', value: 101 },
  { time_period: '2025-05', value: 500 }, // 真实飙升 5x（latestMature 后这就是被检值）
  { time_period: '2025-06', value: 50 },  // 未成熟近期，被 excludeRecent=1 排除
];

const CONFIG_BASIC = {
  maturity: { excludeRecent: 1 },
  history: { minMaturePeriods: 3 },
  metrics: [
    {
      id: 'monthly_premium',
      name: '月签单保费',
      alert: true,
      source: 'policy_dedup.monthly_premium',
      direction: 'both',
      zThreshold: 2.5,
      momThreshold: 30,
      excludeRecent: 1,
    },
    {
      id: 'monthly_policy_count',
      name: '月签单件数',
      alert: true,
      source: 'policy_dedup.monthly_policy_count',
      direction: 'both',
      zThreshold: 2.5,
      momThreshold: 30,
      excludeRecent: 1,
    },
  ],
};

describe('prepublish-gate parseArgs', () => {
  beforeEach(() => {
    delete process.env.PREPUBLISH_GATE_SKIP;
    delete process.env.PREPUBLISH_GATE_SKIP_REASON;
  });

  it('默认：闸门开启，无 skip', () => {
    const opts = parseArgs([]);
    expect(opts.skipGate).toBe(false);
    expect(opts.config).toBe(null);
    expect(opts.warehouseRoot).toBe(null);
  });

  it('--skip-gate + --skip-reason', () => {
    const opts = parseArgs(['--skip-gate', '--skip-reason', '人工已核对']);
    expect(opts.skipGate).toBe(true);
    expect(opts.skipReason).toBe('人工已核对');
  });

  it('--config / --warehouse-root / --out-dir', () => {
    const opts = parseArgs([
      '--config', '/x/gate.json',
      '--warehouse-root', '/y/warehouse',
      '--out-dir', '/z/out',
    ]);
    expect(opts.config).toBe('/x/gate.json');
    expect(opts.warehouseRoot).toBe('/y/warehouse');
    expect(opts.outDir).toBe('/z/out');
  });

  it('环境变量 PREPUBLISH_GATE_SKIP=1 自动开启 skip', () => {
    process.env.PREPUBLISH_GATE_SKIP = '1';
    process.env.PREPUBLISH_GATE_SKIP_REASON = 'cron-bypass';
    const opts = parseArgs([]);
    expect(opts.skipGate).toBe(true);
    expect(opts.skipReason).toBe('cron-bypass');
  });

  it('环境变量 PREPUBLISH_GATE_SKIP=true 也生效', () => {
    process.env.PREPUBLISH_GATE_SKIP = 'true';
    const opts = parseArgs([]);
    expect(opts.skipGate).toBe(true);
  });

  it('CLI --skip-gate 优先于无 env 变量', () => {
    delete process.env.PREPUBLISH_GATE_SKIP;
    const opts = parseArgs(['--skip-gate']);
    expect(opts.skipGate).toBe(true);
    expect(opts.skipReason).toBe('');
  });
});

describe('prepublish-gate runGateChecks（注入式 fetcher）', () => {
  it('全部指标正常 → triggered=0、verdicts=2', async () => {
    const fetcher = async () => NORMAL_SERIES;
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { verdicts, triggered, errors } = await runGateChecks(CONFIG_BASIC, ctx, fetcher);
    expect(verdicts).toHaveLength(2);
    expect(triggered).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('注入异常（飙升 5x）→ 阻断（triggered > 0）', async () => {
    const fetcher = async (_ctx: any, source: string) =>
      source === 'policy_dedup.monthly_premium' ? SPIKE_SERIES : NORMAL_SERIES;
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { triggered } = await runGateChecks(CONFIG_BASIC, ctx, fetcher);
    expect(triggered.length).toBeGreaterThan(0);
    expect(triggered[0].metric).toBe('monthly_premium');
    expect(triggered[0].reasons.length).toBeGreaterThan(0);
  });

  it('空 series → insufficientData，不阻断、不计入 triggered', async () => {
    const fetcher = async () => [];
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { verdicts, triggered, errors } = await runGateChecks(CONFIG_BASIC, ctx, fetcher);
    expect(triggered).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(verdicts.every((v: any) => v.insufficientData === true)).toBe(true);
  });

  it('fetcher 抛错 → 记录在 errors，不阻断 triggered', async () => {
    const fetcher = async (_ctx: any, source: string) => {
      if (source === 'policy_dedup.monthly_premium') throw new Error('duckdb 启动失败');
      return NORMAL_SERIES;
    };
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { verdicts, triggered, errors } = await runGateChecks(CONFIG_BASIC, ctx, fetcher);
    expect(triggered).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].metric).toBe('monthly_premium');
    expect(verdicts.find((v: any) => v.metric === 'monthly_premium')?.fetchError).toContain('duckdb 启动失败');
  });

  it('config.metrics 中 alert=false 的指标不参与判定', async () => {
    const fetcher = async () => SPIKE_SERIES;
    const cfg = {
      ...CONFIG_BASIC,
      metrics: CONFIG_BASIC.metrics.map((m) => ({ ...m, alert: false })),
    };
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { verdicts, triggered } = await runGateChecks(cfg, ctx, fetcher);
    expect(verdicts).toHaveLength(0);
    expect(triggered).toHaveLength(0);
  });

  it('metric.direction=up 不会因下跌触发', async () => {
    const downSeries = [
      { time_period: '2025-01', value: 100 },
      { time_period: '2025-02', value: 102 },
      { time_period: '2025-03', value: 98 },
      { time_period: '2025-04', value: 101 },
      { time_period: '2025-05', value: 10 }, // 暴跌 - 但 direction=up 不会告警
      { time_period: '2025-06', value: 5 },  // 未成熟近期
    ];
    const fetcher = async () => downSeries;
    const cfg = {
      ...CONFIG_BASIC,
      metrics: [{ ...CONFIG_BASIC.metrics[0], direction: 'up' }],
    };
    const ctx = { policyGlob: 'x', claimsGlob: 'y', duckdbBin: 'duckdb' };
    const { triggered } = await runGateChecks(cfg, ctx, fetcher);
    expect(triggered).toHaveLength(0);
  });
});

describe('prepublish-gate currentBusinessMonthStart（Asia/Shanghai，与机器时区解耦）', () => {
  it('UTC 5/31 23:00 = 北京 6/1 07:00 → 取 2026-06-01（不退到上月）', () => {
    expect(currentBusinessMonthStart(new Date('2026-05-31T23:00:00Z'))).toBe('2026-06-01');
  });

  it('月中任意时刻 → 当月首日', () => {
    expect(currentBusinessMonthStart(new Date('2026-06-15T12:00:00Z'))).toBe('2026-06-01');
  });

  it('UTC 6/30 20:00 = 北京 7/1 04:00 → 取 2026-07-01', () => {
    expect(currentBusinessMonthStart(new Date('2026-06-30T20:00:00Z'))).toBe('2026-07-01');
  });

  it('返回 YYYY-MM-01 格式（可直接拼进 DATE 字面量）', () => {
    expect(currentBusinessMonthStart(new Date('2026-06-15T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('prepublish-gate writeBypassAudit', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(os.tmpdir(), 'gate-audit-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('写入 JSON 行到 logs/prepublish-gate-bypass.log', () => {
    const auditPath = writeBypassAudit({ repoRoot: tmpRoot, reason: 'test', source: 'unit-test' });
    expect(existsSync(auditPath)).toBe(true);
    const content = readFileSync(auditPath, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.reason).toBe('test');
    expect(parsed.source).toBe('unit-test');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('多次写入 append（每行一条 JSON）', () => {
    const p1 = writeBypassAudit({ repoRoot: tmpRoot, reason: 'first' });
    writeBypassAudit({ repoRoot: tmpRoot, reason: 'second' });
    const lines = readFileSync(p1, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).reason).toBe('first');
    expect(JSON.parse(lines[1]).reason).toBe('second');
  });

  it('未填理由时记录 "(no reason given)"', () => {
    const p = writeBypassAudit({ repoRoot: tmpRoot, reason: '' });
    const parsed = JSON.parse(readFileSync(p, 'utf-8').trim());
    expect(parsed.reason).toBe('(no reason given)');
  });
});

describe('prepublish-gate evaluateInspection（fail-closed 策略，codex PR #513 第6轮 P1）', () => {
  it('ready=true → proceed=true（放行）', () => {
    const v = evaluateInspection({ ready: true, missing: [] });
    expect(v).toEqual({ proceed: true });
  });

  it('ready=false → proceed=false + exitCode=2（fail-closed，非 exit 0）', () => {
    // 原始设计 ready=false 时 exit 0 "视作非闸门职责"是错的：
    // ETL 静默失败 / 误 rm warehouse → 闸门若 exit 0 → sync-vps Stage 3 把不完整 warehouse 推到生产。
    // fail-closed 唯一安全语义：缺数据 exit 2 阻断，紧急放行用 --skip-gate（带审计）。
    const missing = ['fact/policy/current（目录不存在）', 'fact/claims_detail（目录不存在）'];
    const v = evaluateInspection({ ready: false, missing });
    expect(v.proceed).toBe(false);
    expect(v.exitCode).toBe(2);
    expect(v.reason).toBe('warehouse-not-ready');
    expect(v.missing).toEqual(missing);
  });

  it('inspection=null/undefined → 也 fail-closed（防御式：取不到 inspection 当无数据）', () => {
    expect(evaluateInspection(null).proceed).toBe(false);
    expect(evaluateInspection(undefined).proceed).toBe(false);
    expect(evaluateInspection({}).proceed).toBe(false);
    expect(evaluateInspection({}).exitCode).toBe(2);
  });
});
