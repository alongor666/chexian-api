/**
 * cube-promote.mjs 推进决策纯函数 lib（PR #644 review fix 第二部分）
 *
 * 拆 lib 动机：原 cube-promote.mjs 的 7 个纯函数 + 2 常量与 args 解析 / IO 混在
 * 同文件，测试只能 inline 复现契约 → 测试副本与脚本本体漂移（实测：测试里的
 * buildVerdict 旧版本 + total=0 → canAdvance=true，但生产 PR #644 已改为
 * canAdvance=false。测试 inline 副本未跟随升级，但 CI 静默通过）。
 * 抽 lib 后：测试 import 真函数，脚本改动测试自动反映。
 *
 * 设计原则：
 * - 全部纯函数（无 process.env / 无 process.argv / 无文件系统副作用）
 * - 涉及 env 的常量改为函数参数（如 matchFloor）
 * - fetch 调用保留在 lib 内（测试用 vi.stubGlobal('fetch') 拦截）
 * - 不导出 CLI 入口、不读 ecosystem.config.cjs（IO 留在主 mjs）
 *
 * 暴露：
 *   常量：DEFAULT_MATCH_FLOOR / SHADOW_ROUTES
 *   函数：detectSwitches / detectPhase / fetchHealth / checkBuildHealth /
 *        checkShadowSampleFloor / fetchSentinelHistory / buildVerdict
 */

import { SHADOW_KEYS } from '../../shared/cube-routes.mjs';

// ─────────────────────────── 常量 ───────────────────────────

/** 影子对账每条路由最低观测门槛：低于此数视为"样本不足，禁止放行" */
export const DEFAULT_MATCH_FLOOR = 1000;

/** 影子对账的 5 条路由名（SSOT 在 scripts/shared/cube-routes.mjs，re-export 保持向后兼容）*/
export const SHADOW_ROUTES = SHADOW_KEYS;

// ─────────────────────────── 阶段判定 ───────────────────────────

/**
 * 从 ecosystem.config.cjs 文本中解析两个立方体开关。
 * 用 regex 匹配 env 块的 `CUBE_SHADOW_COMPARE: 'true'/'false'`
 * 与 `CUBE_ROUTING_ENABLED: 'true'/'false'`，缺失视为 false。
 */
export function detectSwitches(ecosystemSrc) {
  const shadow = /CUBE_SHADOW_COMPARE:\s*['"](true|false)['"]/.exec(ecosystemSrc)?.[1] === 'true';
  const routing = /CUBE_ROUTING_ENABLED:\s*['"](true|false)['"]/.exec(ecosystemSrc)?.[1] === 'true';
  return { shadow, routing };
}

/**
 * 开关组合 → 阶段号（0/1/2）。
 * 阶段 2/3 区分靠"已切流多少天"，本函数只判断到阶段 2。
 * SHADOW=false ROUTING=true 是非法状态，同阶段 0 处理。
 */
export function detectPhase(switches) {
  if (!switches.shadow && !switches.routing) return 0;
  if (switches.shadow && !switches.routing) return 1;
  if (switches.shadow && switches.routing) return 2;
  return 0;
}

// ─────────────────────────── 健康检查 ───────────────────────────

/**
 * 拉取 /health 端点，返回 { cubes, cubeShadow } 子节点。
 * 失败时返回 null（调用方需检查并置 health_unreachable=true）。
 */
export async function fetchHealth(url) {
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
export function checkBuildHealth(cubes) {
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
 * 任一路由 match < matchFloor → 视为样本不足。
 *
 * @param {object} cubeShadow /health.cubeShadow 节点
 * @param {number} matchFloor 样本下限（默认 DEFAULT_MATCH_FLOOR，cube-promote.mjs 顶部从 env 派生 MATCH_FLOOR）
 * @returns {{ pass: boolean, routeFloors: Record<string, {match:number, target:number, pass:boolean}> }}
 */
export function checkShadowSampleFloor(cubeShadow, matchFloor = DEFAULT_MATCH_FLOOR) {
  const routeFloors = {};
  let allPass = true;

  for (const route of SHADOW_ROUTES) {
    const s = cubeShadow[route];
    const matchCount = s?.match ?? 0;
    const routePass = matchCount >= matchFloor;
    routeFloors[route] = { match: matchCount, target: matchFloor, pass: routePass };
    if (!routePass) allPass = false;
  }

  return { pass: allPass, routeFloors };
}

// ─────────────────────────── 哨兵历史 ───────────────────────────

/**
 * 拉取 GitHub issue 评论时间线，按严重度计数（CRITICAL/WARN/INFO）。
 * 评论体必须含 `**严重度**：\`<级别>\`` 字样才被识别（哨兵 yml 写入契约）。
 */
export async function fetchSentinelHistory({ ghToken, repo, historyIssue, sinceDays = 7 }) {
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
 * @param {object} params
 * @param {0|1|2} params.phase                阶段号
 * @param {{shadow:boolean,routing:boolean}} params.switches 开关
 * @param {object} params.history             哨兵历史
 * @param {object|null} params.healthData     健康数据，结构：
 *   null                         — /health 不可达（且调用方未传 --no-health）
 *   { skipped: true }            — --no-health 模式跳过
 *   { cubes, cubeShadow,
 *     buildHealthResult,
 *     sampleFloorResult }        — 正常读取并已完成分析
 * @param {number} [params.matchFloor]        样本下限（默认 DEFAULT_MATCH_FLOOR；仅用于 message 文本）
 *
 * @returns {{ phase, summary, canAdvance, nextAction, blockers, health?, health_unreachable? }}
 */
export function buildVerdict({ phase, switches, history, healthData, matchFloor = DEFAULT_MATCH_FLOOR }) {
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

    // ④【PR #644 已修】哨兵 total=0 → 之前版本静默放行，现在阻断
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
          `影子对账样本下限：每条路由 match ≥ ${matchFloor}（可由 env CUBE_PROMOTE_MATCH_FLOOR 覆盖）`,
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
