#!/usr/bin/env node
// 通用立方体灰度推进决策器（AI agent 入口）
//
// AI agent 想知道"立方体现在处于什么阶段、下一步该做什么"时，跑这个脚本。
// 不依赖任何 SOP/runbook 文档，所有决策逻辑就在本文件——读源头数据自己判定。
//
// 三阶段状态机（从 ecosystem.config.cjs 的两个开关 + 哨兵历史推断）：
//
//   阶段 0 — 未启用                       两开关均 'false'      → 开 CUBE_SHADOW_COMPARE='true' 进入阶段 1
//   阶段 1 — 影子对账                     SHADOW='true', ROUTING='false'
//     ├─ 健康检查：任意立方体 lastError != null     → 不可推进（构建失败）
//     ├─ 影子对账样本：任一路由 match < 1000        → 不可推进（样本不足）
//     ├─ 哨兵 7 天内有 CRITICAL                    → 不可推进；阻塞
//     ├─ 哨兵 7 天连续无 CRITICAL + 样本充分       → 开 CUBE_ROUTING_ENABLED='true' 进入阶段 2
//     └─ 哨兵未跑够 7 天（无任何评论）              → 不可推进（需先确认有流量）
//   阶段 2 — 正式切流（观察期 30 天）      SHADOW='true', ROUTING='true' 已合并 < 30 天
//     └─ 阶段 2 满 30 天稳定              → 降 cron 到 "15 ⁎/3 ⁎ ⁎ ⁎"（每 3 小时）
//   阶段 3 — 长期稳态                     阶段 2 满 30 天 + 再 30 天无 CRITICAL
//     └─ 满足                            → 降 cron 到 "15 ⁎/6 ⁎ ⁎ ⁎" 或并入 ETL 哨兵
//
// 数据源（不要求人维护，全部从生产/仓库自动读）：
//   - 当前开关：ssh deployer@VPS cat ecosystem.config.cjs （或 --ecosystem-file 本地读）
//   - 哨兵历史：GH REST API 拉「立方体灰度哨兵追踪」issue 评论时间线
//     （CRITICAL 评论体里有 `**严重度**：\`CRITICAL\`` 字样）
//   - 切流时间：git log 找 CUBE_ROUTING_ENABLED 引入 commit 的时间
//   - 健康状态：/health 端点（立方体构建状态 + 影子对账累计计数）
//
// 输出（JSON 单对象，机器可消费 + summary 行人也能看）：
//   { phase, summary, canAdvance, nextAction, blockers, switches, history, health }
//
// 用法：
//   node scripts/release/cube-promote.mjs --ecosystem-file server/ecosystem.config.cjs
//   node scripts/release/cube-promote.mjs --health-url https://chexian.cretvalu.com/health \
//        --history-issue 99 --gh-token "$GH_TOKEN"
//   node scripts/release/cube-promote.mjs --dry-run-fixture 阶段1-健康  # 离线烟测
//   node scripts/release/cube-promote.mjs --mock-health /tmp/fixture.json  # 注入 health 快照
//   node scripts/release/cube-promote.mjs --no-health                      # 跳过 /health 检查（离线）
//
// 退出码：
//   0 — canAdvance=true（可推进）
//   1 — canAdvance=false（不可推进，有阻塞项）
//   2 — health_unreachable（/health 不可达且未传 --no-health，无法做完整判定）
//
// 红线（governance check 兜底，不靠本脚本记忆）：
//   - cube-shadow.ts 的 NUMERIC_TOLERANCE 不可放宽（governance「立方体影子对账容差」）
//   - 改 cube-grayscale-sentinel.yml 的 cron 必须先跑本脚本确认 canAdvance=true
//
// 相关：scripts/sentinel/cube-grayscale-sentinel.mjs · scripts/cube-rollback.mjs

import { readFileSync, existsSync } from 'node:fs';
import {
  DEFAULT_MATCH_FLOOR,
  detectSwitches,
  detectPhase,
  fetchHealth,
  checkBuildHealth,
  checkShadowSampleFloor,
  fetchSentinelHistory,
  buildVerdict,
} from './lib/cube-promote-judge.mjs';

// 判定 / regex / fetch 纯函数全部抽到 ./lib/cube-promote-judge.mjs，便于单元测试 import 真函数
// （解决 PR #644 review 提的「测试副本 vs 脚本本体漂移」问题）。本文件只保留 CLI 入口：
// args 解析 / loadEcosystem / loadHistory / loadHealth / loadFixtureHealth / main。

// ─────────────────────────── 参数解析 ───────────────────────────

