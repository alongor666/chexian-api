# ETL 全链路数据流转台账 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **设计依据：** [`docs/plans/2026-06-27-etl-ledger-design.md`](./2026-06-27-etl-ledger-design.md)（schema / 7 环节埋点表 / 回填来源 / 诚实边界都在那里，本计划不重复）

**Goal:** 给 ETL 全链路加一份「机器自动追加的 JSONL 流水账 + 自动生成的中文报告」，每步留痕、断点可定位、历史从 git 回填。

**Architecture:** event-log + 派生视图（对标 `BACKLOG_LOG.jsonl`/`loop-quality-ledger.jsonl`）。新增 3 个独立模块（record/render/backfill）走 TDD；7 环节埋点是「只加调用、不改逻辑」的侵入式修改，靠集成验证把关。记账失败一律 try/catch 吞掉，绝不阻断发布。

**Tech Stack:** Node ESM（`.mjs`）· vitest（`bun run test --run`）· git plumbing（`git log`/`git show`）

**约定（全计划通用）：**
- 测试位置 `scripts/__tests__/etl-ledger-*.test.mjs`（对齐既有先例如 `scripts/__tests__/sync-vps-freshness.test.mjs`）；模块本体 `scripts/etl-ledger/*.mjs`。
- 单测命令：`bun run test --run scripts/__tests__/<file>`。
- commit message 用项目 conventional 格式，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`（HEREDOC 传递）。
- 项目根定位：`join(dirname(fileURLToPath(import.meta.url)), '../..')`（模块在 `scripts/etl-ledger/` 下，`../..` = 项目根）。

---

### Task 0: 脚手架 + .gitattributes

**Files:**
- Create: `数据管理/ledger/.gitkeep`
- Modify: `.gitattributes`（追加 1 行）

**Step 1:** 建目录占位 —— `mkdir -p 数据管理/ledger && touch 数据管理/ledger/.gitkeep`

**Step 2:** 在 `.gitattributes` 末尾追加（紧跟现有 `loop-quality-ledger.jsonl` 那组）：
```
# ETL 流转台账：每行一个 JSON 事件、按内容唯一 → merge=union 自动并入多分支新增（同 BACKLOG_LOG.jsonl）。
# 派生视图 数据流转台账.md 全量重渲染、非纯追加 → 不设 union，冲突时重跑 render.mjs。
数据管理/ledger/etl-ledger.jsonl merge=union
```

**Step 3:** 验证 —— `git check-attr merge 数据管理/ledger/etl-ledger.jsonl` 期望输出 `merge: union`。

**Step 4:** Commit —— `chore(etl-ledger): 脚手架 + JSONL merge=union`

---

### Task 1: recordEvent 记录器（TDD）

**Files:**
- Create: `scripts/etl-ledger/record.mjs`
- Test: `scripts/__tests__/etl-ledger-record.test.mjs`

**Step 1: 写失败测试**（核心用例）
```js
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent, localIsoNow } from '../etl-ledger/record.mjs';

