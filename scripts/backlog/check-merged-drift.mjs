#!/usr/bin/env bun
/**
 * BACKLOG「实现漂移」检测器（self-evolution / 自进化护栏）
 *
 * 病：event-log 模型根治了「碰号 / 重复行 / 手解派生文件」三类结构性病（见
 * .claude/rules/backlog-eventlog.md），但**不**根治「实现-状态漂移」——即任务
 * 的代码已存在（已并入 main，或躺在一个开放 PR 分支上），而 BACKLOG 状态仍停在
 * PROPOSED。两种危害：
 *   1) 已合并却未置 DONE → 看板谎报「待办」（本会话实证：9377d1/PR#633、
 *      9719ff/PR#636 长期修法已合并，BACKLOG 仍标 PROPOSED，靠人工 git 比对才发现）。
 *   2) 开放 PR 未在看板登记 → 后续会话误判「未开始」而**重复实现**（本会话实证：
 *      992469 有开放 PR #635，差点被重做一遍）。
 *
 * 治：把那次「人工比对」固化成确定性脚本。判据干净、高精度：
 *   PROPOSED ≡「未开始」。但若存在一条**引用该任务现代 uid 短后缀**（如提交惯例
 *   "(P1 9719ff)"）且**改动了 BACKLOG 派生物以外文件**的提交（git log --all，
 *   含开放 PR 分支）→ 任务其实已动工/已落地，与 PROPOSED 自相矛盾。
 *
 * 精度取舍：只认**现代 uid 短后缀**（≥5 字符，随机够独特），不认曾用号 B###
 *   —— B### 短且在「登记/顺带提及」类提交里泛滥，匹配它会大量误报（实测 27 例）。
 *   代价：纯曾用号的历史任务漏检；收益：零误报，护栏可信。
 *
 * 用法：
 *   bun scripts/backlog/check-merged-drift.mjs           # advisory，列漂移候选，退出 0
 *   bun scripts/backlog/check-merged-drift.mjs --strict   # 有漂移则退出 1（可选 CI 闸）
 *   bun scripts/backlog/check-merged-drift.mjs --json      # 机器可读
 *
 * 注意：依赖完整 git 历史（--all 含开放 PR 分支）。CI 浅克隆（shallow）时自动
 *   降级为 SKIP（不误报）；要在 CI 跑需 fetch-depth:0 + fetch 所有远端分支。
 */
import { execSync } from 'node:child_process';
import { loadLog, fold, displayId } from './lib.mjs';

/** 任务的可搜索标识：现代 uid 短后缀（YYYY-MM-DD-actor-XXXXXX → XXXXXX），≥5 字符才够独特 */
function tokensFor(t) {
  const suffix = (t.uid || '').split('-').pop();
  return suffix && suffix.length >= 5 ? [suffix] : [];
}

/** 从 code 字段抽取形似路径的片段（含 '/' 的文件/目录），用于「实现」判定 */
function codePaths(t) {
  const raw = (t.code || '').replace(/<br>/g, ' ');
  const matches = raw.match(/[A-Za-z0-9_.-]*\/[A-Za-z0-9_./-]+/g) || [];
  return matches
    .map(s => s.replace(/[；;,，)\]]+$/, '').trim())
    .filter(s => s.length >= 6 && s.includes('/'));
}

/** 提交改动文件 files 是否命中任一 declared code 路径（子串双向包含，覆盖精确文件与目录前缀） */
function touchesDeclaredCode(files, paths) {
  if (paths.length === 0) return true; // 无 code 字段声明 → 退化为只凭引用（不加码过滤）
  return files.some(f => paths.some(p => f === p || f.startsWith(p + '/') || f.includes(p) || p.includes(f)));
}

const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// BACKLOG 派生物 / 纯账本文件：仅改这些的提交不算「实现」
const LEDGER_FILES = new Set([
  'BACKLOG.md',
  'BACKLOG_LOG.jsonl',
  'BACKLOG_ARCHIVE.md',
]);

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function isShallow() {
  try {
    return sh('git rev-parse --is-shallow-repository') === 'true';
  } catch {
    return false;
  }
}

