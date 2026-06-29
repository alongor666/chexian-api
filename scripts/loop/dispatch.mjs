#!/usr/bin/env node
/**
 * Loop v2 调度器（dispatch）— 多会话并行的「可并行前沿」计算 + 状态板 + 会话提示词。
 *
 * 设计：.claude/rules/loop-orchestration.md §1。SSOT = BACKLOG_LOG.jsonl（append-only 事件日志）。
 * 不引入新数据源：任务的「文件域」来自 create 事件已有的 `code` 字段。
 *
 * 用法：
 *   bun run loop:dispatch            # 打印前沿 + 状态板 + 每个前沿任务的会话提示词（默认 fetch 收集跨会话认领）
 *   bun run loop:dispatch --json     # 机读 JSON（供 Workflow 编排会话消费）
 *   bun run loop:dispatch --board    # 仅状态板
 *   bun run loop:dispatch --no-fetch # 跳过 git fetch（用现有远程跟踪分支算认领，离线/省时）
 *   bun run loop:dispatch --no-claims# 完全关闭跨会话认领锁（回退旧行为，仅本地 inflight）
 *
 * 跨会话认领锁（§4 P0 根治）：认领事件（status IN_PROGRESS + push）可能在会话 feature 分支尚未并 main，
 * 故 CLI gatherClaimContext 扫 origin/main + 所有 origin/claude/* 的 BACKLOG_LOG.jsonl（union 去重）算认领；
 * computeFrontier 把「别会话新鲜认领」锁出前沿。详见 latestClaims / computeFrontier 注释。
 *
 * 纯函数（foldBacklog / bucketOf / taskDomains / computeFrontier / latestClaims / mergeGate）单独导出供单测，
 * 不碰文件系统/网络；CLI main 与 gatherClaimContext 才做 I/O（git/网络不可用时优雅降级）。
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
// P1-1（codex 闸-2）：复用 backlog **权威折叠**，不自己实现。
// 权威 fold 按 (at,eid) 全序排序、amend 用 {field,value} schema（LWW）、分支无关；
// 自实现的物理行序 + 顶层 amend 字段会漏读 amend → 可能把 DONE 读回 OPEN、破坏 deps/冲突图。
import { parseLog, fold, loadLog } from '../backlog/lib.mjs';
// 跨会话认领锁的「辅助信号」：远程 loop 分支存在性（边界匹配，复用 stale-scan 同一实现避免漂移）。
import { branchMatchesUid } from './stale-scan.mjs';
// E1 失败记账：复用 quality-report 的 verdict 归一 + 规范 uid + 完成态集合（单一事实源·codex 闸-1 P2-4），
// 避免 dispatch 与 quality-report 对「已入账」理解分叉。
import { normalizeVerdict, ledgerUid, COMPLETION_VERDICTS } from './quality-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
// 路径 env 可覆盖（默认指向真实文件，prod 行为不变；供 e2e 用 temp 路径隔离·不污染真实账本）。
const LOG_PATH = process.env.LOOP_BACKLOG_LOG || path.join(ROOT, 'BACKLOG_LOG.jsonl');
const LEDGER_PATH = process.env.LOOP_LEDGER_PATH || path.join(ROOT, '.claude/workflow/loop-quality-ledger.jsonl');
const CONFIG_PATH = path.join(ROOT, 'scripts/loop/dispatch-config.json');

/** 视为「未完成、可推进」的状态（BLOCKED 单列：不进前沿，但状态板展示）。 */
export const OPEN_STATUSES = new Set([
  'PROPOSED', 'TRIAGED', 'TODO', 'DOING', 'IN_PROGRESS', 'PARTIAL',
]);

/** 视为「活跃认领（某会话正在做）」的状态——最新 status 命中即认领，其 at 决定新鲜度。 */
export const CLAIM_STATUSES = new Set(['IN_PROGRESS', 'DOING']);

/** 默认认领时效（小时）：认领后超过此时长仍无后续事件 → 视为陈旧（会话疑似死亡），释放回前沿防死锁。 */
export const DEFAULT_CLAIM_TTL_HOURS = 8;

