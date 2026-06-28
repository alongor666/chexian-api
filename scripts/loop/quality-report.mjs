#!/usr/bin/env node
/**
 * Loop v2 质量账本聚合（quality-report）。
 *
 * 读 .claude/workflow/loop-quality-ledger.jsonl（append-only，merge=union），
 * 每行=一个任务收尾的结构化质量指标，聚合出北极星 + 趋势。
 *
 * 行 schema（见 .claude/rules/loop-orchestration.md §3）：
 *   完成行 {uid, round, ts, task, domain:[..], rounds_to_green, rework_count,
 *    codex_plan:{P0,P1,P2}, codex_done:{P0,P1,P2}, verifier_refuted,
 *    byte_safety_proof: "golden-baseline|by-construction|n/a",
 *    tests_added, governance_pass, pr, verdict: "pass|partial|reverted"}
 *   失败行（E1·dispatch 自动记账）{uid, ts, task, domain, verdict:"orphaned|blocked|abandoned",
 *    reason, claim_at?(orphaned 去重键), actor?}——无 rounds_to_green/governance_pass 等完成指标。
 *
 * E1 账本记失败（治幸存者偏差·2026-06-27）：verdict 归一（normalizeVerdict 单一事实源）后
 * 「非 pass 纳入分母」口径稳定；北极星不再只算幸存样本，新增放弃率/孤儿率/阻塞率。
 *
 * E2 注入外部真相（治自指闭环·2026-06-27）：账本原只读自产自评，外部真相断在闭环外。E2 接两条：
 *   ① git 史反查事后回滚——collectRevertedPrs 扫 revert/回滚/hotfix 提交解析「被回滚的原 PR 号」，
 *      aggregate 读时把命中的 pass/partial 行视为 reverted（**不改 append-only 历史行**，仿 E1 读时归一），
 *      北极星新增「事后回滚率」。
 *   ② owner 返工信号——读 .claude/workflow/user-rework-log.jsonl（append-only sink，owner 反馈后会话追加），
 *      每行 {uid?|pr?, count, reason, ts}；北极星新增「事后返工率」=有返工(count>0)的任务数/总任务数。
 *   两条都是「事后外部真相·读时关联到任务·不改账本历史行」，结构对称。
 *
 * E5 样本主题集中度（治茧房2 过拟合·2026-06-27）：账本 ~55% 任务属同一工程（"山西多省接入"），从单一
 *   工程样本提炼的规则自认通用实则专用。aggregate 增 concentration（读时计算不 mutate）：topic 维度（业务
 *   主题·task 文本分类·oracle 主结论 + 打标依据）+ domain 维度（技术域·双口径辅助，揭示"技术分桶掩盖主题
 *   集中"）；overfitFlag 给单一样本提炼的规则打"待跨域验证"标签（meta-review 约定见 loop-orchestration §4）。
 *
 * 用法：bun run loop:quality [--json]
 *
 * 纯函数 aggregate / normalizeVerdict / parseRevertedPrs / effectiveVerdict / collectRevertedPrs /
 * parseUserReworkLog / classifyTopic / hhiOf / overfitFlag 导出供单测与 dispatch 复用。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// 路径 env 可覆盖（默认真实账本；供 e2e / dispatch 失败记账 oracle 用 temp 路径隔离，与 dispatch.mjs 一致）。
const LEDGER_PATH = process.env.LOOP_LEDGER_PATH || path.join(ROOT, '.claude/workflow/loop-quality-ledger.jsonl');
// E2 外部真相源（均 env 可覆盖供端到端 oracle 隔离）：
//   LOOP_GIT_DIR — git 事后回滚反查的目录（默认 ROOT，即当前 worktree/仓库当前分支史）
//   LOOP_REWORK_PATH — owner 返工 sink 路径（默认 .claude/workflow/user-rework-log.jsonl）
const GIT_DIR = process.env.LOOP_GIT_DIR || ROOT;
const REWORK_PATH = process.env.LOOP_REWORK_PATH || path.join(ROOT, '.claude/workflow/user-rework-log.jsonl');

export function parseLedger(lines) {
  const rows = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
  }
  return rows;
}

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const findings = (o) => (o ? (Number(o.P0) || 0) + (Number(o.P1) || 0) + (Number(o.P2) || 0) : 0);

/** 历史成功同义词（顶层极少；防御性归一为 pass，免未来顶层使用被误判非 pass）。 */
const SUCCESS_SYNONYMS = new Set(['all_fixed', 'mergeable']);
/** 「到达记账点的完成态」规范 verdict（accounted 守卫 / avg 只算完成行据此）。 */
export const COMPLETION_VERDICTS = new Set(['pass', 'partial', 'reverted']);

/**
 * verdict 归一（**单一事实源**，dispatch.failureLedgerRows 复用本函数避免分叉·codex 闸-1 P2-4）。
 * 把既有历史 pass-* 变体（实测 5 种顶层：pass-after-fix / pass-pending-user-merge / pass-after-gate2-fix /
 * pass-with-documented-residual / pass-scoped）+ 成功同义词（all_fixed/mergeable）归一到规范 `pass` + 子标记；
 * 非 pass 规范终态（partial/reverted/abandoned/orphaned/blocked）原样透传；未知值小写保留（不臆造）；
 * 空/缺失 → unknown。「非 pass 纳入分母」口径据归一后判定才稳（codex #812 P2）。
 * @param {string} raw 原始 verdict
 * @returns {{verdict:string, qualifier:(string|null)}}
 */
