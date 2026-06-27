#!/usr/bin/env node
/**
 * Loop v2 自进化催办（automation-due）。
 *
 * 扫 .claude/workflow/pr-evolution.md，把每条 `needs_automation: true` 与其后续行的
 * `expires: YYYY-MM-DD` 配对，分类输出：已过期 / 临期 / 缺 expires。
 *
 * 与 governance #703（checkPrEvolutionExpired）的分工：
 *   - #703 = 提交闸：只拦「本次新增缺 expires」(error) + main 存量缺 expires(warning)。
 *   - 本脚本 = meta-review 催办：列「已过期未机制化」(#703 仅 warning 不强制) → 强制处置（升级机制或撤项）。
 *
 * 用法：bun run loop:automation-due [--days N] [--json]   （--days 临期窗口，默认 14；今日须经 --today 注入以便单测）
 *
 * 纯函数 scanEntries / classify 导出供单测（不读文件、不取系统时钟）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PR_EVO_PATH = path.join(ROOT, '.claude/workflow/pr-evolution.md');

/**
 * 扫描 pr-evolution 文本 → 每个 needs_automation 项 {entry, line, expires|null}。
 * entry = 最近的「任务级标题」（`## ` 级，或以日期 YYYY-MM-DD 开头的标题；纯子节 ###
 * 如「三问复盘」「体检结果（基准日 …）」不更新 entry）。窗口同 #703：needs_automation 后 10 行内找 expires。
 */
export function scanEntries(content) {
  const lines = content.split('\n');
  const out = [];
  let entry = '(unknown)';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 先判 needs_automation，再判标题：兼容「列表项 `- needs_automation: true`」与
    // 「标题 `### needs_automation: true`」两种格式。后者若先被标题分支 continue 吞掉会静默
    // 脱离催办网（2026-06-27 meta-review 实证尾部 6 条 entry 漏计近一个月）。标题形式归到
    // 其上一个真 entry 标题。
    if (/needs_automation:\s*true/.test(line)) {
      let expires = null;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const em = lines[j].match(/expires:\s*(\d{4}-\d{2}-\d{2})/);
        if (em) { expires = em[1]; break; }
      }
      out.push({ entry, line: line.trim().slice(0, 90), expires });
      continue;
    }
    const m = line.match(/^#{2,3}\s+(.+)/);
    if (m) {
      const title = m[1].trim();
      // 仅「任务级标题」更新 entry：`## ` 级或**以日期 `YYYY-MM-DD` 开头**的标题（任务标题
      // 形如「2026-06-27 · …」日期在首）。纯子节标题（### 三问复盘 / ### 做了什么 / ### 处置 /
      // ### 体检结果（基准日 2026-…）等——括号内含日期的也不算）不更新，否则标题形式
      // needs_automation 会归到子节名而非任务名、可定位性差（codex 闸-2 P2·2026-06-27 修正）。
      if (/^##\s/.test(line) || /^\d{4}-\d{2}-\d{2}/.test(title)) entry = title;
      continue;
    }
  }
  return out;
}

/** 按 today(YYYY-MM-DD) + 临期天数分类。日期比较用字典序（ISO 安全）。 */
export function classify(items, today, days = 14) {
  const dueBefore = isoAddDays(today, days);
  const expired = [], soon = [], missing = [], ok = [];
  for (const it of items) {
    if (!it.expires) missing.push(it);
    else if (it.expires < today) expired.push(it);
    else if (it.expires <= dueBefore) soon.push(it);
    else ok.push(it);
  }
  return { expired, soon, missing, ok };
}

/** ISO 日期加天数（纯函数，避免 new Date() 当前时钟依赖；接受 'YYYY-MM-DD'）。 */
export function isoAddDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function render(c, today) {
  const L = [];
  L.push(`# Loop 自进化催办（automation-due · 基准日 ${today}）`);
  L.push('');
  L.push(`- 已过期 ${c.expired.length} · 临期 ${c.soon.length} · 缺 expires ${c.missing.length} · 健康 ${c.ok.length}`);
  L.push('');
  L.push('## 🔴 已过期（meta-review 必须处置：升级为脚本/governance/hook 或显式撤项+记复盘）');
  if (!c.expired.length) L.push('（无）');
  for (const it of c.expired) L.push(`- [${it.expires}] ${it.entry} — ${it.line}`);
  L.push('');
  L.push('## 🟡 临期');
  for (const it of c.soon) L.push(`- [${it.expires}] ${it.entry} — ${it.line}`);
  L.push('');
  L.push('## ⚪ 缺 expires（governance #703 已拦新增；存量补 expires 后纳入催办）');
  for (const it of c.missing) L.push(`- ${it.entry} — ${it.line}`);
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const daysArg = args.indexOf('--days');
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 14;
  const todayArg = args.indexOf('--today');
  // 默认基准日 = UTC 今日；--today 供确定性测试/复跑
  const today = todayArg >= 0 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

  let content = '';
  try { content = fs.readFileSync(PR_EVO_PATH, 'utf-8'); } catch { content = ''; }
  const items = scanEntries(content);
  const c = classify(items, today, days);

  if (args.includes('--json')) { process.stdout.write(JSON.stringify({ today, strict: args.includes('--strict'), ...c }, null, 2) + '\n'); return; }
  console.log(render(c, today));
  // 退出码：已过期 → 2（meta-review 必须处置）；--strict 下缺 expires 也 → 1（CI 可据此卡存量缺口）。
  // 默认非 strict：缺 expires 仅信息性（新增由 governance #703 硬拦，存量 grandfather）。
  if (c.expired.length) process.exitCode = 2;
  else if (args.includes('--strict') && c.missing.length) process.exitCode = 1;
}

// 入口守卫：fileURLToPath 解码比较（仓库路径含非 ASCII 时直接拼 file://${argv[1]} 会失配）。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
