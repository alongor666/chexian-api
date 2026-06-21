#!/usr/bin/env node
/**
 * Loop v2 调度器（dispatch）— 多会话并行的「可并行前沿」计算 + 状态板 + 会话提示词。
 *
 * 设计：.claude/rules/loop-orchestration.md §1。SSOT = BACKLOG_LOG.jsonl（append-only 事件日志）。
 * 不引入新数据源：任务的「文件域」来自 create 事件已有的 `code` 字段。
 *
 * 用法：
 *   bun run loop:dispatch            # 打印前沿 + 状态板 + 每个前沿任务的会话提示词
 *   bun run loop:dispatch --json     # 机读 JSON（供 Workflow 编排会话消费）
 *   bun run loop:dispatch --board    # 仅状态板
 *
 * 纯函数（foldBacklog / bucketOf / taskDomains / computeFrontier）单独导出供单测，
 * 不碰文件系统；CLI main 仅做 I/O。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'BACKLOG_LOG.jsonl');
const CONFIG_PATH = path.join(ROOT, 'scripts/loop/dispatch-config.json');

/** 视为「未完成、可推进」的状态（BLOCKED 单列：不进前沿，但状态板展示）。 */
export const OPEN_STATUSES = new Set([
  'PROPOSED', 'TRIAGED', 'TODO', 'DOING', 'IN_PROGRESS', 'PARTIAL',
]);

/**
 * 折叠事件日志 → 每 uid 的当前状态（create 填元数据；status 覆盖状态；amend 改字段）。
 * @param {string[]} lines BACKLOG_LOG.jsonl 行
 * @returns {Array<{uid,desc,code,docs,section,priority,actor,status}>} 按首次出现顺序
 */
export function foldBacklog(lines) {
  const order = [];
  const state = new Map();
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let d;
    try { d = JSON.parse(s); } catch { continue; }
    const u = d.uid;
    if (!u) continue;
    if (!state.has(u)) { state.set(u, { uid: u, status: undefined }); order.push(u); }
    const t = state.get(u);
    if (d.kind === 'create') {
      t.desc = d.desc || ''; t.code = d.code || ''; t.docs = d.docs || '';
      t.section = d.section || ''; t.priority = d.priority || 'P9'; t.actor = d.actor || '';
    } else if (d.kind === 'status') {
      t.status = d.status;
    } else if (d.kind === 'amend') {
      if (d.priority) t.priority = d.priority;
      if (d.section) t.section = d.section;
      if (d.desc) t.desc = d.desc;
      if (d.code) t.code = d.code;
    }
  }
  return order.map((u) => state.get(u));
}

/** 把一条 code 路径映射到粗粒度域桶（宁粗勿细：误判可并行→冲突，故偏保守）。
 * 先归一化旧 backlog `code` 字段常见噪声（反引号 / markdown 粗体 / `<br>` / `:行号(-范围)` 后缀）。 */