const argv = process.argv.slice(2);
const args = {
  ecosystemFile: 'server/ecosystem.config.cjs',
  healthUrl: process.env.HEALTH_URL || 'https://chexian.cretvalu.com/health',
  historyIssue: null,
  ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  repo: 'alongor666/chexian-api',
  dryRunFixture: null,
  noHealth: false,
  mockHealthFile: null,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eat = () => argv[++i];
  if (a === '--ecosystem-file') args.ecosystemFile = eat();
  else if (a === '--health-url') args.healthUrl = eat();
  else if (a === '--history-issue') args.historyIssue = Number(eat());
  else if (a === '--gh-token') args.ghToken = eat();
  else if (a === '--repo') args.repo = eat();
  else if (a === '--dry-run-fixture') args.dryRunFixture = eat();
  else if (a === '--no-health') args.noHealth = true;
  else if (a === '--mock-health') args.mockHealthFile = eat();
  else if (a === '--help' || a === '-h') {
    console.error('见文件头注释');
    process.exit(0);
  }
}

const MATCH_FLOOR = Number(process.env.CUBE_PROMOTE_MATCH_FLOOR ?? DEFAULT_MATCH_FLOOR);

// ─────────────────────────── Fixture 加载 ───────────────────────────

function loadFixtureHealth(dryRunFixture) {
  // 预定义场景 fixture（供 --dry-run-fixture 调用）
  const fixtures = {
    '阶段1-健康-全通':  {
      cubes: {
        trend:    { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1200 },
        cost:     { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1500 },
        salesman: { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 900  },
      },
      cubeShadow: {
        trend:             { match: 1200, mismatch: 0, error: 0 },
        growth:            { match: 1050, mismatch: 2, error: 0 },
        cost:              { match: 1100, mismatch: 0, error: 0 },
        kpi:               { match: 1300, mismatch: 1, error: 0 },
        'salesman-ranking': { match: 1000, mismatch: 0, error: 0 },
      },
    },
    '阶段1-cost构建失败': {
      cubes: {
        trend:    { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1200 },
        cost:     { builtVersion: 'v1', lastError: 'DuckDB timeout after 30s', building: false, lastBuildMs: null },
        salesman: { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 900  },
      },
      cubeShadow: {
        trend:             { match: 1200, mismatch: 0, error: 0 },
        growth:            { match: 1050, mismatch: 0, error: 0 },
        cost:              { match: 0,    mismatch: 0, error: 4 },
        kpi:               { match: 1300, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 1000, mismatch: 0, error: 0 },
      },
    },
    '阶段1-kpi样本不足': {
      cubes: {
        trend:    { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1200 },
        cost:     { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1500 },
        salesman: { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 900  },
      },
      cubeShadow: {
        trend:             { match: 1200, mismatch: 0, error: 0 },
        growth:            { match: 1050, mismatch: 0, error: 0 },
        cost:              { match: 1100, mismatch: 0, error: 0 },
        kpi:               { match: 0,    mismatch: 0, error: 0 },
        'salesman-ranking': { match: 1000, mismatch: 0, error: 0 },
      },
    },
    '阶段1-trend绿cost报错': {
      cubes: {
        trend:    { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 1200 },
        cost:     { builtVersion: null, lastError: 'No parquet found for cost cube', building: false, lastBuildMs: null },
        salesman: { builtVersion: 'v1', lastError: null, building: false, lastBuildMs: 900  },
      },
      cubeShadow: {
        trend:             { match: 1200, mismatch: 0, error: 0 },
        growth:            { match: 1050, mismatch: 0, error: 0 },
        cost:              { match: 50,   mismatch: 0, error: 8 },
        kpi:               { match: 1300, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 1000, mismatch: 0, error: 0 },
      },
    },
  };
  return fixtures[dryRunFixture] ?? null;
}

// ─────────────────────────── 主流程 ───────────────────────────

async function loadEcosystem() {
  if (args.dryRunFixture) {
    const phase1 = "env: {\n  CUBE_SHADOW_COMPARE: 'true',\n  CUBE_ROUTING_ENABLED: 'false',\n}\n";
    return {
      '阶段0-未启用':       "env: {\n  CUBE_SHADOW_COMPARE: 'false',\n}\n",
      '阶段1-健康':          phase1,
      '阶段1-健康-全通':     phase1,
      '阶段1-异常':          phase1,
      '阶段1-cost构建失败':  phase1,
      '阶段1-kpi样本不足':   phase1,
      '阶段1-trend绿cost报错': phase1,
      '阶段2-已切流': "env: {\n  CUBE_SHADOW_COMPARE: 'true',\n  CUBE_ROUTING_ENABLED: 'true',\n}\n",
    }[args.dryRunFixture] ?? '';
  }
  if (!existsSync(args.ecosystemFile)) {
    throw new Error(`ecosystem 文件不存在：${args.ecosystemFile}`);
  }
  return readFileSync(args.ecosystemFile, 'utf-8');
}

