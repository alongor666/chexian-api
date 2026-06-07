#!/usr/bin/env bun
/**
 * BACKLOG 专项治理器 — 状态校准 + DONE 归档 + 速查看板
 *
 * 做三件事（幂等、可反复运行）：
 *  1. 状态校准：把已确认完成却仍标 PROPOSED/DOING 的条目改 DONE/IN_PROGRESS 并补证据
 *  2. 归档分离：把 DONE 条目从 BACKLOG.md 迁到 BACKLOG_ARCHIVE.md（完整保留 ID + 证据）
 *  3. 速查看板：在 BACKLOG.md 顶部按优先级生成活跃任务一览
 *
 * 设计约束（见 .claude/rules/worktree-setup.md + assign-task-id.mjs）：
 *  - 不删除任何条目（DONE 仅迁档，ID 完整保留 → 编号永不被回收复用）
 *  - 活跃表保持原文件顺序（BACKLOG.md merge=union 纯追加，禁止重排）
 *  - 归档表按 ID 升序（脚本每次重生成，可读性优先）
 *  - 按行字符串操作 + 行首 ID 驱动分类，绕开"描述列含 | 导致按列解析错位"的坑
 *
 * 用法：
 *   bun scripts/governance-backlog-curate.mjs            # dry-run（默认，只打印计划）
 *   bun scripts/governance-backlog-curate.mjs --apply    # 实际写入两个文件
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();
const BACKLOG = resolve(ROOT, 'BACKLOG.md');
const ARCHIVE = resolve(ROOT, 'BACKLOG_ARCHIVE.md');
const APPLY = process.argv.includes('--apply');
const CAL_DATE = '2026-06-06';

// ── 状态校准映射（仅作用于 BACKLOG.md 的行；幂等：已是目标状态则正则不命中）──
const CALIBRATION = {
  B235: { from: 'PROPOSED', to: 'DONE', evidence: 'commit 366df960 feat(B235+B236)：假日营销自由维度下钻已实现（marketing-report groupBy+drillPath）' },
  B236: { from: 'PROPOSED', to: 'DONE', evidence: 'commit 366df960 feat(B235+B236)：驾意险 insurance_grade 维度下钻已实现' },
  B239: { from: 'PROPOSED', to: 'DONE', evidence: '状态对账：8 域 ETL 架构已上线生产；产出文件 convert_cross_sell.py / convert_customer_flow.py / quote_etl.py（报价，原规划 convert_quotes_v2.py 已改名）均存在' },
  B240: { from: 'PROPOSED', to: 'DONE', evidence: '状态对账：8 域 DuckDB 分域加载已上线；ClaimsAgg（duckdb-domain-loaders.ts createClaimsAggFromDetail）/ CrossSellFact / customer-flow / repair 视图均在生产运行' },
  B241: { from: 'PROPOSED', to: 'DONE', evidence: '状态对账：8 域 SQL 生成器适配已完成；cost.ts 走 ClaimsAgg、cross-sell 系列走 CrossSellFact，下游 B257-B265 agent 诊断全部依赖此架构运行' },
  B242: { from: 'PROPOSED', to: 'DONE', evidence: '状态对账：维修资源页面已上线（server/src/sql/repair.ts + src/features/repair 存在，B262/B263 agent 诊断已引用其后端能力）' },
  B243: { from: 'PROPOSED', to: 'DONE', evidence: '状态对账：客户来源去向页面已上线（server/src/sql/customer-flow.ts + src/features/customer-flow 存在，B263 customer_flow_diagnosis 已引用）' },
  B337: { from: 'DOING', to: 'IN_PROGRESS', evidence: '' }, // 仅规范状态枚举，活跃任务不补证据
};

// ── 非标准 ID 重编号（落实"继续编号、禁止复用"）──
// 注：B339/B340 已被 PR #513「ETL 发布前准入闸门」并行占用（fork 后双方独立分配撞号），
// 本次治理避让续编 B341/B342，落实"全局连续、禁止复用历史编号"。
const RENUMBER = {
  'B256-update': { to: 'B341', note: '（原 B256-update，本次治理规范化为正式全局编号；B339/B340 已被 PR #513 占用，故续编 B341）' },
};

// ── 注入归档行：本次治理工作自身的 DONE 登记（baked 进脚本 → 抗未来 reset 重生成，幂等）──
// 主流程合并归档时：若活跃表或现有归档已含同 ID 则跳过注入，避免重复。
const INJECT_ARCHIVE = {
  B342: '| B342 | 2026-06-06 | Chore/Governance | @claude | **BACKLOG 专项治理：状态校准 + DONE 归档 + 全局连续编号 + 活跃任务速查看板**：原单表拆为「BACKLOG.md（活跃）+ BACKLOG_ARCHIVE.md（归档，完整保留 ID 与证据）」；8 项状态校准（B235/236/239-243 经实证已完成改 DONE、B337 非标状态 DOING→IN_PROGRESS）+ 非标 ID B256-update 规范化为 B341（B339/B340 已被 PR #513「ETL 发布前准入闸门」并行占用，故本次续编 B341/B342 避让，落实"全局连续、禁止复用"）；`assign-task-id.mjs` 由「按 Agent 区间找空缺」改为「全局 max+1，永不复用历史编号（含归档）」，根治原会回收低号 B100 的 bug；消费方 `check-governance.mjs`（证据链/ID/冲突标记）与 `check-task-id-conflict.mjs` 扫描范围扩展到归档文件 | P3 | DONE | `.claude/rules/worktree-setup.md`（BACKLOG 派生文件治理）；本会话治理 | `scripts/governance-backlog-curate.mjs`(新·幂等治理器+治理行注入)<br>`scripts/assign-task-id.mjs`(全局编号)<br>`scripts/check-task-id-conflict.mjs`(扫归档)<br>`scripts/check-governance.mjs`(扫归档)<br>`BACKLOG_ARCHIVE.md`(新)<br>`.gitattributes`(归档 union merge) | `bun run governance` 全绿（证据链跨两文件 / ID 扫描无冲突 / 治理文件冲突标记）；`assign-task-id @claude` 返回全局连续编号 B343；curate 二次 dry-run 幂等（0 新归档）；B341/B342 与 main B339/B340 无撞号 |',
};

const TABLE_HEADER = '| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 |';
const TABLE_SEP = '|----|----------|------|----------|----------|--------|------|----------|----------|-----------|';

/** 提取行首任务 ID（兼容 B256-update 这类非标准 ID） */
function rowId(line) {
  const m = line.match(/^\|\s*(B[\w-]+)\s*\|/);
  return m ? m[1] : null;
}