export function bucketOf(p) {
  const s = String(p || '')
    .replace(/[`*]/g, '')          // 去反引号 / markdown 粗体
    .replace(/<br\s*\/?>/gi, '')   // 去 <br>
    .replace(/:\d+(?:[-:]\d+)*$/, '') // 去 :行号 / :行-行 / :行:列 后缀
    .replace(/^\.\//, '')
    .trim();
  if (!s) return null;
  const rules = [
    [/^src\//, 'frontend'],
    [/^server\/src\/sql\//, 'be-sql'],
    [/^server\/src\/routes\//, 'be-routes'],
    [/^server\/src\/services\//, 'be-services'],
    [/^server\/src\/config\//, 'be-config'],
    [/^server\/src\/middleware\//, 'be-middleware'],
    [/^server\/src\/utils\//, 'be-utils'],
    [/^server\/src\/agent\//, 'be-agent'],
    [/^server\//, 'be-other'],
    [/^数据管理\//, 'etl'],
    [/^scripts\//, 'scripts'],
    [/^cli\//, 'cli'],
    [/^mcp\//, 'mcp'],
    [/^开发文档\//, 'docs'],
    [/^\.claude\//, 'meta'],
  ];
  for (const [re, b] of rules) if (re.test(s)) return b;
  return s.split('/').slice(0, 2).join('/') || 'misc';
}

/** 任务触碰的域桶集合（config.tasks.<uid>.domain 可覆盖）。 */
export function taskDomains(task, override = {}) {
  const o = override[task.uid];
  if (o && Array.isArray(o.domain) && o.domain.length) return new Set(o.domain);
  const codes = String(task.code || '').split(/[,\s]+/).filter(Boolean);
  const set = new Set();
  for (const c of codes) { const b = bucketOf(c); if (b) set.add(b); }
  return set;
}

/**
 * 算可并行前沿：OPEN(非 DONE/BLOCKED) + deps 全 DONE + 非在飞 + 非 gated/exclude，
 * 按优先级贪心取「域桶互斥」的独立集。其余串行到后续波。
 * @returns {{frontier, candidates, blocked, deferred, inflight}}
 */
export function computeFrontier(tasks, config = {}) {
  const override = config.tasks || {};
  const inflight = new Set(config.inflight || []);
  const deps = config.deps || {};
  const done = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.uid));

  const candidates = tasks.filter((t) => {
    const st = t.status || 'PROPOSED';
    if (!OPEN_STATUSES.has(st)) return false;          // DONE / BLOCKED / 未知 → 不候选
    if (inflight.has(t.uid)) return false;             // 在飞 → 不重复派单
    if (override[t.uid]?.exclude) return false;
    if (override[t.uid]?.gated) return false;          // 🔴 GATED：永不自动进前沿
    const ds = deps[t.uid] || [];
    if (!ds.every((d) => done.has(d))) return false;   // 前置未完成 → 不就绪
    return true;
  });

  const order = [...candidates].sort((a, b) =>
    String(a.priority || 'P9').localeCompare(String(b.priority || 'P9'))
    || (a.uid < b.uid ? -1 : 1),
  );

  const frontier = [];
  const used = new Set();
  const deferred = [];
  for (const t of order) {
    const ds = taskDomains(t, override);
    if (ds.size === 0) { deferred.push({ task: t, reason: 'no-domain(缺 code/未配 domain，需人工指派)' }); continue; }
    const clash = [...ds].some((d) => used.has(d));
    if (clash) { deferred.push({ task: t, reason: `域冲突(${[...ds].join(',')})` }); continue; }
    frontier.push({ task: t, domains: [...ds] });
    ds.forEach((d) => used.add(d));
  }
  return {
    frontier,
    candidates,
    deferred,
    blocked: tasks.filter((t) => t.status === 'BLOCKED'),
    inflight: [...inflight],
  };
}

/** 生成单个前沿任务的可粘贴会话提示词（off 最新 main + 并行安全协议 + 双闸）。 */
export function sessionPrompt({ task, domains }) {
  const slug = task.uid.split('-').pop();
  const branch = `claude/loop-${slug}`;
  const dir = `../chexian-api-${slug}`;
  return [
    `chexian-api loop 任务 ${task.uid}（域：${domains.join(',')}）。这是并行 loop 之一。`,
    ``,
    `【开工·off 最新 main 建独立 worktree】`,
    `cd /Users/alongor666/Downloads/底层数据湖DUD/chexian-api && git fetch origin main`,
    `git worktree add -b ${branch} ${dir} origin/main && cd ${dir}`,
    ``,
    `【任务】${task.desc}`,
    `（关联代码域：${task.code || '(未声明 code，先 grep 确认落点)'}；文档：${task.docs || '-'}）`,
    ``,
    `【按 Loop v2 协议（.claude/rules/loop-orchestration.md）执行】`,
    `1. 合同/计划（/chexian-evidence-loop）→ 🛡 闸-1：codex 审计计划，修 P0/P1。`,
    `2. TDD 实现，只改本任务域（${domains.join(',')}），不碰其他会话域。`,
    `3. 确定性闸：bun run verify:full / governance 42+/42 / 字节安全证据。`,
    `4. 🛡 闸-2：codex 审 diff + evidence-verifier 证伪 + CI auto-review，三源 P0/P1 全修。`,
    `5. 收尾：backlog status 流转 + pr-evolution 三问复盘(needs_automation 紧跟 expires) + loop-quality-ledger 一行 → bundle 进代码提交 → PR → enable --auto MERGE（之后禁再 push）。`,
    ``,
    `【并行安全】每轮起手 & push 前 git fetch origin main && git merge origin/main；BACKLOG_*/pr-evolution/quality-ledger 已 merge=union 自动并；push 前 gh pr list 查撞车。`,
    `🔴 GATED cutover 须用户显式确认，禁自动执行。`,
  ].join('\n');
}

/** 渲染状态板 markdown。 */
export function renderBoard(result, tasks) {
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const L = [];
  L.push(`# Loop 调度状态板（dispatch）`);
  L.push('');
  L.push(`- 任务总数 ${tasks.length} · DONE ${done} · 候选 ${result.candidates.length} · **可并行前沿 ${result.frontier.length}** · 推迟 ${result.deferred.length} · BLOCKED ${result.blocked.length} · 在飞 ${result.inflight.length}`);
  L.push('');
  L.push(`## 🟢 可并行前沿（本波派单，域互斥）`);
  if (result.frontier.length === 0) L.push('（空——队列无就绪且域互斥的任务）');
  for (const f of result.frontier) L.push(`- \`${f.task.uid}\` [${f.task.priority}] 域:${f.domains.join(',')} — ${String(f.task.desc).slice(0, 70)}`);
  L.push('');
  L.push(`## 🟡 推迟（域冲突/缺域，待下一波或人工指派）`);
  for (const d of result.deferred.slice(0, 20)) L.push(`- \`${d.task.uid}\` [${d.task.priority}] — ${d.reason}`);
  L.push('');
  L.push(`## 🔴 BLOCKED`);
  for (const b of result.blocked.slice(0, 20)) L.push(`- \`${b.uid}\` — ${String(b.desc).slice(0, 70)}`);
  return L.join('\n');
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

function main() {
  const args = process.argv.slice(2);
  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
  const tasks = foldBacklog(lines);
  const config = loadConfig();
  const result = computeFrontier(tasks, config);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      frontier: result.frontier.map((f) => ({ uid: f.task.uid, priority: f.task.priority, domains: f.domains, desc: f.task.desc, code: f.task.code })),
      deferred: result.deferred.map((d) => ({ uid: d.task.uid, reason: d.reason })),
      blocked: result.blocked.map((b) => b.uid),
    }, null, 2) + '\n');
    return;
  }
  console.log(renderBoard(result, tasks));
  if (!args.includes('--board') && result.frontier.length) {
    console.log('\n' + '='.repeat(70));
    console.log('## 前沿任务会话提示词（每段贴进一个独立会话）\n');
    for (const f of result.frontier) {
      console.log('```');
      console.log(sessionPrompt(f));
      console.log('```\n');
    }
  }
}

// 入口守卫：用 fileURLToPath 解码比较（仓库路径含非 ASCII 时 import.meta.url 会百分号编码，
// 直接字符串拼 file://${argv[1]} 会失配 → main 不执行）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