/** ISO 字符串 / 毫秒数 → 毫秒（无法解析 → null）。纯函数。 */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 从事件数组提取「当前活跃认领」（跨会话锁的**主信号**）。纯函数（无时钟 / 无 fs / 无 git）。
 *
 * 对每个 uid 取其**最新 status 事件**（与 backlog/lib.fold 同序：(at||ts, eid) 全序、分支无关）判定认领态：
 * 若该状态 ∈ CLAIM_STATUSES 则记为认领，返回 `{actor, at, lastAt}`。`at`=认领时刻（最新 status 的 at）；
 * `lastAt`=该 uid **任意事件**（note/amend/status 皆算「推进」）的最新时刻——TTL 据 lastAt 算新鲜度，
 * 故认领后只要有后续活动就刷新锁（codex 闸-2 P1：旧实现只看 status at，会把 7.5h 前还在 note 的活跃会话误释放）。
 * 认领后流转到 DONE/PARTIAL/… 即自动失效（最新 status 不再是 CLAIM_STATUSES）。
 *
 * 跨会话可见性：会话开工即 `bun scripts/backlog.mjs status <uid> IN_PROGRESS --actor <session>` 写入
 * BACKLOG_LOG.jsonl（merge=union）并立即 push；别的会话 dispatch 收集多 ref 日志（CLI 侧 gatherClaimContext）
 * 后即见此认领，computeFrontier 据此把任务锁出前沿，根治「多会话排空同一前沿 → 重复劳动」（§4 P0）。
 * @param {Array<object>} events 已解析事件（可跨多个 ref 合并去重后传入）
 * @returns {Object<string,{actor:string,at:string,lastAt:string}>}
 */
export function latestClaims(events) {
  const indexed = (events || []).map((e, i) => ({ e, i })).filter((x) => x.e && x.e.uid);
  // 每 uid「最后活动」时刻 = 任意事件 (at||ts) 的字典序最大（ISO/日期串可比；TTL 据此 → 任何后续事件刷新锁）
  const lastAtByUid = new Map();
  for (const { e } of indexed) {
    const at = e.at || e.ts || '';
    const prev = lastAtByUid.get(e.uid);
    if (prev === undefined || at > prev) lastAtByUid.set(e.uid, at);
  }
  // 每 uid 最新 status 事件（与 fold 同 (at||ts, eid) 全序）→ 判定是否处于认领态 + 认领人 + 认领时刻
  const statusSorted = indexed
    .filter((x) => x.e.kind === 'status' && x.e.status)
    .sort((a, b) => {
      const ka = a.e.at || a.e.ts || '';
      const kb = b.e.at || b.e.ts || '';
      if (ka !== kb) return ka < kb ? -1 : 1;
      const ea = a.e.eid || '';
      const eb = b.e.eid || '';
      if (ea !== eb) return ea < eb ? -1 : 1;
      return a.i - b.i; // 兜底：(at,eid) 全等时按原序（带 eid 的事件不会走到）
    });
  const latestStatus = new Map(); // uid -> 最新 status 事件（升序遍历，末写覆盖 = 最新）
  for (const { e } of statusSorted) latestStatus.set(e.uid, e);
  const claims = {};
  for (const [uid, e] of latestStatus) {
    if (CLAIM_STATUSES.has(e.status)) {
      const at = e.at || e.ts || '';
      claims[uid] = { actor: e.actor || '?', at, lastAt: lastAtByUid.get(uid) || at };
    }
  }
  return claims;
}

/**
 * 折叠事件日志 → 每 uid 的当前任务态。**委托 backlog/lib.mjs 权威 fold**（单一事实源），
 * 仅把 Map 转数组，保留本模块/单测的数组 API。
 * @param {string[]} lines BACKLOG_LOG.jsonl 行
 * @returns {Array<object>} lib.fold 的任务对象（uid/desc/code/docs/section/priority/status…）
 */
export function foldBacklog(lines) {
  return [...fold(parseLog(lines.join('\n'))).values()];
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
  // P1-3（2026-06-22 wave-2 复盘）：边界用 `(?:\/|$)` 而非硬尾斜杠 `\/`——否则**目录形式**
  // code（如 `server/src/sql` 无尾斜杠）落不到 be-sql、回退到 `^server` → 误归 be-other，
  // 导致域互斥漏判（b331 的 server/src/sql 与 b244 的 claims-detail.ts 真重叠未被检出，险并行撞车）。
  const rules = [
    [/^src(?:\/|$)/, 'frontend'],
    [/^server\/src\/sql(?:\/|$)/, 'be-sql'],
    [/^server\/src\/routes(?:\/|$)/, 'be-routes'],
    [/^server\/src\/services(?:\/|$)/, 'be-services'],
    [/^server\/src\/config(?:\/|$)/, 'be-config'],
    [/^server\/src\/middleware(?:\/|$)/, 'be-middleware'],
    [/^server\/src\/utils(?:\/|$)/, 'be-utils'],
    [/^server\/src\/agent(?:\/|$)/, 'be-agent'],
    [/^server(?:\/|$)/, 'be-other'],
    [/^数据管理(?:\/|$)/, 'etl'],
    [/^scripts(?:\/|$)/, 'scripts'],
    [/^cli(?:\/|$)/, 'cli'],
    [/^mcp(?:\/|$)/, 'mcp'],
    [/^开发文档(?:\/|$)/, 'docs'],
    [/^\.claude(?:\/|$)/, 'meta'],
  ];
  for (const [re, b] of rules) if (re.test(s)) return b;
  // P1-2（codex 闸-2）：未知 token（N/A、同B244、自由文本、未识别前缀路径）**返回 null**，
  // **绝不臆造伪域**——臆造会让自由文本任务进前沿、漏检真实重叠 → 并行撞车。
  // 仅当看似真实路径（含 / 且含扩展名）才回退到「前两段」作粗域；否则 null（→ 调用方推迟、待人工指派）。
  if (s.includes('/') && /\.[a-zA-Z0-9]+$/.test(s)) return s.split('/').slice(0, 2).join('/');
  return null;
}

