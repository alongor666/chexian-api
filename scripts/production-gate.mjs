#!/usr/bin/env node

/**
 * 生产门禁编排脚本（本地/CI 通用）
 *
 * 默认执行：
 * 1) 治理校验
 * 2) 构建
 * 3) 全量单测
 * 4) 关键 E2E（子页面无刷新直达）
 *
 * 可选执行（--with-perf）：
 * 5) 关键路由基准压测
 * 6) 关键路由稳定性压测（默认 5 分钟）
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function elapsedSeconds(start) {
  return ((Date.now() - start) / 1000).toFixed(1);
}

function runStep(step, sharedEnv = {}) {
  const startedAt = Date.now();
  console.log(`${COLORS.blue}${COLORS.bold}[gate]${COLORS.reset} ${step.name}`);
  console.log(`  $ ${step.command.join(' ')}`);

  const result = spawnSync(step.command[0], step.command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...sharedEnv, ...(step.env || {}) },
  });

  const duration = elapsedSeconds(startedAt);
  if (result.status !== 0) {
    console.error(
      `${COLORS.red}${COLORS.bold}[fail]${COLORS.reset} ${step.name} (${duration}s, exit=${result.status ?? 1})`
    );
    process.exit(result.status ?? 1);
  }

  console.log(`${COLORS.green}${COLORS.bold}[pass]${COLORS.reset} ${step.name} (${duration}s)\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const withPerf = asBoolean(args.withPerf ?? process.env.PRODUCTION_GATE_WITH_PERF, false);
  const fast = asBoolean(args.fast ?? process.env.PRODUCTION_GATE_FAST, false);
  const ci = asBoolean(args.ci ?? process.env.CI, false);

  const perfDurationMinutes = asNumber(args.perfDurationMinutes ?? process.env.BENCH_SOAK_DURATION_MINUTES, 5);
  const perfConcurrency = asNumber(args.perfConcurrency ?? process.env.BENCH_SOAK_CONCURRENCY, 4);

  const sharedEnv = {};
  if (ci) {
    sharedEnv.CI = '1';
  }

  const coreTests = [
    'tests/realtime-aggregation-contract.test.ts',
    'tests/redirect-state.test.ts',
    'tests/route-redirect-guards.test.tsx',
  ];

  const steps = [
    { name: '治理校验', command: ['bun', 'run', 'governance'] },
    { name: '前端构建', command: ['bun', 'run', 'build'] },
    fast
      ? { name: '核心回归测试（快速）', command: ['bun', 'run', 'test', '--run', ...coreTests] }
      : { name: '全量单测', command: ['bun', 'run', 'test', '--run'] },
    {
      name: '关键 E2E：子页面首次直达无需刷新',
      command: ['bun', 'run', 'test:e2e', 'tests/e2e/04-subpage-no-refresh.spec.ts'],
    },
  ];

  if (withPerf) {
    steps.push(
      {
        name: '关键路由基准压测（严格门禁）',
        command: ['bun', 'run', 'benchmark:key-routes', '--', '--strictGate', 'true'],
      },
      {
        name: '关键路由稳定压测（严格门禁）',
        command: [
          'bun',
          'run',
          'benchmark:key-routes:soak',
          '--',
          '--strictGate',
          'true',
          '--durationMinutes',
          String(perfDurationMinutes),
          '--concurrency',
          String(perfConcurrency),
        ],
      }
    );
  }

  const startedAt = Date.now();
  console.log(
    `${COLORS.bold}=== Production Gate ===${COLORS.reset}\n` +
    `mode=${fast ? 'fast' : 'full'} withPerf=${withPerf} ci=${ci}\n`
  );

  for (const step of steps) {
    runStep(step, sharedEnv);
  }

  console.log(
    `${COLORS.green}${COLORS.bold}✅ Production gate passed${COLORS.reset} ` +
    `(${elapsedSeconds(startedAt)}s)`
  );
}

main();