describe('recordEvent', () => {
  const tmpLedger = () => join(mkdtempSync(join(tmpdir(), 'ledger-')), 'etl-ledger.jsonl');

  it('追加一行合法 JSON，含缺省字段', () => {
    const p = tmpLedger();
    const ev = recordEvent({ stage: 'etl', domain: 'premium', row_count: 100 }, { ledgerPath: p });
    const line = readFileSync(p, 'utf8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.stage).toBe('etl');
    expect(parsed.status).toBe('success');      // 缺省填充
    expect(parsed.backfilled).toBe(false);       // 缺省填充
    expect(parsed.ts).toMatch(/\+08:00$/);       // 本地时区
    expect(ev).not.toBeNull();
  });

  it('多次调用追加多行', () => {
    const p = tmpLedger();
    recordEvent({ stage: 'source', domain: 'premium' }, { ledgerPath: p });
    recordEvent({ stage: 'etl', domain: 'premium' }, { ledgerPath: p });
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('写入失败返回 null、不抛（不阻断主流程）', () => {
    const ev = recordEvent({ stage: 'etl' }, { ledgerPath: '/nonexistent-root/x/y.jsonl', noMkdir: true });
    expect(ev).toBeNull();
  });

  it('localIsoNow 输出 +08:00 ISO', () => {
    expect(localIsoNow(new Date('2026-06-27T00:00:00Z'))).toBe('2026-06-27T08:00:00.000+08:00');
  });
});
```

**Step 2:** 跑测试确认失败 —— `bun run test --run scripts/__tests__/etl-ledger-record.test.mjs`（期望 FAIL：模块不存在）

**Step 3: 最小实现** `scripts/etl-ledger/record.mjs`
```js
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEDGER_PATH = join(PROJECT_ROOT, '数据管理/ledger/etl-ledger.jsonl');

export function localIsoNow(d = new Date()) {
  const local = new Date(d.getTime() + 8 * 3600 * 1000);
  return local.toISOString().replace('Z', '+08:00');
}

export function recordEvent(event, { ledgerPath = LEDGER_PATH, noMkdir = false } = {}) {
  try {
    const enriched = {
      ts: localIsoNow(),
      run_id: process.env.ETL_RUN_ID || 'adhoc',
      status: 'success',
      backfilled: false,
      ...event,
    };
    if (!noMkdir) mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify(enriched) + '\n', 'utf8');
    return enriched;
  } catch (e) {
    console.warn(`[etl-ledger] 记账失败（不阻断主流程）: ${e?.message ?? e}`);
    return null;
  }
}
```

**Step 4:** 跑测试确认通过（期望 PASS 全部 4 例）

**Step 5:** Commit —— `feat(etl-ledger): recordEvent 记录器（try/catch 安全网）`

---

### Task 2: render 报告生成器（TDD）

**Files:**
- Create: `scripts/etl-ledger/render.mjs`
- Test: `scripts/__tests__/etl-ledger-render.test.mjs`

**导出契约：** `loadEvents(ledgerPath)→事件数组（跳过坏行）` · `renderLedger(events)→md字符串` · `writeReport(ledgerPath, mdPath)`。`renderLedger` 三视角见设计文档 §7。

**Step 1: 写失败测试**（断言三视角关键内容，给一组含 1 个 failure + 2 个 success 的样例事件）：
- 输出含标题「🔴 断点告警」「📅 最近运行时间线」「📊 各域生命周期」
- 断点区出现那条 `status:'failure'` 的 `domain`+`error`
- 时间线按 `run_id` 倒序、每行显示 N/7
- 域生命周期对同域两次 `row_count` 算出正确增量
- `loadEvents` 跳过一行非法 JSON 仍返回有效事件

**Step 2:** 跑测试确认失败

**Step 3: 实现** `render.mjs`（纯函数渲染；`loadEvents` 用 `readFileSync` 按行 `JSON.parse` 包 try 跳坏行）

**Step 4:** 跑测试确认通过

**Step 5:** Commit —— `feat(etl-ledger): render 三视角中文报告生成器`

---

### Task 3: git 历史回填（TDD + 真实回填）

**Files:**
- Create: `scripts/etl-ledger/backfill-from-git.mjs`
- Test: `scripts/__tests__/etl-ledger-backfill.test.mjs`

**逻辑（设计文档 §9）：** `git log --reverse --format=%H %ci -- 数据管理/data-sources.json` → 逐 sha `git show <sha>:数据管理/data-sources.json` → 解析各域 `id/row_count/data_range/last_updated` → 生成 `stage:'etl'`、`backfilled:true`、`actor:'backfill'` 事件。

**Step 1: 写失败测试** —— 抽出可单测的纯函数 `parseSnapshotToEvents(dataSourcesJson, commitMeta)`：给一个 mini `data-sources.json`（2 个域）+ 提交元数据 → 返回 2 条事件，字段正确、`backfilled===true`。

**Step 2:** 跑测试确认失败

**Step 3: 实现** —— 纯函数 `parseSnapshotToEvents` + 一个 `main()` 跑真实 git（`execFileSync('git', [...])`）。

**Step 4:** 跑单测确认通过

**Step 5: 真实回填验证** —— `node scripts/etl-ledger/backfill-from-git.mjs`，然后 `wc -l 数据管理/ledger/etl-ledger.jsonl`（期望 ≥50 行），`grep -c '"backfilled":true'` 同量级。

**Step 6:** Commit —— `feat(etl-ledger): git 历史回填（data-sources.json 55 提交）+ 初始台账`

---

### Task 4: daily.mjs ①②③ 埋点（source/etl/validate）

**Files:** Modify `数据管理/daily.mjs`

**Step 1: 精确定位** —— 用 LSP / `grep -n` 在 `daily.mjs` 找：源文件发现处（①）、每域 Parquet 产出成功处（②，靠近现有 `updateDataSources(...)` 调用）、域校验处（③，靠近 `validateDomainCandidate`/校验返回）。把行号记进本 task 笔记。

**Step 2: 顶部 import** —— `import { recordEvent } from '../scripts/etl-ledger/record.mjs';`（确认相对路径：`数据管理/daily.mjs` → `../scripts/etl-ledger/record.mjs`）。

**Step 3: 插入 3 处埋点**（模板，字段从就近上下文取，全部用现成变量，不新增计算）：
```js
recordEvent({ stage: 'etl', step: `${domainId}_transform`, domain: domainId,
  status: 'success', row_count: rowCount, date_range: dataRange,
  output_fp: outputFp, duration_ms: Date.now() - t0 });
```
校验失败处：`recordEvent({ stage: 'validate', step: `${domainId}_validate`, domain: domainId, status: 'failure', error: reason });`

**Step 4: 集成验证** —— `ETL_RUN_ID=test-$(date +%s) node 数据管理/daily.mjs <一个轻量域>`，然后 `tail -5 数据管理/ledger/etl-ledger.jsonl` 看到该 run 的 source/etl/validate 事件。若无源数据可跑，则 `--dry` 或最小域；记录实际验证手段。

**Step 5:** Commit —— `feat(etl-ledger): daily.mjs 源/转换/校验三处埋点`

---

### Task 5: sync-vps.mjs ④ 埋点（vps_sync）

**Files:** Modify `scripts/sync-vps.mjs`

**Step 1:** `grep -n` 定位 rsync 完成 + 完整性闸门判定处（`evaluateFreshness`/闸门结果附近）。

**Step 2:** import `./etl-ledger/record.mjs`，在闸门通过/拒绝两个分支各埋一笔：`stage:'vps_sync'`，status 随闸门结果，附 bytes/闸门原因。

**Step 3: 集成验证** —— `node scripts/sync-vps.mjs`（或其安全/dry 形态）后 `tail` 看 vps_sync 事件。

**Step 4:** Commit —— `feat(etl-ledger): sync-vps.mjs VPS 同步埋点`

---

### Task 6: sync-and-reload.mjs ⑤⑥⑦ 埋点 + 末尾 render

**Files:** Modify `scripts/sync-and-reload.mjs`

**Step 1:** 在发布入口生成并 export `ETL_RUN_ID`（`process.env.ETL_RUN_ID ||= <时间戳>`），贯穿全链路。

**Step 2:** `grep -n` 定位 Stage 4 reload 后（⑤）、health 检查后（⑥）、health 阶段回读 `/api/data/version`（⑦）。

**Step 3:** 三处埋点：reload（status）、health（status + data_version）、frontend（回读 `/api/data/version` 的 data_version = VPS 当前对外版本，见设计文档诚实边界）。

**Step 4: 末尾刷新报告** —— 全流程结束调 `writeReport()` 重渲染 `数据管理/ledger/数据流转台账.md`。

**Step 5: 集成验证** —— `bun run release:daily:dry` 不报错；检查 `数据流转台账.md` 三视角生成。

**Step 6:** Commit —— `feat(etl-ledger): release 全链路 reload/health/frontend 埋点 + 末尾渲染报告`

---

### Task 7: governance 防漏记检查

**Files:** Modify `scripts/check-governance.mjs`

**Step 1: 写失败测试** `scripts/__tests__/etl-ledger-governance.test.mjs` —— 抽纯函数 `checkLedgerFreshness({ ledgerLatestTs, dataSourcesMtime })`：当 `data-sources.json` 比最新台账事件新超过阈值（如 6 小时）→ 返回 warn；台账缺失/空 → 返回 warn；正常 → pass。

**Step 2:** 跑确认失败。

**Step 3: 实现** 纯函数 + 接到 `check-governance.mjs` 检查清单（仿现有检查项风格，warn 级不阻断）。

**Step 4:** `bun run governance` 验证检查项出现且当前 pass。

**Step 5:** Commit —— `feat(etl-ledger): governance 防漏记检查（台账新鲜度）`

---

### Task 8: 端到端验证 + 断点演练 + INDEX 更新

**Step 1: 断点演练** —— 临时让某域校验抛错跑一次 → 确认 `数据流转台账.md` 断点告警区高亮该条（status=failure + error）→ 还原。

**Step 2: 全链路 dry** —— `bun run release:daily:dry` 全绿。

**Step 3: 核心 INDEX 更新** —— `开发文档/00_index/DATA_INDEX.md` 与 `CODE_INDEX.md` 加台账条目（CLAUDE.md §5：核心层改动须更新 INDEX）。

**Step 4: 全量验证** —— `bun run verify:full`（preflight + governance + typecheck + 单测）全过。

**Step 5:** Commit —— `docs(etl-ledger): 端到端验证 + INDEX 登记`

---

## 完成判定（DoD）
- [ ] `etl-ledger.jsonl` 含回填历史（≥50）+ 至少一次真实 run 的全链路事件
- [ ] `数据流转台账.md` 三视角正确、断点演练高亮成功
- [ ] `bun run verify:full` 全过
- [ ] 记账失败不阻断主流程（Task 1 用例 + 埋点 try/catch 双保险）
- [ ] DATA_INDEX / CODE_INDEX 已登记