/**
 * 判断一行是否 DONE：锚定"优先级列紧邻状态列"模式 `| Px | DONE |`。
 * 比按 split('|') 取列更鲁棒——描述/验收列含 | 也不会误判（描述里不会出现 | P数字 | DONE | 精确序列）。
 */
function isDone(line) {
  return /\|\s*P\d\s*\|\s*DONE\s*\|/.test(line);
}

/** 解析表格数据行（返回原始行字符串数组，保留内部格式） */
function parseRows(content) {
  const lines = content.split('\n');
  const rows = [];
  let inTable = false;
  let sepPassed = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('| ID |')) { inTable = true; continue; }
    if (inTable && !sepPassed && t.startsWith('|---')) { sepPassed = true; continue; }
    if (inTable && sepPassed) {
      if (t.startsWith('|') && rowId(line)) { rows.push(line.replace(/\s+$/, '')); continue; }
      if (t && !t.startsWith('|')) break; // 表格结束
    }
  }
  return rows;
}

/** 状态校准：替换状态枚举 + 行尾追加证据 */
function calibrate(line, id) {
  const c = CALIBRATION[id];
  if (!c) return line;
  let out = line.replace(new RegExp(`\\|\\s*(P\\d)\\s*\\|\\s*${c.from}\\s*\\|`), `| $1 | ${c.to} |`);
  if (c.evidence) {
    out = out.replace(/\|\s*$/, ` <br>**【状态校准 ${CAL_DATE}】**${c.evidence} |`);
  }
  return out;
}