/** 任务触碰的域桶集合（config.tasks.<uid>.domain 可覆盖）。分隔符含中文/英文分号（旧 backlog 用「；」「;」）。 */
export function taskDomains(task, override = {}) {
  const o = override[task.uid];
  if (o && Array.isArray(o.domain) && o.domain.length) return new Set(o.domain);
  const codes = String(task.code || '').split(/[,\s；;]+/).filter(Boolean);
  const set = new Set();
  for (const c of codes) { const b = bucketOf(c); if (b) set.add(b); }
  return set;
}

/**
 * 算可并行前沿：OPEN(非 DONE/BLOCKED) + deps 全 DONE + 非在飞 + 非 gated/exclude + 非「别会话新鲜认领」，
 * 按优先级贪心取「域桶互斥」的独立集。其余串行到后续波。
 *
 * 跨会话认领锁（§4 P0「跨会话重复劳动」根治）：`config.claims`（{uid:{actor,at}}，由 CLI 从多 ref 日志
 * 经 latestClaims 算好注入）+ `config.now`（ISO/ms）+ `config.claimTtlHours`（默认 8h）。某 uid 有**新鲜**
 * 认领（age<TTL）→ 锁出候选（不重复派单）；**陈旧**认领（age≥TTL，会话疑似死亡）→ 释放回前沿防死锁。
 * 纯函数：claims/now 全部注入，本函数不碰时钟/网络，便于单测。无 claims/now 时行为与旧版一致（向后兼容）。
 * @returns {{frontier, candidates, blocked, deferred, inflight, claimed, released}}
 */