/** 返回引用 token、改动了非账本文件、且命中 declared code 路径的提交（[{hash, subject}]） */
function implementationCommits(token, paths) {
  // --grep 同时扫 subject + body；-F 字面量匹配避免正则元字符
  // %x09=TAB 分隔（避免 shell 管道符等元字符注入），逐行 split('\t')
  let raw;
  try {
    raw = sh(`git log --all --grep=${JSON.stringify(token)} -F --format=%H%x09%s`);
  } catch {
    return [];
  }
  if (!raw) return [];
  const out = [];
  for (const line of raw.split('\n')) {
    const [hash, ...rest] = line.split('\t');
    if (!hash) continue;
    const subject = rest.join('\t');
    let files;
    try {
      // diff-tree 列单提交改动文件（合并提交返回空 → 由其底层非合并提交命中，不漏判）
      files = sh(`git diff-tree --no-commit-id --name-only -r ${hash}`)
        .split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      files = [];
    }
    // 改动了任一非账本文件 + 命中 declared code 路径 → 算实现提交（非登记/顺带提及）
    const nonLedger = files.filter(f => !LEDGER_FILES.has(f));
    if (nonLedger.length > 0 && touchesDeclaredCode(nonLedger, paths)) {
      out.push({ hash: hash.slice(0, 8), subject });
    }
  }
  return out;
}

function main() {
  if (isShallow()) {
    const msg = '⏭️  git 浅克隆，跳过 BACKLOG 已合并漂移检测（需完整历史；本地或 fetch-depth:0 的 CI 可跑）';
    if (JSON_OUT) console.log(JSON.stringify({ skipped: true, reason: 'shallow' }));
    else console.log(msg);
    return 0;
  }

  const events = loadLog();
  const tasks = fold(events);

  const drifts = [];
  for (const t of tasks.values()) {
    if (t.status !== 'PROPOSED') continue; // 仅查「未开始」态——最干净的矛盾信号
    const tokens = tokensFor(t);
    if (tokens.length === 0) continue; // 纯曾用号任务无现代后缀，跳过（精度优先）
    const paths = codePaths(t);
    const commits = [];
    const seen = new Set();
    for (const tok of tokens) {
      for (const c of implementationCommits(tok, paths)) {
        if (!seen.has(c.hash)) { seen.add(c.hash); commits.push(c); }
      }
    }
    if (commits.length > 0) {
      drifts.push({ id: displayId(t), uid: t.uid, priority: t.priority, desc: t.desc.slice(0, 60), commits });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ skipped: false, driftCount: drifts.length, drifts }, null, 2));
    return drifts.length > 0 && STRICT ? 1 : 0;
  }

  if (drifts.length === 0) {
    console.log('✅ 无 BACKLOG 实现漂移：所有 PROPOSED 任务均无对应实现提交');
    return 0;
  }

  console.log(`⚠️  发现 ${drifts.length} 个 BACKLOG 实现漂移候选（标 PROPOSED 但已有实现提交）：\n`);
  for (const d of drifts) {
    console.log(`  [${d.priority}] ${d.id} — ${d.desc}`);
    for (const c of d.commits.slice(0, 4)) {
      console.log(`        ${c.hash}  ${c.subject}`);
    }
    console.log(`     → 核实该提交是否已并入 main：`);
    console.log(`        已合并 → bun scripts/backlog.mjs status ${d.uid} DONE --evidence "PR/commit ..."`);
    console.log(`        开放 PR 未合并 → 勿重复实现；note 登记 PR 号，合并后再置 DONE\n`);
  }
  console.log('提示：IN_PROGRESS 的多提交任务不在此列（合法）；本检测只盯「PROPOSED + 有实现提交」的自相矛盾。');
  return STRICT ? 1 : 0;
}

process.exit(main());
