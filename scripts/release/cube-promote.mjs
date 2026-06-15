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

// ─────────────────────────── 常量 ───────────────────────────

// 影子对账每条路由最低观测门槛：低于此数视为"样本不足，禁止放行"
const DEFAULT_MATCH_FLOOR = 1000;

// 影子对账的 5 条路由名（与 /health 的 cubeShadow 键对应）
const SHADOW_ROUTES = ['trend', 'growth', 'cost', 'kpi', 'salesman-ranking'];

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

// ─────────────────────────── 阶段判定 ───────────────────────────

function detectSwitches(ecosystemSrc) {
  // 简单 regex：匹配 ecosystem.config.cjs 中 env 块的两个变量
  const shadow = /CUBE_SHADOW_COMPARE:\s*['"](true|false)['"]/.exec(ecosystemSrc)?.[1] === 'true';
  const routing = /CUBE_ROUTING_ENABLED:\s*['"](true|false)['"]/.exec(ecosystemSrc)?.[1] === 'true';
  return { shadow, routing };
}

function detectPhase(switches) {
  if (!switches.shadow && !switches.routing) return 0;
  if (switches.shadow && !switches.routing) return 1;
  if (switches.shadow && switches.routing) return 2; // 阶段 2 / 3 区分靠"已切流多少天"
  // SHADOW=false ROUTING=true 是非法状态（路由用户结果不接立方体校验），同 0 处理
  return 0;
}

// ─────────────────────────── 健康检查 ───────────────────────────

/**
 * 拉取 /health 端点，返回 { cubes, cubeShadow } 子节点。
 * 失败时返回 null（调用方需检查并置 health_unreachable=true）。
 */
async function fetchHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[cube-promote] /health 返回 ${res.status}`);
      return null;
    }
    const body = await res.json();
    const cubes = body.cubes ?? null;
    const cubeShadow = body.cubeShadow ?? null;
    if (!cubes || !cubeShadow) {
      console.error('[cube-promote] /health 响应缺少 cubes 或 cubeShadow 字段');
      return null;
    }
    return { cubes, cubeShadow };
  } catch (err) {
    console.error(`[cube-promote] /health 请求失败：${err.message}`);
    return null;
  }
}

/**
 * 检查三个立方体（trend/cost/salesman）的构建健康状态。
 * 任一 lastError != null 或 builtVersion === null → 视为构建失败。
 *
 * @returns {{ pass: boolean, failedCubes: string[] }}
 */
function checkBuildHealth(cubes) {
  const failedCubes = [];
  for (const name of ['trend', 'cost', 'salesman']) {
    const s = cubes[name];
    if (!s) {
      failedCubes.push(`${name}（状态缺失）`);
      continue;
    }
    if (s.lastError !== null && s.lastError !== undefined) {
      failedCubes.push(`${name}（lastError: ${String(s.lastError).slice(0, 80)}）`);
    } else if (s.builtVersion === null || s.builtVersion === undefined) {
      failedCubes.push(`${name}（builtVersion 为空，立方体尚未成功构建）`);
    }
  }
  return { pass: failedCubes.length === 0, failedCubes };
}

/**
 * 检查影子对账 5 条路由的累计 match 是否达到样本下限。
 * 任一路由 match < MATCH_FLOOR → 视为样本不足。
 *
 * @returns {{ pass: boolean, routeFloors: Record<string, {match:number, target:number, pass:boolean}> }}
 */
function checkShadowSampleFloor(cubeShadow) {
  const routeFloors = {};
  let allPass = true;

  for (const route of SHADOW_ROUTES) {
    const s = cubeShadow[route];
    const matchCount = s?.match ?? 0;
    const routePass = matchCount >= MATCH_FLOOR;
    routeFloors[route] = { match: matchCount, target: MATCH_FLOOR, pass: routePass };
    if (!routePass) allPass = false;
  }

  return { pass: allPass, routeFloors };
}

// ─────────────────────────── 哨兵历史 ───────────────────────────

async function fetchSentinelHistory({ ghToken, repo, historyIssue, sinceDays = 7 }) {
  if (!historyIssue) return { available: false, reason: '未指定 --history-issue' };
  if (!ghToken) return { available: false, reason: '未提供 GH_TOKEN / GITHUB_TOKEN' };

  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  const url = `https://api.github.com/repos/${repo}/issues/${historyIssue}/comments?since=${since}&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    return { available: false, reason: `GH API ${res.status}: ${await res.text()}` };
  }
  const comments = await res.json();

  let critical = 0;
  let warn = 0;
  let info = 0;
  const latest = [];
  for (const c of comments) {
    const body = c.body ?? '';
    const sev = /严重度.*?`(CRITICAL|WARN|INFO|NONE)`/.exec(body)?.[1];
    if (sev === 'CRITICAL') critical++;
    else if (sev === 'WARN') warn++;
    else if (sev === 'INFO') info++;
    latest.push({ at: c.created_at, severity: sev ?? 'unknown' });
  }
  return {
    available: true,
    windowDays: sinceDays,
    counts: { critical, warn, info, total: comments.length },
    latest: latest.slice(-5),
  };
}