export function computeFrontier(tasks, config = {}) {
  const override = config.tasks || {};
  const inflight = new Set(config.inflight || []);
  const deps = config.deps || {};
  const done = new Set(tasks.filter((t) => t.status === 'DONE').map((t) => t.uid));

  // 跨会话认领锁。缺时钟信息（无 now 或时间不可解析）→ 保守视为新鲜（锁出，宁可串行勿重复派单）。
  const claims = config.claims || {};
  const nowMs = toMs(config.now);
  // ttl 校验（codex 闸-2 P2）：非正有限数（'bad'/0/负/null）→ 回退默认，避免误配静默释放所有认领。
  const ttlHoursRaw = config.claimTtlHours;
  const ttlHours = (typeof ttlHoursRaw === 'number' && Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0)
    ? ttlHoursRaw : DEFAULT_CLAIM_TTL_HOURS;
  const ttlMs = ttlHours * 3600 * 1000;
  const claimInfo = (uid) => {
    const c = claims[uid];
    if (!c) return null;
    // TTL 据「最后活动」lastAt（任何后续事件刷新锁，codex 闸-2 P1）；lastAt 缺省回退认领时刻 at（兼容直传 claims）。
    const lastMs = toMs(c.lastAt != null ? c.lastAt : c.at);
    if (nowMs == null || lastMs == null) return { actor: c.actor || '?', at: c.at || '', ageMs: null, fresh: true };
    const ageMs = nowMs - lastMs;
    return { actor: c.actor || '?', at: c.at || '', ageMs, fresh: ageMs < ttlMs };
  };

  // P1-3（codex 闸-2）：GATED 双判 = 显式 config（tasks.<uid>.gated）∪ 精确 cutover 关键词。
  // ⚠️ 关键词必须**精确指向不可逆 cutover 动作**（RLS-on 上线 / sync VPS 发账号 / cutover），
  //   **不可用「GATED」**——多省「GATED 上线前置」任务是该做的前置，含「GATED」字样若被排除会误伤。
  const gatedKeywords = config.gatedKeywords || ['cutover', 'RLS-on 上线', 'sync VPS 发账号', 'RLS-on→', '进 current/ →'];
  const isGated = (t) =>
    override[t.uid]?.gated === true
    || gatedKeywords.some((kw) => String(t.desc || '').includes(kw) || String(t.section || '').includes(kw));

  const candidates = tasks.filter((t) => {
    const st = t.status || 'PROPOSED';
    if (!OPEN_STATUSES.has(st)) return false;          // DONE / BLOCKED / 未知 → 不候选
    if (inflight.has(t.uid)) return false;             // 在飞（本地 config）→ 不重复派单
    const ci = claimInfo(t.uid);
    if (ci && ci.fresh) return false;                  // 🔒 别会话新鲜认领（跨会话锁）→ 不重复派单
    if (override[t.uid]?.exclude) return false;
    if (isGated(t)) return false;                      // 🔴 GATED cutover：永不自动进前沿（须用户确认）
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

  // 认领报表：仅对 OPEN 任务（DONE/BLOCKED 残留认领不计）。新鲜→claimed（已锁出）；陈旧→released（已释放回前沿）。
  const claimed = [];
  const released = [];
  for (const t of tasks) {
    if (!OPEN_STATUSES.has(t.status || 'PROPOSED')) continue;
    const ci = claimInfo(t.uid);
    if (!ci) continue;
    (ci.fresh ? claimed : released).push({ task: t, actor: ci.actor, at: ci.at, ageMs: ci.ageMs });
  }

  return {
    frontier,
    candidates,
    deferred,
    blocked: tasks.filter((t) => t.status === 'BLOCKED'),
    inflight: [...inflight],
    claimed,
    released,
  };
}

/**
 * 合并门串行化闸（方案 B 配套 · 根治「CI 双绿但 state=BEHIND」活锁的「不迁 org」路径）。
 *
 * 背景：main 分支保护改 `strict=false` 后 BEHIND 活锁消除，但并行 PR 可**同时转绿同时合并**
 * → 放弃了「组合一起测过」的保证。本闸把**合并阶段**串行化：同一时刻只放一个在飞 PR 过合并门
 * （slot holder），其余按序排队（queue）。slot holder 落地 main → 移出 inflight → 下一个递补；
 * 排队 PR 合并前必须 `git fetch origin main && git merge origin/main` 重新转绿，于是每个 PR 都对
 * **累积后的 main** 验证过 → 近似恢复合并队列的「组合一起测过」，而无需迁 org / 用合并队列。
 *
 * 纯函数（不碰文件系统/网络/时钟）：给定在飞集 + 任务态，确定性算出**合并次序**。
 * PR 是否已转绿由会话侧 `gh pr checks` 判断；本闸只决定**谁现在有资格合（次序）**，不决定时机。
 * 次序与 computeFrontier 一致：priority 升序 → uid 升序（确定可复现）。in flight 集复用
 * computeFrontier 同一来源（config.inflight）：computeFrontier 把在飞**排除出前沿**（不重复派单），
 * 本闸把在飞**纳入合并门**（决定谁先合），二者互补。
 *
 * @param {Array<object>} tasks foldBacklog 结果
 * @param {object} config dispatch-config（读 config.inflight）
 * @returns {{slot: object|null, queue: object[], skipped: string[]}}
 *   slot=当前唯一可合任务（null=在飞集空）；queue=须等待者（按合并次序）；
 *   skipped=被剔除的 inflight 项（已 DONE 应移出 / 不在 backlog，附原因）。
 */
export function mergeGate(tasks, config = {}) {
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  const skipped = [];
  const live = [];
  for (const uid of (config.inflight || [])) {
    const t = byUid.get(uid);
    if (!t) { skipped.push(`${uid}(不在 backlog)`); continue; }
    if (t.status === 'DONE') { skipped.push(`${uid}(已 DONE → 应移出 inflight)`); continue; }
    live.push(t);
  }
  const order = live.sort((a, b) =>
    String(a.priority || 'P9').localeCompare(String(b.priority || 'P9'))
    || (a.uid < b.uid ? -1 : 1),
  );
  return { slot: order[0] || null, queue: order.slice(1), skipped };
}

/**
 * E1 账本记失败（治茧房1 幸存者偏差·纯函数·codex 闸-1 已硬化）：把本轮调度发现的「陈旧认领（孤儿）」与
 * 「BLOCKED」任务，算出需追加到质量账本的失败行——这些任务流程上走不到「成功收尾记账步」，不记账则北极星
 * 「一次过率」只在幸存样本上算、放弃率不可见。
 *
 * 三层防重复（确保 oracle「连跑两次 dispatch 仍只 1 条 orphaned」+ 并发安全）：
 *  1. **accounted 守卫**：uid 已在账本有「完成态」行（pass/partial/reverted）→ 跳过。避免把「完成了但 BACKLOG
 *     状态没翻 DONE」的任务（其陈旧认领仍出现在 released）误记孤儿——那是 stale-scan「已完成未流转」域，
 *     非 E1「失败失明」域（codex 闸-1 假阳性防护；实测排除 b244/b255/b320 三例）。
 *  2. **orphaned (uid, claim_at) 写时去重**：claim_at=认领时刻（latestClaims 的 `at`，跨 dispatch 稳定，
 *     **非**刷新的 lastAt）；同键已记 → 跳过。重新认领（新 claim_at）= 新尝试 → 记新行（codex 闸-1 P1-3）。
 *  3. **blocked uid 写时去重**：BLOCKED 是任务级状态（非 attempt），同 uid 只记一次。
 *  schema 漂移（uid/backlog_uid）由 ledgerUid 吸收（codex 闸-1 P1-6）；并发/union 重复由 quality-report 读时去重兜底。
 *
 * 失败行**故意不造** rounds_to_green/governance_pass 等完成指标（无完成=无指标；aggregate avg 只算有指标的行）。
 *
 * @param {object} p
 * @param {Array<{task:object,actor?:string,at?:string,ageMs?:number}>} p.released computeFrontier 的 released（陈旧认领）
 * @param {Array<object>} p.blocked computeFrontier 的 blocked（status=BLOCKED）
 * @param {Array<object>} p.ledgerRows 既有账本解析行（判 accounted + 幂等）
 * @param {string} [p.ts] 记账日期 YYYY-MM-DD
 * @returns {Array<object>} 需 append 的新失败行（已去重；可能为空）
 */
export function failureLedgerRows({ released = [], blocked = [], ledgerRows = [], ts = '' } = {}) {
  const accounted = new Set();    // 已到达记账点（完成态）的 uid → 不再当失败
  const orphanedSeen = new Set(); // 既有 orphaned 的 (uid,claim_at) 键
  const blockedSeen = new Set();  // 既有 blocked 的 uid
  for (const r of ledgerRows) {
    const uid = ledgerUid(r);
    if (!uid) continue;
    const v = normalizeVerdict(r.verdict).verdict;
    // accounted = 已达定论的 uid：完成态（pass/partial/reverted）∪ 终态失败 `abandoned` → 不再补失败行。
    // abandoned 是显式终止（合同终态之一），若仍出现在 released 不可再补 orphaned 致双计（codex 闸-2 P1）。
    if (COMPLETION_VERDICTS.has(v) || v === 'abandoned') accounted.add(uid);
    else if (v === 'orphaned') orphanedSeen.add(`${uid}@@${r.claim_at || ''}`);
    else if (v === 'blocked') blockedSeen.add(uid);
  }

  const out = [];
  const domainsOf = (task) => [...taskDomains(task)];
  const hours = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms / 360000) / 10 : null);

  // 孤儿（陈旧认领）→ orphaned
  for (const r of released) {
    const uid = r.task && r.task.uid;
    const claimAt = r.at || '';
    if (!uid || !claimAt) continue;        // 缺稳定去重键 → 保守不记（防重复污染）
    if (accounted.has(uid)) continue;      // 已完成（状态未流转）→ 非孤儿
    const key = `${uid}@@${claimAt}`;
    if (orphanedSeen.has(key)) continue;   // 幂等：同认领已记
    orphanedSeen.add(key);                 // 同轮多条同键也只记一次
    const h = hours(r.ageMs);
    out.push({
      uid, ts, task: String((r.task && r.task.desc) || '').slice(0, 80), domain: domainsOf(r.task),
      verdict: 'orphaned', claim_at: claimAt, actor: r.actor || '?',
      reason: `认领锁 TTL 超时无推进（认领人 ${r.actor || '?'}，认领于 ${claimAt}${h != null ? `，陈旧 ${h}h` : ''}）→ 视为孤儿尝试`,
    });
  }

  // BLOCKED（任务级阻塞可见性）→ blocked
  for (const t of blocked) {
    const uid = ledgerUid(t) || (t && t.uid);
    if (!uid) continue;
    if (accounted.has(uid)) continue;
    if (blockedSeen.has(uid)) continue;
    blockedSeen.add(uid);
    out.push({
      uid, ts, task: String((t && t.desc) || '').slice(0, 80), domain: domainsOf(t),
      verdict: 'blocked', reason: 'BACKLOG status=BLOCKED（未达成功记账点，幸存者偏差补记）',
    });
  }
  return out;
}