export function normalizeVerdict(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v) return { verdict: 'unknown', qualifier: null };
  if (v === 'pass') return { verdict: 'pass', qualifier: null };
  if (v.startsWith('pass-') || v.startsWith('pass_')) return { verdict: 'pass', qualifier: v.slice(5) };
  if (SUCCESS_SYNONYMS.has(v)) return { verdict: 'pass', qualifier: v };
  return { verdict: v, qualifier: null };
}

/** ledger 行的规范 uid（吸收 uid/backlog_uid schema 漂移·codex 闸-1 P1-6）。 */
export function ledgerUid(row) {
  return (row && (row.uid || row.backlog_uid)) || null;
}

// ============ E2 注入外部真相①：git 史反查「事后回滚」（治自指闭环·2026-06-27）============

/** 引号段（英文直引号 + 中文弯引号/直角引号）——GitHub/git revert 标题里「被回滚原 PR 号」在引号内。 */
const QUOTE_SEG_RE = /["“”「」]([^"“”「」]*)["“”「」]/g;
/** PR 号 #数字。 */
const PR_NUM_RE = /#(\d+)/g;
/**
 * 无引号兜底：仅 revert/回滚 动词邻近窗口（≤80 个非 # 字符）内的 #N 才算被回滚 PR——
 * 避免把普通 hotfix（`hotfix: fix prod (#123)`）/ issue 号 / revert PR 自身号误标（codex 闸-1 P1-4/P1-5）。
 * hotfix 仍在 git `--grep` 候选集（遵任务规划），但本窗口不认 hotfix 单独触发取号，故纯 hotfix 提交不污染回滚率。
 * `(?<![Pp][Rr])` 排除 `PR#N`（PR 紧贴 #、无空格）——本仓「codex P1 PR#391」式**来源标注**习惯，非回滚对象
 * （真实数据实测 #391 误报根因：`修正 PM2 回滚命令语法（codex P1 PR#391）` 的「回滚」是名词修饰、#391 是来源）；
 * 真 revert 的 `#N` / `(#N)` / `PR #N`（带空格）不受影响。GitHub revert 走引号主路径、根本不依赖本兜底。
 * 残留局限（codex 闸-2 P2-2，诚实标注）：若来源标注写成**带空格** `PR #N` 且落在「回滚」≤80 字符窗口内，仍会误命中——
 * `PR #N` 带空格既是真 revert 引用格式（`回滚 PR #710`）又可能是带空格来源标注，二者中文语境无法正则区分；
 * 本仓来源标注实测均为紧贴 `PR#N`（已 lookbehind 排除），故保留带空格 `PR #N` 命中为真 revert。
 */
const REVERT_VERB_WINDOW_RE = /(?:revert|回滚)[^#]{0,80}?(?<![Pp][Rr])#(\d+)/gi;

/**
 * 从单条 revert 类提交 subject 解析「被回滚的原 PR 号」。
 * GitHub/git revert 格式 `Revert "<原标题 (#N)>" (#M)`：引号内 #N = 被回滚原 PR（要的），
 * 引号外 #M = revert 操作自身的 PR（排除）。故：
 *   ① 优先取**所有**引号段内的 #N（排除引号外自身号；多段并集·codex 闸-1 P2-2）；
 *   ② 无引号段命中时，才退化到「revert/回滚 动词邻近窗口」内的 #N（hotfix 单独不触发·codex P1-4/P1-5）。
 * @param {string} subject 提交首行
 * @returns {number[]}
 */
function extractRevertedPrsFromSubject(subject) {
  const s = String(subject == null ? '' : subject);
  if (!s) return [];
  const quoted = [];
  for (const seg of s.matchAll(QUOTE_SEG_RE)) {
    for (const p of String(seg[1]).matchAll(PR_NUM_RE)) quoted.push(Number(p[1]));
  }
  if (quoted.length) return quoted;
  return [...s.matchAll(REVERT_VERB_WINDOW_RE)].map((m) => Number(m[1]));
}

/**
 * 解析 revert 类提交 subject 列表 → 「被回滚的原 PR 号」集合（仅正整数）。纯函数，供单测。
 * @param {string[]} subjects
 * @returns {Set<number>}
 */
export function parseRevertedPrs(subjects) {
  const prs = new Set();
  for (const s of (subjects || [])) {
    for (const pr of extractRevertedPrsFromSubject(s)) {
      if (Number.isInteger(pr) && pr > 0) prs.add(pr);
    }
  }
  return prs;
}

/**
 * 构造 git 反查参数。**必须 `-E`**：让 `|` 作 ERE alternation（无 -E git grep 不解析 `|`，实测命中 0·codex #812 P1）；
 * **必须 `-i`**：GitHub 标准 revert subject 首字母大写 `Revert "..."`，无 -i grep 'revert' 漏命中 → oracle 必失败。
 * 导出供单测断言 flag 正确（CI 不 spawn git）。
 * @param {string} gitDir
 * @returns {string[]}
 */
export function buildRevertGitArgs(gitDir) {
  return ['-C', gitDir, 'log', '-E', '-i', '--grep=(revert|回滚|hotfix)', '--pretty=format:%s'];
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
}

/**
 * 跑 git 反查得到「被回滚 PR 号」集合。runGit 可注入供单测（默认 execFileSync，不经 shell → 中文 grep 安全）。
 * git 不可用 / 非 git 目录 / 命令失败 → 空集（不阻断报告）。
 * @param {string} [gitDir]
 * @param {(args:string[])=>string} [runGit]
 * @returns {Set<number>}
 */
export function collectRevertedPrs(gitDir = GIT_DIR, runGit = defaultRunGit) {
  try {
    return parseRevertedPrs(String(runGit(buildRevertGitArgs(gitDir))).split('\n'));
  } catch {
    return new Set();
  }
}

/**
 * 有效 verdict = normalizeVerdict 叠加 git 事后回滚反查（**读时归一，不改 ledger 历史行**）。
 * 完成态(pass/partial) 的 loop PR 被后续 revert/回滚提交引用 → 视为 reverted；
 * 仅覆盖 pass/partial（失败终态 orphaned/blocked/abandoned 谈不上「事后回滚」，不覆盖）；
 * pr 须为正整数且命中反查集合（无 pr / 脏 pr 不误标·codex 闸-1 P2-1）；
 * 字面已是 reverted 的行 base==='reverted' 不进分支、原样、不双计。
 * @param {object} row
 * @param {Set<number>} revertedPrs
 * @returns {string}
 */
export function effectiveVerdict(row, revertedPrs) {
  const base = normalizeVerdict(row && row.verdict).verdict;
  if (revertedPrs && revertedPrs.size && (base === 'pass' || base === 'partial')) {
    const pr = Number(row && row.pr);
    if (Number.isInteger(pr) && pr > 0 && revertedPrs.has(pr)) return 'reverted';
  }
  return base;
}

// ============ E2 注入外部真相②：owner「重做/不是我要的」返工 sink（治自指闭环·2026-06-27）============

/**
 * 解析 owner 返工 sink（user-rework-log.jsonl）行 → 行数组（跳过坏 JSON 行，与 parseLedger 同款）。
 * 行 schema：{uid?|pr?, count(正整数·一次「重做」+1), reason, ts}。owner 反馈后由会话 append 一行（owner 不写代码）。
 * @param {string[]} lines
 * @returns {object[]}
 */
export function parseUserReworkLog(lines) {
  const rows = [];
  for (const line of (lines || [])) {
    const s = String(line || '').trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
  }
  return rows;
}

/**
 * 读时去重失败行（codex 闸-1 P1-1 并发安全）：并发 dispatch / git merge=union 可能让同一陈旧认领
 * 产生重复 orphaned/blocked 行；这里按 orphaned (uid,claim_at)、blocked uid 各只保留首条，使分母与
 * 放弃率/孤儿率不被重复行污染（写时去重只保串行常态，读时去重才是并发下的真保证）。完成行/未知行全保留
 * （每行=一次真实尝试，不去重）。
 */
function dedupeFailureRows(rawRows) {
  const out = [];
  const seenOrphan = new Set();
  const seenBlocked = new Set();
  for (const r of (rawRows || [])) {
    const v = normalizeVerdict(r && r.verdict).verdict;
    const uid = ledgerUid(r);
    // 仅 uid 存在才去重（codex 闸-2 P2）：缺 uid 的坏 schema 失败行**保留**（落 breakdown 可见），
    // 不归并到 `null@@…` 键——否则多条坏行被悄悄合并、隐藏账本污染。
    if (v === 'orphaned' && uid != null) {
      const key = `${uid}@@${(r && r.claim_at) || ''}`;
      if (seenOrphan.has(key)) continue;
      seenOrphan.add(key);
    } else if (v === 'blocked' && uid != null) {
      if (seenBlocked.has(uid)) continue;
      seenBlocked.add(uid);
    }
    out.push(r);
  }
  return out;
}

// ============ E5 样本主题集中度（治茧房2 过拟合·2026-06-27）============
// 账本 ~55% 任务属同一工程（"山西多省接入"）：从单一工程样本提炼的规则自认通用实则专用（样本 N≈1 个工程
// 而非 N 个独立任务）。E5 装"样本主题集中度"探针让过拟合可见 + 给单一样本提炼的规则打"待跨域验证"标签
// （meta-review 约定见 loop-orchestration §4）。两维度（codex 闸-1 D1-C 全采纳）：① topic（业务主题·task 文本
// 分类）= oracle 主结论 + 打标依据；② domain（技术域·辅助）= 任务字面"按 domain 字段算"，双口径揭示
// "技术分桶掩盖主题集中"。读时计算，**不 mutate 账本历史行**（仿 E1/E2）。

/**
 * 赫芬达尔指数 HHI = Σ(各桶占比)²。1=完全集中（单一桶）/ 1÷桶数=完全均匀。空/全零/非法 → 0（无样本不算集中）。
 * 纯函数，导出供单测。
 * @param {number[]} counts 各桶计数
 * @returns {number}
 */
export function hhiOf(counts) {
  // 只接受有限正数（codex 闸-2 P1-4：负数会污染平方和、Infinity 致 NaN）；非法 → 0。
  const clean = (Array.isArray(counts) ? counts : []).map((x) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const total = clean.reduce((a, x) => a + x, 0);
  if (total <= 0) return 0;
  return clean.reduce((a, x) => a + ((x / total) ** 2), 0);
}

/**
 * E5 业务主题分类规则（**单一事实源**，68 样本账本实测提炼·2026-06-27）。
 * 优先级"业务工程主题 > 技术实现主题 > 其他"（codex 闸-1 P0-3）：多省任务在 task 文本同时含 etl/派生/RLS/claims
 * 等技术词，"省份接入"必须**首位**判定，否则被技术主题截胡稀释（实测它在 domain 字段已被打散到 etl/
 * data-architecture/branch-derivation 等桶）。**诚实局限（codex D2 + 闸-2 P1-1）**：基于 task 文本关键词，
 * 非完美分类器，会随未来新工程过时。RLS/Phase + 裸"派生/回填/backfill/地域"等通用词已按 codex 闸-2 两轮复审
 * **移除/收窄**（它们跨项目通用，会误命中派生指标/数据回填/地域分析等非省份任务）；"派生"限定到派生映射上下文，
 * 仅保留 G3-G8 本仓省份专用网格编号。代价：少数文本无强省份信号的边界行（org_level_3 回填 / Phase backfill）诚实
 * 漏判归其他/数据——不追求 100% 召回、不污染 oracle（省份仍 ~53% 主导）。目的是让"单一工程过拟合"当前可见 + 打标。
 */
export const TOPIC_RULES = [
  // ① 业务工程·省份接入（最高优先·茧房2 主体）：网格 G3-G8（本仓省份上线专用编号·行4/50「G8 前端空态」仅靠此识别，删则漏判真实省份任务）/
  //   省份词(多省/分省/省份/山西/shanxi/sichuan/SX/SC/切省) / 派生映射(branch_code·prefix_map·"派生"+域/视图/化/映射/branch 上下文) / current<省> / PR#753。
  //   codex 闸-2 两轮收窄：移除 RLS/Phase（行级安全/阶段通用词）+ 裸"派生/回填/backfill/地域"（跨项目通用，会误命中派生指标/数据回填/地域分析等非省份任务）；
  //   "派生"限定到派生映射上下文。代价：行13(org_level_3 回填)/行44(Phase backfill 可信域回填) 文本无强省份信号 → 诚实漏判归其他/数据（不污染 oracle，省份仍 ~53% 主导）。
  { name: '省份接入', test: /G[3-8]\b|多省|分省|按省|省份|省化|跨省|山西|shanxi|sichuan|\bSX\b|SC\/SX|切省|branch[_-]?code|prefix[\s_-]?map|派生(?:域|视图|化|映射|\s*branch)|current\/(?:SX|SC|shanxi|sichuan|[^/\s]*省)|PR\s*#?\s*753/i },
  // ② 业务工程·loop 治理（账本/调度/认领/茧房本身/E1-E6 进化）
  { name: 'loop治理', test: /\bloop\b|账本|dispatch|认领|茧房|编排协议|质量账本|codex\s*闸|automation-due|stale-scan|\bE[1-6]\b/i },
  // ③ 业务工程·外部集成（IM 推送管道；置于"数据分析"前——wecom 推送任务虽含"续保"等分析词，本质是集成工程）
  { name: '外部集成', test: /wecom|企微|飞书|smartsheet|推送|\bIM\b/i },
  // ④ 业务分析·数据口径（赔付/出险/报价/口径/立方体/成本）
  { name: '数据分析口径', test: /赔付|出险|报价|口径|立方体|\bcube\b|\bKPI\b|成本|字段覆盖|ClaimsAgg|冻结源|续保|理赔/i },
  // ⑤ 技术实现·产品前端（前端模块/纯逻辑提取/测试重构/空态）
  { name: '产品前端', test: /前端|Panel|纯逻辑提取|薄提取|\bhooks\b|comprehensive|expense-development|规则引擎测试|边界测试|空态/i },
];

/**
 * 把单条 task 文本分类到一个业务主题（互斥·首个命中·优先级见 TOPIC_RULES）。无命中 → 其他（兜底，不臆造）。
 * @param {string} task
 * @returns {string}
 */
export function classifyTopic(task) {
  const s = String(task == null ? '' : task);
  if (!s.trim()) return '其他';
  for (const rule of TOPIC_RULES) if (rule.test.test(s)) return rule.name;
  return '其他';
}

/**
 * 过拟合打标判据（**纯函数可测**·codex 闸-1 P0-4）。基于 topic 维度（茧房2 是业务工程过拟合·codex D5）。
 * 顺序守卫：① 样本<2 跨域证据不足（单样本 HHI 必=1，不可误判集中）② top=其他 分类器覆盖不足（防伪高集中·P1-2）
 * ③ 单一主题占比≥0.5 或 HHI≥2×均匀基线（相对判据·codex D4）→ 过拟合 ④ 否则分散。
 * @param {{sampleCount:number, topName:string, topShare:number, hhiRatio:number}} m
 * @returns {{flagged:boolean, status:string}}
 */
export function overfitFlag({ sampleCount, topName, topShare, hhiRatio }) {
  if (!(Number(sampleCount) >= 2)) return { flagged: false, status: 'insufficient_cross_domain_evidence' };
  // topName 空 / 非字符串 / 其他 → 分类器覆盖不足，不判过拟合（codex 闸-2 P1-3：缺字段不应漏到 diverse）。
  if (!topName || typeof topName !== 'string' || topName === '其他') return { flagged: false, status: 'classifier_coverage_low' };
  if (Number(topShare) >= 0.5 || Number(hhiRatio) >= 2) return { flagged: true, status: 'overfit' };
  return { flagged: false, status: 'diverse' };
}

/** 打标 reason 文案（按 status 生成·中文清晰）。 */
function concentrationReason(status, topName, topShare, sampleCount) {
  const pct = (Number(topShare) * 100).toFixed(1);
  if (status === 'overfit') return `业务主题「${topName}」占 ${pct}%（${sampleCount} 样本）显著主导——本轮单一样本提炼的规则建议打「待跨域验证」标签，验证其在其他工程上是否成立再视作通用。`;
  if (status === 'insufficient_cross_domain_evidence') return `样本量 ${sampleCount} < 2，跨域证据不足无法判主题集中度；本轮规则一律视作「待跨域验证」。`;
  if (status === 'classifier_coverage_low') return `主导主题为「其他」（分类器未覆盖），不判过拟合；建议补 TOPIC_RULES 规则或在账本显式标主题。`;
  return `主题分布相对分散（top「${topName}」${pct}%，未达占比 50% / HHI 2× 阈值），样本多样性健康。`;
}

/**
 * 计算样本主题集中度（E5·读时计算不 mutate）。两维度：topic（业务主题·主结论+打标）+ domain（技术域·双口径辅助）。
 * @param {object[]} rows 已去重的 ledger 行（含完成 + 失败行；每行一次尝试）
 * @returns {object} concentration
 */
function computeConcentration(rows) {
  const sampleCount = rows.length;
  // —— topic 维度（业务主题·task 文本分类）——
  const topicCounts = {};
  for (const r of rows) { const t = classifyTopic(r.task); topicCounts[t] = (topicCounts[t] || 0) + 1; }
  const topicEntries = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
  const topicTop = topicEntries[0];
  const topicBuckets = topicEntries.length;
  const topicHhi = hhiOf(topicEntries.map(([, v]) => v));
  const topicUniform = topicBuckets ? 1 / topicBuckets : 0;
  const topShare = topicTop ? topicTop[1] / sampleCount : 0;
  const topicHhiRatio = topicUniform ? topicHhi / topicUniform : 0;
  // distribution = 各桶展示比例（toFixed(4) 四舍五入·和未必精确=1·codex 闸-2 P2-1）；精确量由 hhi / top.share 承载。
  const topicDist = {};
  for (const [k, v] of topicEntries) topicDist[k] = +(v / sampleCount).toFixed(4);

  // —— domain 维度（技术域·双口径·codex P1-1）——
  // label 口径：标签展开计数（兼容现有 byDomain，反映"标签集中度"）；
  // task-weighted 口径：每任务权重 1，k 个域则每域 1/k（反映"任务集中度"，避免多域任务被重复放大）。
  const labelCounts = {};
  const taskWeighted = {};
  for (const r of rows) {
    const ds = (Array.isArray(r.domain) && r.domain.length) ? r.domain : ['(无域)'];
    const w = 1 / ds.length;
    for (const d of ds) { labelCounts[d] = (labelCounts[d] || 0) + 1; taskWeighted[d] = (taskWeighted[d] || 0) + w; }
  }
  const labelTotal = Object.values(labelCounts).reduce((a, x) => a + x, 0);
  const twEntries = Object.entries(taskWeighted).sort((a, b) => b[1] - a[1]);
  const twTop = twEntries[0];
  const domainBuckets = twEntries.length;
  const twHhi = hhiOf(twEntries.map(([, v]) => v));
  const domainUniform = domainBuckets ? 1 / domainBuckets : 0;
  const twDist = {};
  for (const [k, v] of twEntries) twDist[k] = +(v / sampleCount).toFixed(4);

  // —— 打标（基于 topic·codex D5）——
  const flag = overfitFlag({ sampleCount, topName: topicTop ? topicTop[0] : '其他', topShare, hhiRatio: topicHhiRatio });

  return {
    topic: {
      bucket_count: topicBuckets,
      sample_count: sampleCount,
      hhi: +topicHhi.toFixed(4),
      uniform: +topicUniform.toFixed(4),
      hhi_ratio: +topicHhiRatio.toFixed(3),
      top: { name: topicTop ? topicTop[0] : null, share: +topShare.toFixed(4) },
      distribution: topicDist,
      unclassified_share: +((topicCounts['其他'] || 0) / sampleCount).toFixed(4),
    },
    domain: {
      bucket_count: domainBuckets,
      label_total: labelTotal,
      label_hhi: +hhiOf(Object.values(labelCounts)).toFixed(4),
      task_weighted_hhi: +twHhi.toFixed(4),
      uniform: +domainUniform.toFixed(4),
      task_hhi_ratio: +(domainUniform ? twHhi / domainUniform : 0).toFixed(3),
      top: { name: twTop ? twTop[0] : null, share: twTop ? +(twTop[1] / sampleCount).toFixed(4) : 0 },
      distribution: twDist,
    },
    overfit: {
      flagged: flag.flagged,
      status: flag.status,
      label: flag.flagged ? '待跨域验证' : null,
      evidence: { topic: topicTop ? topicTop[0] : null, share: +topShare.toFixed(4), hhi: +topicHhi.toFixed(4), hhi_ratio: +topicHhiRatio.toFixed(3) },
      reason: concentrationReason(flag.status, topicTop ? topicTop[0] : '其他', topShare, sampleCount),
    },
  };
}

/** 渲染样本主题集中度段（E5）。空账本无 concentration → 返回空数组。 */
function renderConcentration(c) {
  if (!c) return [];
  const t = c.topic, d = c.domain, o = c.overfit;
  const L = ['', '## 样本主题集中度（E5 治茧房2 过拟合）'];
  // 主结论：业务主题（codex P0-1 首屏出 oracle 主结论，不让 domain 成主结论）
  L.push(`- 🎯 **业务主题集中度** top「${t.top.name}」${(t.top.share * 100).toFixed(1)}%（HHI ${t.hhi} vs 均匀基线 ${t.uniform}，${t.hhi_ratio}×）· ${t.bucket_count} 主题 / ${t.sample_count} 样本`);
  const td = Object.entries(t.distribution).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ');
  L.push(`  - 主题分布：${td}`);
  L.push(o.flagged ? `  - 🏷 **${o.label}**：${o.reason}` : `  - ✅ 未打标（${o.status}）：${o.reason}`);
  // 技术域（辅助·双口径）
  L.push(`- 🔧 技术域集中度（辅助·字面"按 domain 字段"）top「${d.top.name}」${(d.top.share * 100).toFixed(1)}%（任务加权 HHI ${d.task_weighted_hhi} · 标签 HHI ${d.label_hhi}）· ${d.bucket_count} 域 / ${d.label_total} 标签`);
  // 诊断洞察（条件生成·codex P2-2，不写死历史）：技术域分散却业务主题集中 = 茧房2 隐身机制
  if (d.task_weighted_hhi < t.hhi && t.top.share >= 0.5 && t.top.name !== '其他') {
    L.push(`  - 🔍 **诊断**：技术域分散（HHI ${d.task_weighted_hhi}）却业务主题集中（HHI ${t.hhi}）——单一工程被打散到多技术域桶，技术分桶口径掩盖了"单一工程过拟合"（茧房2 隐身机制）。`);
  }
  return L;
}

/**
 * 聚合质量指标。返回北极星 + 失败记账（放弃率/孤儿率/阻塞率）+ E2 外部真相（事后回滚率/返工率）+ 按域 + 按 round 趋势。
 * @param {object[]} rawRows ledger 行
 * @param {{revertedPrs?:Set<number>, reworkRows?:object[]}} [opts]
 *   revertedPrs — E2① git 反查的「被回滚 PR 号」集合（缺省空 → 退化为纯 normalizeVerdict，向后兼容）
 *   reworkRows  — E2② owner 返工 sink 行（缺省空 → 返工率 0）
 */
export function aggregate(rawRows, opts = {}) {
  // 读时去重失败行（codex 闸-1 P1-1）：并发/union 重复的 orphaned/blocked 只计一次，分母不被污染。
  const rows = dedupeFailureRows(rawRows);
  const n = rows.length;
  if (n === 0) return { n: 0 };

  // E2①：git 事后回滚反查集合（读时归一，不改历史行）。空集 → effectiveVerdict 退化为 normalizeVerdict（向后兼容）。
  const revertedPrs = opts.revertedPrs instanceof Set ? opts.revertedPrs : new Set();
  const ev = (r) => effectiveVerdict(r, revertedPrs);                 // 有效 verdict（含事后回滚覆盖）
  const nvOnly = (r) => normalizeVerdict(r.verdict).verdict;          // 字面 verdict（不含反查，算 ledger_reverted_count）
  // 一次过 = 有效 pass（partial/reverted/orphaned/blocked 即便 rtg=1 也不算）+ 首轮转绿 + 零返工。
  // 用 ev 而非纯归一：被事后回滚的 pass 行 ev→reverted，即不再算一次过（外部真相纠偏·codex #812 P2 谓词保留）。
  const firstPass = rows.filter((r) => ev(r) === 'pass' && Number(r.rounds_to_green) === 1 && Number(r.rework_count || 0) === 0).length;
  const govPass = rows.filter((r) => r.governance_pass === true).length;
  const codexPlan = sum(rows, (r) => findings(r.codex_plan));
  const codexDone = sum(rows, (r) => findings(r.codex_done));
  const verifierRefuted = sum(rows, (r) => Number(r.verifier_refuted) || 0);

  // verdict 分布（有效态，含 git 事后回滚覆盖）：规范六类 + other（未知/缺失不在分布里消失·codex 闸-1 P2-3）。
  const breakdown = { pass: 0, partial: 0, reverted: 0, abandoned: 0, orphaned: 0, blocked: 0, other: 0 };
  for (const r of rows) {
    const v = ev(r);
    if (Object.prototype.hasOwnProperty.call(breakdown, v) && v !== 'other') breakdown[v] += 1;
    else breakdown.other += 1;
  }

  // E2①：reverted 三指标分清来源（codex 闸-1 P1-1，避免 reverted_count 语义漂移）：
  //   ledger_reverted_count = 字面 verdict===reverted（归一后，不含反查）
  //   post_revert_count     = git 反查新命中（pass/partial → reverted）= 有效 − 字面
  //   reverted_count（沿用名兼容）= breakdown.reverted = 有效回滚总数（字面 + 反查）
  const ledgerRevertedCount = rows.filter((r) => nvOnly(r) === 'reverted').length;
  const postRevertCount = breakdown.reverted - ledgerRevertedCount;

  // avg 转绿/返工只算「有完成指标」的行（缺失≠0·codex 闸-1 P2-5）：失败行无 rtg → 不拉低均值。
  const withRtg = rows.filter((r) => r.rounds_to_green != null && Number.isFinite(Number(r.rounds_to_green)));
  const withRework = rows.filter((r) => r.rework_count != null && Number.isFinite(Number(r.rework_count)));
  const avg = (arr, f) => (arr.length ? +(sum(arr, f) / arr.length).toFixed(2) : 0);

  // 按域
  const byDomain = {};
  for (const r of rows) {
    for (const d of (r.domain || ['(无域)'])) {
      byDomain[d] = byDomain[d] || { n: 0, codex: 0 };
      byDomain[d].n += 1;
      byDomain[d].codex += findings(r.codex_plan) + findings(r.codex_done);
    }
  }
  // 按 round（趋势）
  const byRound = {};
  for (const r of rows) {
    const k = r.round || '(无)';
    byRound[k] = byRound[k] || { n: 0, rtg: 0, rework: 0 };
    byRound[k].n += 1;
    byRound[k].rtg += Number(r.rounds_to_green) || 0;
    byRound[k].rework += Number(r.rework_count) || 0;
  }

  // E2②：owner 返工聚合（owner 口径：有返工任务数 / 总任务数·codex 闸-1 P1-2/P1-3）。
  const reworkRows = Array.isArray(opts.reworkRows) ? opts.reworkRows : [];
  // pr→uid 索引（pr 唯一时映射；冲突的 pr 标记，退化 pr 键，避免错误归并·codex 闸-1 P1-2）。
  const prToUid = new Map();
  const prConflict = new Set();
  for (const r of rows) {
    const uid = ledgerUid(r);
    const pr = Number(r.pr);
    if (uid && Number.isInteger(pr) && pr > 0) {
      if (prToUid.has(pr) && prToUid.get(pr) !== uid) prConflict.add(pr);
      else prToUid.set(pr, uid);
    }
  }
  // 返工行任务键：uid 优先；只有 pr 则查索引归一到 uid（消除 uid/pr 拆分重复）；无映射/冲突 → pr:${pr}；都无 → null 跳过。
  const reworkTaskKey = (row) => {
    if (row && row.uid) return String(row.uid);
    const pr = Number(row && row.pr);
    if (Number.isInteger(pr) && pr > 0) {
      if (!prConflict.has(pr) && prToUid.has(pr)) return prToUid.get(pr);
      return `pr:${pr}`;
    }
    return null;
  };
  let userReworkTotal = 0;
  const reworkTasks = new Set();
  for (const r of reworkRows) {
    const c = Number(r && r.count);
    if (!Number.isInteger(c) || c <= 0) continue;   // 严格正整数（owner「整数次数 N」口径）：负/0/小数(含 1.9，不向下取整)/NaN/脏值忽略·codex 闸-1 P2-5 + 闸-2 P2-3
    const key = reworkTaskKey(r);
    if (!key) continue;                            // 无 uid 无 pr → 无法归属，跳过
    userReworkTotal += c;
    reworkTasks.add(key);
  }
  const userReworkTasks = reworkTasks.size;
  // 总任务数（任务维度去重 = owner 返工率分母；区别于 n=尝试维度·codex 闸-1 P1-3）。无键行各算一个任务（保守不合并）。
  const taskKeys = new Set();
  let rowsNoKey = 0;
  for (const r of rows) {
    const uid = ledgerUid(r);
    const pr = Number(r.pr);
    const k = uid || (Number.isInteger(pr) && pr > 0 ? `pr:${pr}` : null);
    if (k) taskKeys.add(k); else rowsNoKey += 1;
  }
  const taskCount = taskKeys.size + rowsNoKey;

  return {
    n,
    first_pass_rate: +(firstPass / n).toFixed(3),
    avg_rounds_to_green: avg(withRtg, (r) => Number(r.rounds_to_green)),
    avg_rework: avg(withRework, (r) => Number(r.rework_count)),
    governance_pass_rate: +(govPass / n).toFixed(3),
    codex_findings_total: codexPlan + codexDone,
    codex_plan_findings: codexPlan,
    codex_done_findings: codexDone,
    verifier_refuted_total: verifierRefuted,
    // E2① 事后回滚（git 反查·读时归一）：三指标分清来源（codex 闸-1 P1-1）。
    reverted_count: breakdown.reverted,            // 有效回滚总数（字面 + 反查）·沿用名兼容
    ledger_reverted_count: ledgerRevertedCount,    // 账本字面 reverted（不含反查）
    post_revert_count: postRevertCount,            // git 反查新命中
    post_revert_rate: +(breakdown.reverted / n).toFixed(3),  // 事后回滚率 = 有效回滚 / n（尝试维度）
    // E1 失败记账：放弃率=（abandoned+orphaned）/n（blocked 不混入·codex 闸-1 P2-2，单列阻塞率）。
    abandonment_rate: +((breakdown.abandoned + breakdown.orphaned) / n).toFixed(3),
    orphan_rate: +(breakdown.orphaned / n).toFixed(3),
    blocked_rate: +(breakdown.blocked / n).toFixed(3),
    // E2② owner 返工（外部 sink·任务维度）：post_rework_rate 分母 = task_count（去重任务数·owner 口径）。
    task_count: taskCount,
    user_rework_total: userReworkTotal,
    user_rework_tasks: userReworkTasks,
    post_rework_rate: taskCount ? +(userReworkTasks / taskCount).toFixed(3) : 0,
    verdict_breakdown: breakdown,
    tests_added_total: sum(rows, (r) => Number(r.tests_added) || 0),
    byDomain,
    byRound,
    // E5 样本主题集中度（读时计算·不 mutate 历史行）：topic 业务主题（主结论+打标）+ domain 技术域（辅助双口径）。
    concentration: computeConcentration(rows),
  };
}

function render(agg) {
  if (!agg.n) return 'Loop 质量账本为空（.claude/workflow/loop-quality-ledger.jsonl 无数据行）。';
  const L = [];
  L.push('# Loop 质量报告（quality-report）');
  L.push('');
  L.push(`- 任务样本 ${agg.n}`);
  L.push(`- 🌟 **一次过率** ${(agg.first_pass_rate * 100).toFixed(1)}%（rounds_to_green=1 且 零返工）`);
  L.push(`- 平均转绿轮次 ${agg.avg_rounds_to_green} · 平均返工 ${agg.avg_rework}（均只算有完成指标的行）`);
  L.push(`- 🛑 **放弃率** ${(agg.abandonment_rate * 100).toFixed(1)}%（abandoned+orphaned）· 孤儿率 ${(agg.orphan_rate * 100).toFixed(1)}% · 阻塞率 ${(agg.blocked_rate * 100).toFixed(1)}%`);
  // E2 外部真相双率（事后回滚 from git 史 · 事后返工 from owner sink）——茧房3 自指闭环的外部校准点。
  L.push(`- 🔁 **事后回滚率** ${((agg.post_revert_rate || 0) * 100).toFixed(1)}%（被 git revert/回滚的 loop PR）· 有效回滚 ${agg.reverted_count || 0}（账本字面 ${agg.ledger_reverted_count || 0} + git 反查 ${agg.post_revert_count || 0}）`);
  L.push(`- 🙅 **事后返工率** ${((agg.post_rework_rate || 0) * 100).toFixed(1)}%（owner 重做/不是我要的）· 返工 ${agg.user_rework_total || 0} 次 / ${agg.user_rework_tasks || 0} 任务（共 ${agg.task_count || agg.n} 任务）`);
  const b = agg.verdict_breakdown || {};
  L.push(`- verdict 分布：pass ${b.pass || 0} · partial ${b.partial || 0} · reverted ${b.reverted || 0} · abandoned ${b.abandoned || 0} · orphaned ${b.orphaned || 0} · blocked ${b.blocked || 0}${b.other ? ` · other ${b.other}` : ''}`);
  L.push(`- governance 通过率 ${(agg.governance_pass_rate * 100).toFixed(1)}%（占全部尝试，失败行计未过）`);
  L.push(`- 对抗命中：codex 计划 ${agg.codex_plan_findings} + 完成 ${agg.codex_done_findings} = ${agg.codex_findings_total}；verifier 证伪 ${agg.verifier_refuted_total}`);
  L.push(`- 新增测试合计 ${agg.tests_added_total}`);
  for (const line of renderConcentration(agg.concentration)) L.push(line);
  L.push('');
  L.push('## 按域');
  for (const [d, v] of Object.entries(agg.byDomain).sort((a, b) => b[1].n - a[1].n)) {
    L.push(`- ${d}: ${v.n} 任务 · 对抗命中 ${v.codex}`);
  }
  L.push('');
  L.push('## 按 round 趋势（平均转绿轮次 / 返工）');
  for (const [k, v] of Object.entries(agg.byRound)) {
    L.push(`- ${k}: n=${v.n} · 转绿 ${(v.rtg / v.n).toFixed(2)} · 返工 ${(v.rework / v.n).toFixed(2)}`);
  }
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let lines = [];
  try { lines = fs.readFileSync(LEDGER_PATH, 'utf-8').split('\n'); } catch { /* 文件不存在=空账本 */ }
  // E2①：git 史反查事后回滚 PR 集合（GIT_DIR 默认 ROOT，env 可覆盖供 oracle）。git 不可用→空集，不阻断。
  const revertedPrs = collectRevertedPrs(GIT_DIR);
  // E2②：owner 返工 sink（缺文件=无返工记录）。
  let reworkLines = [];
  try { reworkLines = fs.readFileSync(REWORK_PATH, 'utf-8').split('\n'); } catch { /* sink 不存在=无返工 */ }
  const agg = aggregate(parseLedger(lines), { revertedPrs, reworkRows: parseUserReworkLog(reworkLines) });
  if (args.includes('--json')) { process.stdout.write(JSON.stringify(agg, null, 2) + '\n'); return; }
  console.log(render(agg));
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时直接拼 file://${argv[1]} 会失配）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
