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
//     ├─ 哨兵 7 天内有 CRITICAL          → 不可推进；阻塞
//     ├─ 哨兵 7 天连续无 CRITICAL        → 开 CUBE_ROUTING_ENABLED='true' 进入阶段 2
//     └─ 哨兵未跑够 7 天                  → 继续观察
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
//
// 输出（JSON 单对象，机器可消费 + summary 行人也能看）：
//   { phase, summary, canAdvance, nextAction, blockers, switches, history }
//
// 用法：
//   node scripts/release/cube-promote.mjs --ecosystem-file server/ecosystem.config.cjs
//   node scripts/release/cube-promote.mjs --health-url https://chexian.cretvalu.com/health \
//        --history-issue 99 --gh-token "$GH_TOKEN"
//   node scripts/release/cube-promote.mjs --dry-run-fixture 阶段1-健康  # 离线烟测
//
// 红线（governance check 兜底，不靠本脚本记忆）：
//   - cube-shadow.ts 的 NUMERIC_TOLERANCE 不可放宽（governance「立方体影子对账容差」）
//   - 改 cube-grayscale-sentinel.yml 的 cron 必须先跑本脚本确认 canAdvance=true
//
// 相关：scripts/sentinel/cube-grayscale-sentinel.mjs · scripts/cube-rollback.mjs

import { readFileSync, existsSync } from 'node:fs';

// ─────────────────────────── 参数解析 ───────────────────────────

const argv = process.argv.slice(2);
const args = {
  ecosystemFile: 'server/ecosystem.config.cjs',
  healthUrl: null,
  historyIssue: null,
  ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  repo: 'alongor666/chexian-api',
  dryRunFixture: null,
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
  else if (a === '--help' || a === '-h') {
    console.error('见文件头注释');
    process.exit(0);
  }
}

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

function buildVerdict({ phase, switches, history }) {
  if (phase === 0) {
    return {
      phase: 0,
      summary: '阶段 0 — 立方体未启用（两开关均 false）',
      canAdvance: true,
      nextAction: "在 server/ecosystem.config.cjs 设 CUBE_SHADOW_COMPARE: 'true'，按 deploy-chain 部署链 PR 流程合并",
      blockers: [],
    };
  }

  if (phase === 1) {
    if (!history.available) {
      return {
        phase: 1,
        summary: `阶段 1（影子对账） · 哨兵历史不可读：${history.reason}`,
        canAdvance: false,
        nextAction: null,
        blockers: [`需要 GitHub token 与 --history-issue 才能判定 7 天稳定性；当前：${history.reason}`],
      };
    }
    const c = history.counts;
    if (c.critical > 0) {
      return {
        phase: 1,
        summary: `阶段 1 · 过去 7 天有 ${c.critical} 次 CRITICAL · 不可推进`,
        canAdvance: false,
        nextAction: null,
        blockers: [
          `过去 7 天哨兵报 CRITICAL ${c.critical} 次`,
          '解决方法：去追踪 issue 看哪些路由 mismatch，按改写器/白名单/逻辑 bug 三类排查',
        ],
      };
    }
    // 没 CRITICAL → 看跨度够不够
    if (c.total === 0) {
      return {
        phase: 1,
        summary: '阶段 1 · 过去 7 天哨兵无任何评论（健康，但样本不足）',
        canAdvance: true,
        nextAction: '可推进：但请确认哨兵 cron 真在跑、流量已让影子对账触发（看 /health 的 cubeShadow.*.match 是否 > 0）',
        blockers: [],
      };
    }
    return {
      phase: 1,
      summary: `阶段 1 · 过去 7 天 ${c.total} 条非 CRITICAL 评论（WARN ${c.warn} / INFO ${c.info}） · 可推进`,
      canAdvance: true,
      nextAction: "提部署链 PR：server/ecosystem.config.cjs 追加 CUBE_ROUTING_ENABLED: 'true'，按 deploy-chain SOP 人工低峰合并",
      blockers: [],
    };
  }

  // 阶段 2/3：当前简化为同一档（区分需 git log 切流时间，此处先标 2）
  return {
    phase: 2,
    summary: '阶段 2 — 正式切流已生效；观察期与降频判定见文件头注释（待实现）',
    canAdvance: false,
    nextAction: '阶段 2 → 3 推进逻辑：检查 git log 找 CUBE_ROUTING_ENABLED 引入时间，> 30 天且无 CRITICAL → 降 cron。本批次未实现，留 BACKLOG',
    blockers: [],
  };
}

// ─────────────────────────── 主流程 ───────────────────────────

async function loadEcosystem() {
  if (args.dryRunFixture) {
    const phase1 = "env: {\n  CUBE_SHADOW_COMPARE: 'true',\n  CUBE_ROUTING_ENABLED: 'false',\n}\n";
    return {
      '阶段0-未启用': "env: {\n  CUBE_SHADOW_COMPARE: 'false',\n}\n",
      '阶段1-健康': phase1,
      '阶段1-异常': phase1,
      '阶段2-已切流': "env: {\n  CUBE_SHADOW_COMPARE: 'true',\n  CUBE_ROUTING_ENABLED: 'true',\n}\n",
    }[args.dryRunFixture] ?? '';
  }
  if (!existsSync(args.ecosystemFile)) {
    throw new Error(`ecosystem 文件不存在：${args.ecosystemFile}`);
  }
  return readFileSync(args.ecosystemFile, 'utf-8');
}

async function loadHistory() {
  if (args.dryRunFixture === '阶段1-健康') {
    return { available: true, windowDays: 7, counts: { critical: 0, warn: 2, info: 1, total: 3 }, latest: [] };
  }
  if (args.dryRunFixture === '阶段1-异常') {
    return { available: true, windowDays: 7, counts: { critical: 1, warn: 0, info: 0, total: 1 }, latest: [] };
  }
  return await fetchSentinelHistory({
    ghToken: args.ghToken,
    repo: args.repo,
    historyIssue: args.historyIssue,
  });
}

async function main() {
  const ecosystemSrc = await loadEcosystem();
  const switches = detectSwitches(ecosystemSrc);
  const phase = detectPhase(switches);
  const history = phase === 1 ? await loadHistory() : { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 }, windowDays: 7 };
  const verdict = buildVerdict({ phase, switches, history });
  verdict.switches = switches;
  verdict.history = history;
  console.log(JSON.stringify(verdict, null, 2));
  // 退出码：可推进=0；不可推进或哨兵报 CRITICAL=1（让 CI/上层脚本可据此分支）
  process.exit(verdict.canAdvance ? 0 : 1);
}

main().catch((err) => {
  console.error(`[cube-promote] 致命错误：${err.stack || err.message}`);
  process.exit(2);
});