/** 重编号：替换行首 ID + 行尾追加说明 */
function renumber(line, id) {
  const r = RENUMBER[id];
  if (!r) return { line, id };
  let out = line.replace(/^\|\s*B[\w-]+\s*\|/, `| ${r.to} |`);
  out = out.replace(/\|\s*$/, ` <br>**【编号规范化 ${CAL_DATE}】**${r.note} |`);
  return { line: out, id: r.to };
}

/** 速查看板：从活跃行提取 ID/描述/优先级/状态，按优先级分组 */
function buildDashboard(activeRows) {
  const items = [];
  for (const line of activeRows) {
    const m = line.match(/^\|\s*(B[\w-]+)\s*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*(.+?)\s*\|\s*(P\d)\s*\|\s*([A-Z_]+)\s*\|/);
    if (!m) continue;
    const [, id, descRaw, pri, status] = m;
    const desc = descRaw.replace(/\*\*/g, '').replace(/`/g, '').split(/[：:。\n]/)[0].trim().slice(0, 44);
    items.push({ id, desc, pri, status });
  }
  const order = ['P0', 'P1', 'P2', 'P3', 'P4'];
  const lines = [`## 📋 活跃任务速查（${items.length} 项 · ${CAL_DATE} 自动生成，请勿手工编辑）`, '',
    '> 已完成任务见 [BACKLOG_ARCHIVE.md](./BACKLOG_ARCHIVE.md)。重新生成：`bun scripts/governance-backlog-curate.mjs --apply`', ''];
  for (const p of order) {
    const group = items.filter(it => it.pri === p);
    if (!group.length) continue;
    lines.push(`**${p}（${group.length} 项）**`, '');
    for (const it of group) {
      const tag = it.status === 'PROPOSED' ? '' : ` \`${it.status}\``;
      lines.push(`- ${it.id}${tag} — ${it.desc}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function backlogHeader(dashboard) {
  return `# 需求账本 (BACKLOG)

**唯一真理来源**：所有需求、任务、变更请求必须在此登记，不得在其他文件散落记录。

**本表只保留活跃任务**（PROPOSED / TRIAGED / IN_PROGRESS / PARTIAL / BLOCKED）。已完成（DONE）任务归档至 [BACKLOG_ARCHIVE.md](./BACKLOG_ARCHIVE.md)，完整保留 ID 与证据，可追溯。

**更新规则**：
- 新增需求：用 \`bun scripts/assign-task-id.mjs @<agent>\` 取下一个**全局连续编号**（永不复用历史编号，含已归档的），添加新行，状态设为 \`PROPOSED\`
- 状态流转：\`PROPOSED → TRIAGED → IN_PROGRESS → DONE\` 或 \`BLOCKED\`
- 完成任务：状态设为 \`DONE\` 时**必须填写验收/证据**，随后用 \`bun scripts/governance-backlog-curate.mjs --apply\` 归档并刷新本看板
- ⚠️ 禁止删除条目 / 禁止复用历史编号（编号由 \`assign-task-id.mjs\` 全局 max+1 派生，归档文件也参与 max 计算）

**校验脚本**：\`bun run scripts/check-governance.mjs\` 检查 BACKLOG.md + BACKLOG_ARCHIVE.md 的 DONE 证据链与 ID 合规性。

---

${dashboard}
---

## 任务列表（活跃）

${TABLE_HEADER}
${TABLE_SEP}`;
}

function archiveHeader(count) {
  return `# 需求账本归档 (BACKLOG ARCHIVE)

**用途**：存放 [BACKLOG.md](./BACKLOG.md) 中已完成（DONE）的任务，完整保留 ID、描述、证据，供历史追溯。当前 ${count} 项。

**铁律**：
- 本文件由 \`bun scripts/governance-backlog-curate.mjs --apply\` 自动维护，DONE 任务从 BACKLOG.md 迁入。
- ⚠️ **禁止删除条目、禁止复用此处出现过的编号** —— \`assign-task-id.mjs\` 把本文件纳入全局 max 计算，删除会导致编号被回收复用。
- 归档任务的证据链同样受 \`check-governance.mjs\` 校验。

---

${TABLE_HEADER}
${TABLE_SEP}`;
}

// ── 主流程 ──
const backlogContent = readFileSync(BACKLOG, 'utf-8');
const backlogRows = parseRows(backlogContent);
const existingArchiveRows = existsSync(ARCHIVE) ? parseRows(readFileSync(ARCHIVE, 'utf-8')) : [];
const existingArchiveIds = new Set(existingArchiveRows.map(rowId));

const newActive = [];
const newlyArchived = [];
const calibrated = [];
const renumbered = [];

for (const raw of backlogRows) {
  let line = raw;
  let id = rowId(line);
  if (RENUMBER[id]) { const r = renumber(line, id); line = r.line; renumbered.push(`${id} → ${id = r.id}`); }
  if (CALIBRATION[id]) { const before = line; line = calibrate(line, id); if (line !== before) calibrated.push(`${id}: ${CALIBRATION[id].from} → ${CALIBRATION[id].to}`); }
  // 分类按状态列（校准后的 DONE 也会被归档）→ 脚本可复用于未来新增 DONE
  if (isDone(line)) newlyArchived.push({ id, line });
  else newActive.push(line);
}

// 合并归档（去重 by id，现有归档优先保留），按 ID 数字升序
const archiveMap = new Map();
for (const l of existingArchiveRows) archiveMap.set(rowId(l), l);
for (const { id, line } of newlyArchived) if (!archiveMap.has(id)) archiveMap.set(id, line);
// 注入治理登记行（幂等：活跃表已含或归档已含则不注入）
const activeIdSet = new Set(newActive.map(rowId));
const injected = [];
for (const [id, line] of Object.entries(INJECT_ARCHIVE)) {
  if (!archiveMap.has(id) && !activeIdSet.has(id)) { archiveMap.set(id, line); injected.push(id); }
}
const sortedArchive = [...archiveMap.values()].sort((a, b) => {
  const na = parseInt((rowId(a) || '').replace(/\D/g, ''), 10);
  const nb = parseInt((rowId(b) || '').replace(/\D/g, ''), 10);
  return na - nb;
});

const dashboard = buildDashboard(newActive);
const newBacklog = `${backlogHeader(dashboard)}\n${newActive.join('\n')}\n`;
const newArchive = `${archiveHeader(sortedArchive.length)}\n${sortedArchive.join('\n')}\n`;

// ── 报告 ──
console.log(`\n=== BACKLOG 专项治理${APPLY ? '（APPLY 实际写入）' : '（DRY-RUN，加 --apply 写入）'} ===\n`);
console.log(`原始任务行：${backlogRows.length}`);
console.log(`状态校准：${calibrated.length} 项`);
calibrated.forEach(c => console.log(`  · ${c}`));
console.log(`编号规范化：${renumbered.length} 项`);
renumbered.forEach(r => console.log(`  · ${r}`));
console.log(`治理行注入：${injected.length} 项`);
injected.forEach(i => console.log(`  · ${i}`));
console.log(`本次归档：${newlyArchived.length} 项 → BACKLOG_ARCHIVE.md`);
console.log(`归档总计：${sortedArchive.length} 项（含历史）`);
console.log(`活跃保留：${newActive.length} 项`);
console.log(`\n--- 速查看板预览 ---\n${dashboard}`);

if (APPLY) {
  writeFileSync(BACKLOG, newBacklog, 'utf-8');
  writeFileSync(ARCHIVE, newArchive, 'utf-8');
  console.log(`✅ 已写入 BACKLOG.md（${newActive.length} 活跃）+ BACKLOG_ARCHIVE.md（${sortedArchive.length} 归档）`);
} else {
  console.log(`\nℹ️  dry-run 未写入。确认无误后加 --apply。`);
}