/** 把失败行安全追加到账本（文件末换行安全；缺文件即创建）。返回写入条数。 */
function appendLedgerRows(ledgerPath, rows) {
  if (!rows.length) return 0;
  let prefix = '';
  try {
    const cur = fs.readFileSync(ledgerPath, 'utf-8');
    if (cur.length && !cur.endsWith('\n')) prefix = '\n'; // 末行无换行 → 先补，免拼成一行
  } catch { /* 文件不存在 → 直接创建 */ }
  fs.appendFileSync(ledgerPath, prefix + rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}

/**
 * 只读/查询模式判定（不写账本·codex 闸-2 P2）：`--json`(机读编排) / `--board`(看板) / `--merge-gate`(门禁)
 * 是查询用途，不应改历史数据；唯有**默认交互模式**（驱动 loop 的主入口）才幂等补记失败。集中判定便于单测锁定。
 */
export function isInspectMode(args) {
  return args.includes('--json') || args.includes('--board') || args.includes('--merge-gate');
}

/** 读账本 → 算失败行 → 幂等 append（CLI 侧 I/O 封装，读 LEDGER_PATH）。返回写入条数。 */
function reconcileFailureLedger(result, ts) {
  let ledgerRows = [];
  try {
    ledgerRows = fs.readFileSync(LEDGER_PATH, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* 无账本 → 空 */ }
  const rows = failureLedgerRows({ released: result.released || [], blocked: result.blocked || [], ledgerRows, ts });
  return appendLedgerRows(LEDGER_PATH, rows);
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
    `【🔒 认领（跨会话锁·防重复劳动）——开工立即做，先于实现】`,
    `bun scripts/backlog.mjs status ${task.uid} IN_PROGRESS --actor ${branch}`,
    `git add BACKLOG_LOG.jsonl BACKLOG.md BACKLOG_ARCHIVE.md && git commit -m "chore(loop): 认领 ${task.uid}（跨会话锁）" && git push -u origin ${branch}`,
    `（认领即推送 → 别的会话 dispatch 收集多 ref 日志会把本任务锁出前沿；认领后超 ${DEFAULT_CLAIM_TTL_HOURS}h 无后续事件会被自动释放。开工前先 \`bun run loop:dispatch\` 确认本任务未被别会话新鲜认领。）`,
    ``,
    `【任务】${task.desc}`,
    `（关联代码域：${task.code || '(未声明 code，先 grep 确认落点)'}；文档：${task.docs || '-'}）`,
    ``,
    `【按 Loop v2 协议（.claude/rules/loop-orchestration.md）执行】`,
    `1. 合同/计划（/chexian-evidence-loop）→ 🛡 闸-1（🔴 默认关闭·仅用户本次显式要求才跑）：codex 审计计划，修 P0/P1。`,
    `2. TDD 实现，只改本任务域（${domains.join(',')}），不碰其他会话域。`,
    `3. 确定性闸：bun run verify:full / governance 全过 / 字节安全证据。`,
    `4. 🛡 闸-2（🔴 默认关闭·仅用户本次显式要求才跑）：默认不跑 codex，code review 由 Claude /code-reviewer 自审兜底（fresh + 修复SOP，不起 evidence-verifier）；**仅本次显式要求** → codex 审 diff——**单源=codex CLI**（§2「调用方式」：\`codex exec --sandbox read-only - < prompt\` 文件，不经 skill；CLI 不可用→标 unavailable 向用户报缺口请授权，不回退 evidence-verifier/CI），跑 codex 时才不起 code-reviewer/不计 CI auto-review，P0/P1 全修 + 复审通过。correctness 由第 3 步确定性闸正交承担。`,
    `5. 收尾：backlog status 流转 + pr-evolution 三问复盘(needs_automation 紧跟 expires) + loop-quality-ledger 一行 → bundle 进代码提交 → PR。`,
    `6. 🚦 合并门 + 自动合并：确定性闸绿 + CI 双绿 + **非部署链** + code review 过（默认 /code-reviewer 自审；本次明示跑 codex 则其 P0/P1 全清）→ \`bun run loop:dispatch --merge-gate\` 确认 slot holder 后 \`gh pr merge --auto --squash\` **自动合并**（单任务无需人工交接；enable --auto 后禁再 push）。非 slot 则等前序落地 main → git fetch+merge 重新转绿再 enable。🔴 **部署链 PR**（deploy.yml/vps-wrapper/sync-vps/ecosystem）禁 auto-merge，人工选窗口合并并盯 CI 前 5 分钟。`,
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
  const claimed = result.claimed || [];
  const released = result.released || [];
  const ageH = (ms) => (ms == null ? '时长未知' : `${Math.round(ms / 360000) / 10}h`);
  L.push(`- 任务总数 ${tasks.length} · DONE ${done} · 候选 ${result.candidates.length} · **可并行前沿 ${result.frontier.length}** · 推迟 ${result.deferred.length} · BLOCKED ${result.blocked.length} · 在飞 ${result.inflight.length}${claimed.length ? ` · 🔒 跨会话认领 ${claimed.length}` : ''}${released.length ? ` · ♻️ 超时释放 ${released.length}` : ''}`);
  L.push('');
  L.push(`## 🟢 可并行前沿（本波派单，域互斥）`);
  if (result.frontier.length === 0) L.push('（空——队列无就绪且域互斥的任务）');
  for (const f of result.frontier) L.push(`- \`${f.task.uid}\` [${f.task.priority}] 域:${f.domains.join(',')} — ${String(f.task.desc).slice(0, 70)}`);
  L.push('');
  if (claimed.length) {
    L.push(`## 🔒 跨会话认领（别的会话在做·已锁出前沿，防重复劳动）`);
    for (const c of claimed) L.push(`- \`${c.task.uid}\` 认领人 ${c.actor} · ${ageH(c.ageMs)} 前 — ${String(c.task.desc).slice(0, 60)}`);
    L.push('');
  }
  if (released.length) {
    L.push(`## ♻️ 认领超时释放（≥ TTL 无推进，已释放回前沿——请确认原会话是否仍在做，避免再次撞车）`);
    for (const c of released) L.push(`- \`${c.task.uid}\` 原认领人 ${c.actor} · 认领于 ${ageH(c.ageMs)} 前 — ${String(c.task.desc).slice(0, 60)}`);
    L.push('');
  }
  L.push(`## 🟡 推迟（域冲突/缺域，待下一波或人工指派）`);
  for (const d of result.deferred.slice(0, 20)) L.push(`- \`${d.task.uid}\` [${d.task.priority}] — ${d.reason}`);
  L.push('');
  L.push(`## 🔴 BLOCKED`);
  for (const b of result.blocked.slice(0, 20)) L.push(`- \`${b.uid}\` — ${String(b.desc).slice(0, 70)}`);
  return L.join('\n');
}

/** 渲染合并门串行化状态（同一时刻只放一个 PR 过门）。 */
export function renderMergeGate(gate) {
  const L = [];
  L.push(`## 🚦 合并门（串行化闸：strict=false 下同一时刻只放一个 PR 过门）`);
  if (!gate.slot) {
    L.push('（在飞集为空——无 PR 在合并门排队）');
  } else {
    L.push(`- ✅ **当前可合 slot holder**：\`${gate.slot.uid}\` [${gate.slot.priority || 'P?'}] — ${String(gate.slot.desc || '').slice(0, 60)}`);
    if (gate.queue.length) {
      L.push(`- ⏳ 排队（须等 slot 让出 → fetch+merge main 重新转绿再合）：`);
      for (const t of gate.queue) L.push(`    - \`${t.uid}\` [${t.priority || 'P?'}]`);
    } else {
      L.push(`- （无其他在飞 PR 排队）`);
    }
  }
  if (gate.skipped.length) L.push(`- ⚠️ 已剔除（应从 config.inflight 移出）：${gate.skipped.join('、')}`);
  return L.join('\n');
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}

/**
 * 收集跨 ref 的认领事件（主锁）+ 远程 loop 分支名（辅助信号）。best-effort，环境不可抗力（离线/限流/无 git）优雅降级。
 * 认领可能 push 在会话 feature 分支（claude/loop-*）尚未并入 main，故需扫 origin/main + 所有 origin/claude/*；
 * 各 ref 的 BACKLOG_LOG.jsonl 都 append-only + merge=union，按 eid 去重后并集仍可被 latestClaims 正确折叠。
 * @returns {{events: object[], branches: string[]}}
 */
function gatherClaimContext(localLines, { fetch = true } = {}) {
  let events = [];
  try { events = parseLog(localLines.join('\n')); } catch { events = []; }
  const seen = new Set(events.map((e) => e.eid).filter(Boolean));
  const branches = [];
  const mergeText = (text) => {
    let evs;
    try { evs = parseLog(text); } catch { return; }
    for (const e of evs) {
      if (e.eid && seen.has(e.eid)) continue; // union 去重（同事件跨 ref 重复）
      if (e.eid) seen.add(e.eid);
      events.push(e);
    }
  };
  const git = (cmd, opts = {}) => execSync(`git -C "${ROOT}" ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  if (fetch) { try { git('fetch origin --quiet', { timeout: 30000 }); } catch { /* 离线/限流 → 用现有远程跟踪分支 */ } }
  let refs = [];
  try {
    refs = git("for-each-ref --format='%(refname:short)' refs/remotes/origin")
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { refs = []; }
  // 安全：ref 名将插值进 `git show <ref>:...` shell 串。git 不禁 ref 名含 `;|$` 等元字符，恶意命名的
  // 远程分支可注入 → 严格字符白名单（合法 git 分支仅 \w./- ）过滤，非法 ref 直接丢弃（纵深防御）。
  const SAFE_REF = /^[\w./-]+$/;
  const matched = refs.filter((r) => SAFE_REF.test(r) && (r === 'origin/main' || r.startsWith('origin/claude/')));
  // 上限防失控（codex 闸-2 P2）：ref 名无新鲜度序，超限截断可能漏活跃认领 → 不静默，超限即告警（建议清理已合 loop 分支）。
  const REF_CAP = 200;
  if (matched.length > REF_CAP) console.error(`⚠️ [dispatch] 认领扫描分支 ${matched.length} 超上限 ${REF_CAP}，截断后可能漏掉部分远程认领——建议 cleanup-worktrees 清理已合并 loop 分支`);
  const claimRefs = matched.slice(0, REF_CAP);
  for (const r of claimRefs) {
    if (r.startsWith('origin/claude/')) branches.push(r.slice('origin/'.length));
    try { mergeText(git(`show ${r}:BACKLOG_LOG.jsonl`, { maxBuffer: 64 * 1024 * 1024 })); } catch { /* 该 ref 无此文件/不可读 → 跳过 */ }
  }
  return { events, branches };
}

function main() {
  const args = process.argv.slice(2);
  const localLines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
  const tasks = foldBacklog(localLines); // 任务宇宙/状态以本地 main 日志为准（与 BACKLOG.md 视图一致）
  const config = loadConfig();

  // 跨会话认领锁：认领信号从多 ref 日志收集（别会话 feature 分支上的认领亦可见），任务宇宙仍用本地。
  const useClaims = !args.includes('--no-claims');
  const doFetch = !args.includes('--no-fetch') && !args.includes('--local');
  let claims = {};
  let branches = [];
  if (useClaims) {
    const ctx = gatherClaimContext(localLines, { fetch: doFetch });
    claims = latestClaims(ctx.events);
    branches = ctx.branches;
  }
  const now = new Date().toISOString();
  const result = computeFrontier(tasks, { ...config, claims, now });
  const gate = mergeGate(tasks, config);

  // E1 失败记账（治幸存者偏差）：**仅默认交互模式**幂等补记孤儿/阻塞（codex 闸-1 P1-4）——
  // --json/--board/--merge-gate 是查询/编排/门禁，不应改历史数据；--no-orphan-ledger 显式退出。
  if (!isInspectMode(args) && !args.includes('--no-orphan-ledger')) {
    const wrote = reconcileFailureLedger(result, now.slice(0, 10));
    if (wrote) console.error(`♻️ [dispatch] 失败记账：质量账本追加 ${wrote} 条（孤儿/阻塞·治幸存者偏差，已 (uid,claim_at)/uid 幂等去重）`);
  }

  // 辅助信号：仍在前沿、却有匹配远程 loop 分支但无认领事件 → 疑似别会话已开工未认领（弱信号，软提示不硬锁）。
  const branchOnly = result.frontier.filter((f) => branches.some((b) => branchMatchesUid(b, f.task.uid)));

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      frontier: result.frontier.map((f) => ({ uid: f.task.uid, priority: f.task.priority, domains: f.domains, desc: f.task.desc, code: f.task.code })),
      claimed: result.claimed.map((c) => ({ uid: c.task.uid, actor: c.actor, ageHours: c.ageMs == null ? null : +(c.ageMs / 3600000).toFixed(2) })),
      released: result.released.map((c) => ({ uid: c.task.uid, actor: c.actor, ageHours: c.ageMs == null ? null : +(c.ageMs / 3600000).toFixed(2) })),
      branchNoClaim: branchOnly.map((f) => f.task.uid),
      deferred: result.deferred.map((d) => ({ uid: d.task.uid, reason: d.reason })),
      blocked: result.blocked.map((b) => b.uid),
      mergeGate: {
        slot: gate.slot ? { uid: gate.slot.uid, priority: gate.slot.priority } : null,
        queue: gate.queue.map((t) => ({ uid: t.uid, priority: t.priority })),
        skipped: gate.skipped,
      },
    }, null, 2) + '\n');
    return;
  }
  if (args.includes('--merge-gate')) {
    console.log(renderMergeGate(gate));
    return;
  }
  console.log(renderBoard(result, tasks));
  if (branchOnly.length) {
    console.log('\n## ⚠️ 远程分支存在但无认领事件（疑似别会话已开工未认领·弱信号，建议先 `bun scripts/backlog.mjs status <uid> IN_PROGRESS --actor <session>` 认领锁定）');
    for (const f of branchOnly) console.log(`- \`${f.task.uid}\` — 有匹配远程 loop 分支，却未见 IN_PROGRESS 认领事件`);
  }
  console.log('\n' + renderMergeGate(gate));
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