async function loadHistory(dryRunFixture) {
  if (dryRunFixture === '阶段1-健康' || dryRunFixture === '阶段1-健康-全通') {
    return { available: true, windowDays: 7, counts: { critical: 0, warn: 2, info: 1, total: 3 }, latest: [] };
  }
  if (dryRunFixture === '阶段1-异常') {
    return { available: true, windowDays: 7, counts: { critical: 1, warn: 0, info: 0, total: 1 }, latest: [] };
  }
  if (dryRunFixture === '阶段1-cost构建失败') {
    return { available: true, windowDays: 7, counts: { critical: 0, warn: 1, info: 2, total: 3 }, latest: [] };
  }
  if (dryRunFixture === '阶段1-kpi样本不足') {
    return { available: true, windowDays: 7, counts: { critical: 0, warn: 0, info: 1, total: 1 }, latest: [] };
  }
  if (dryRunFixture === '阶段1-trend绿cost报错') {
    return { available: true, windowDays: 7, counts: { critical: 0, warn: 3, info: 0, total: 3 }, latest: [] };
  }
  return await fetchSentinelHistory({
    ghToken: args.ghToken,
    repo: args.repo,
    historyIssue: args.historyIssue,
  });
}

/**
 * 加载 healthData，结构见 buildVerdict 注释。
 * 返回：null（不可达）| { skipped: true }（--no-health）| { cubes, cubeShadow, buildHealthResult, sampleFloorResult }
 */
async function loadHealth(dryRunFixture) {
  // --no-health：跳过
  if (args.noHealth) {
    return { skipped: true };
  }

  // --mock-health：从本地文件读
  if (args.mockHealthFile) {
    if (!existsSync(args.mockHealthFile)) {
      console.error(`[cube-promote] --mock-health 文件不存在：${args.mockHealthFile}`);
      return null;
    }
    try {
      const raw = readFileSync(args.mockHealthFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const cubes = parsed.cubes ?? null;
      const cubeShadow = parsed.cubeShadow ?? null;
      if (!cubes || !cubeShadow) {
        console.error('[cube-promote] mock-health 文件缺少 cubes 或 cubeShadow 字段');
        return null;
      }
      return {
        cubes,
        cubeShadow,
        buildHealthResult: checkBuildHealth(cubes),
        sampleFloorResult: checkShadowSampleFloor(cubeShadow, MATCH_FLOOR),
      };
    } catch (err) {
      console.error(`[cube-promote] 解析 --mock-health 文件失败：${err.message}`);
      return null;
    }
  }

  // --dry-run-fixture：从内置 fixture 读
  if (dryRunFixture) {
    const fixture = loadFixtureHealth(dryRunFixture);
    if (!fixture) {
      // fixture 未定义对应的健康数据（如阶段0/阶段2）→ 跳过健康检查
      return { skipped: true };
    }
    return {
      cubes: fixture.cubes,
      cubeShadow: fixture.cubeShadow,
      buildHealthResult: checkBuildHealth(fixture.cubes),
      sampleFloorResult: checkShadowSampleFloor(fixture.cubeShadow, MATCH_FLOOR),
    };
  }

  // 正常模式：拉生产 /health
  const raw = await fetchHealth(args.healthUrl);
  if (!raw) return null;

  return {
    cubes: raw.cubes,
    cubeShadow: raw.cubeShadow,
    buildHealthResult: checkBuildHealth(raw.cubes),
    sampleFloorResult: checkShadowSampleFloor(raw.cubeShadow, MATCH_FLOOR),
  };
}

async function main() {
  const ecosystemSrc = await loadEcosystem();
  const switches = detectSwitches(ecosystemSrc);
  const phase = detectPhase(switches);
  const history = phase === 1
    ? await loadHistory(args.dryRunFixture)
    : { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 }, windowDays: 7 };
  const healthData = await loadHealth(args.dryRunFixture);

  const verdict = buildVerdict({ phase, switches, history, healthData, matchFloor: MATCH_FLOOR });
  verdict.switches = switches;
  verdict.history = history;

  console.log(JSON.stringify(verdict, null, 2));

  // 退出码：
  //   0 — canAdvance=true
  //   1 — canAdvance=false（有阻塞项，或阶段 2 观察中）
  //   2 — health_unreachable（无法做完整判定）
  if (verdict.health_unreachable) {
    process.exit(2);
  }
  process.exit(verdict.canAdvance ? 0 : 1);
}

main().catch((err) => {
  console.error(`[cube-promote] 致命错误：${err.stack || err.message}`);
  process.exit(2);
});