// ─────────────────────────── 推进建议 ───────────────────────────

/**
 * 综合阶段、开关、哨兵历史、健康检查结果，输出推进判定。
 *
 * healthData 结构：
 *   null                         — /health 不可达（且调用方未传 --no-health）
 *   { skipped: true }            — --no-health 模式跳过
 *   { cubes, cubeShadow,
 *     buildHealthResult,
 *     sampleFloorResult }        — 正常读取并已完成分析
 */
function buildVerdict({ phase, switches, history, healthData }) {
  const blockers = [];

  // ── 健康检查前置门：不可达 → exitCode=2，不做 canAdvance 判定 ──
  if (healthData === null) {
    return {
      phase,
      summary: '无法判定：/health 端点不可达，无法验证立方体构建状态与影子对账样本数',
      canAdvance: false,
      health_unreachable: true,
      nextAction: '检查生产服务是否正常，或本地用 --mock-health <fixture.json> 注入快照；离线环境可用 --no-health 跳过（仅看哨兵评论历史）',
      blockers: ['/health 不可达'],
    };
  }

  // ── 构建/样本健康检查（阶段 1 必须过，阶段 0 不适用）──
  const healthSummaryNode = {};
  let buildHealthPass = true;
  let sampleFloorPass = true;

  if (!healthData.skipped && phase === 1) {
    const bh = healthData.buildHealthResult;
    const sf = healthData.sampleFloorResult;

    buildHealthPass = bh.pass;
    sampleFloorPass = sf.pass;

    healthSummaryNode.buildHealth = bh.pass ? 'pass' : 'fail';
    healthSummaryNode.cubes = {
      trend: { lastError: healthData.cubes.trend?.lastError ?? null, builtVersion: healthData.cubes.trend?.builtVersion ?? null },
      cost: { lastError: healthData.cubes.cost?.lastError ?? null, builtVersion: healthData.cubes.cost?.builtVersion ?? null },
      salesman: { lastError: healthData.cubes.salesman?.lastError ?? null, builtVersion: healthData.cubes.salesman?.builtVersion ?? null },
    };
    healthSummaryNode.shadowFloors = sf.routeFloors;

    if (!bh.pass) {
      for (const fc of bh.failedCubes) {
        blockers.push(`立方体构建失败：${fc}`);
      }
    }

    if (!sf.pass) {
      const insufficient = Object.entries(sf.routeFloors)
        .filter(([, v]) => !v.pass)
        .map(([route, v]) => `${route}（当前 match=${v.match}，目标 ≥${v.target}）`);
      blockers.push(`影子对账样本不足：${insufficient.join('、')}`);
    }
  } else if (healthData.skipped) {
    healthSummaryNode.skipped = true;
    healthSummaryNode.note = '--no-health 模式，跳过构建状态与样本下限检查';
  }

  // ── 阶段 0：未启用 ──
  if (phase === 0) {
    return {
      phase: 0,
      summary: '阶段 0 — 立方体未启用（两开关均 false）',
      canAdvance: true,
      nextAction: "在 server/ecosystem.config.cjs 设 CUBE_SHADOW_COMPARE: 'true'，按 deploy-chain 部署链 PR 流程合并",
      blockers: [],
      health: healthData.skipped ? { skipped: true } : healthSummaryNode,
    };
  }

  // ── 阶段 1：影子对账期 ──
  if (phase === 1) {
    // ① 健康检查阻断（优先于哨兵历史）
    if (!buildHealthPass || !sampleFloorPass) {
      return {
        phase: 1,
        summary: `阶段 1（影子对账） · 健康检查不通过（${blockers.length} 项阻塞）`,
        canAdvance: false,
        nextAction: '修复立方体构建失败 / 等待影子对账积累足够样本后重试',
        blockers,
        health: healthSummaryNode,
      };
    }

    // ② 哨兵历史不可读
    if (!history.available) {
      return {
        phase: 1,
        summary: `阶段 1（影子对账） · 哨兵历史不可读：${history.reason}`,
        canAdvance: false,
        nextAction: null,
        blockers: [`需要 GitHub token 与 --history-issue 才能判定 7 天稳定性；当前：${history.reason}`],
        health: healthSummaryNode,
      };
    }

    const c = history.counts;

    // ③ 哨兵有 CRITICAL
    if (c.critical > 0) {
      return {
        phase: 1,
        summary: `阶段 1 · 过去 7 天有 ${c.critical} 次 CRITICAL · 不可推进`,
        canAdvance: false,
        nextAction: null,
        blockers: [
          `过去 7 天哨兵报 CRITICAL ${c.critical} 次`,
          '解决方法：去追踪 issue 看哪些路由不一致，按改写器/白名单/逻辑 bug 三类排查',
        ],
        health: healthSummaryNode,
      };
    }

    // ④【已修复】哨兵 total=0 → 之前版本静默放行，现在阻断
    //   样本不足（match 未到下限）已在健康检查阶段拦截；
    //   但若 --no-health 跳过健康检查，且哨兵也无评论，说明根本没有对账流量，
    //   不能放行。
    if (c.total === 0) {
      return {
        phase: 1,
        summary: '阶段 1 · 过去 7 天哨兵无任何评论（尚未观察到影子对账流量）',
        canAdvance: false,
        nextAction: '样本不足——先在 staging 跑 burn-in 或向生产注入压力流量后重试。可用 curl /health 确认 cubeShadow.*.match 是否 > 0',
        blockers: [
          '哨兵 7 天内无评论，无法确认影子对账已实际运行',
          `影子对账样本下限：每条路由 match ≥ ${MATCH_FLOOR}（可由 env CUBE_PROMOTE_MATCH_FLOOR 覆盖）`,
        ],
        health: healthSummaryNode,
      };
    }

    // ⑤ 健康通过 + 哨兵无 CRITICAL + 有评论记录 → 可推进
    return {
      phase: 1,
      summary: `阶段 1 · 过去 7 天 ${c.total} 条非 CRITICAL 评论（WARN ${c.warn} / INFO ${c.info}），健康检查通过 · 可推进`,
      canAdvance: true,
      nextAction: "提部署链 PR：server/ecosystem.config.cjs 追加 CUBE_ROUTING_ENABLED: 'true'，按 deploy-chain SOP 人工低峰合并",
      blockers: [],
      health: healthSummaryNode,
    };
  }

  // ── 阶段 2/3：当前简化为同一档（区分需 git log 切流时间，此处先标 2）──
  return {
    phase: 2,
    summary: '阶段 2 — 正式切流已生效；观察期与降频判定见文件头注释（待实现）',
    canAdvance: false,
    nextAction: '阶段 2 → 3 推进逻辑：检查 git log 找 CUBE_ROUTING_ENABLED 引入时间，> 30 天且无 CRITICAL → 降 cron。本批次未实现，留 BACKLOG',
    blockers: [],
    health: healthData.skipped ? { skipped: true } : healthSummaryNode,
  };
}

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
        sampleFloorResult: checkShadowSampleFloor(cubeShadow),
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
      sampleFloorResult: checkShadowSampleFloor(fixture.cubeShadow),
    };
  }

  // 正常模式：拉生产 /health
  const raw = await fetchHealth(args.healthUrl);
  if (!raw) return null;

  return {
    cubes: raw.cubes,
    cubeShadow: raw.cubeShadow,
    buildHealthResult: checkBuildHealth(raw.cubes),
    sampleFloorResult: checkShadowSampleFloor(raw.cubeShadow),
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

  const verdict = buildVerdict({ phase, switches, history, healthData });
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
