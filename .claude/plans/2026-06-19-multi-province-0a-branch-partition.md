# 多省接入 0a（省份管道 + 隔离验证）实施计划 — 评审校准版

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实现。
> **本计划经双模型对抗式评审校准（2026-06-19）**，取代初版。校准要点见 ADR §11。

**Goal:** 把多省接入需要的"管道层"全部 branch-aware 化（governance/ETL/sync 不再假设单省扁平目录），并在**隔离环境**验证山西（SX）ETL 与口径——**全程不把 SX 数据载入服务端共享 runtime**，四川行为零回退。

**Architecture:** 沿用"单数据湖 + `branch_code` 列 + RLS"（ADR D1）。0a＝**省份前缀文件名 + 扁平目录 + branch-aware 管道**（非 Hive 子目录，ADR D3）。SX 数据进共享 runtime 的硬前置是"口径签字 G5 + `BRANCH_RLS_ENABLED=true`"，**不在 0a 范围**（ADR D5 / Day-1 SOP）。

**Tech Stack:** Node.js（daily.mjs / sync-vps.mjs / quick_reference.mjs / parquet-overlap-check.mjs / check-governance.mjs）、Python（transform.py）、DuckDB、vitest、bun。

---

## 0. 校准后的核心原则（执行前必读）

1. **0a 不载入 SX 到共享 `current/`**。装载器把 `current/*.parquet` 全量物化进同一内存表 `PolicyFactRealtime`（`server/src/services/duckdb-materialization.ts:176`）；RLS 默认关（`server/src/config/env.ts:127`）。SX 一旦进 `current/`，四川用户即看到混省数据。SX 的 ETL 产物落**独立验证目录**，用 `duckdb` 直查验证，**绝不进 `current/`、绝不 sync-vps**。
2. **"四川零差异"在 0a 自然成立**——因为 0a 不载入 SX，`current/` 内容不变，golden-baseline 比对的是"管道代码改动有没有回归四川"，不是"加了 SX 还零差异"。
3. **省份前缀约定**：新省分片文件名带 `<BRANCH>_` 前缀（如 `SX_`）；**四川分片保持裸名不变**（golden-baseline 零差异）。`branch_code` 仍是数据列（ETL 已注入）。前缀仅被管道脚本消费（重叠检测/归档/行数/同步），DuckDB 加载与 71/78 端点 SQL 不消费前缀。
4. **行号会漂移**：每次 Edit 前先 Read 当前确切内容再精确替换；本计划代码片段是意图，不是免读凭证（红线：验证不声称）。

**完成定义（DoD）**：
- `bun run governance` + `bun run verify:full` 全绿（含本计划新增单测）。
- `scripts/golden-baseline.mjs --compare`（改动前 commit 抓的基线）四川 **78** 端点零差异。
- 构造"SC 裸名 + SX 前缀"双省文件场景，governance #13/#15 不误报。
- SX ETL 产物在**独立目录**经 `duckdb` 直查，premium/行数与山西原始 Excel 误差 ≤ 万分之一。

---

# 阶段一：branch-aware 管道（纯代码，不碰 SX 数据）

> 这一阶段全部可在"零 SX 数据"下完成与验证，四川零差异天然成立，最安全。

## Task 1：重叠检测按省份分组（+ 登记孤立限摩缺陷，不假装修复）

**Files:**
- Modify: `scripts/lib/parquet-overlap-check.mjs`
- Test: `scripts/lib/__tests__/parquet-overlap-check.test.ts`（先确认是否存在 + 在 `vite.config.ts` include 内）

**Step 1.1：确认测试位置** — Run: `ls scripts/lib/__tests__/ 2>/dev/null; grep -rl parquet-overlap-check tests server scripts 2>/dev/null | grep -i test`

**Step 1.2：写失败测试**
```typescript
import { describe, it, expect } from 'vitest';
import { detectPolicyCurrentOverlap, parseBranchFromFilename } from '../parquet-overlap-check.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('parseBranchFromFilename', () => {
  it('前缀提取省份；裸名回退 SC', () => {
    expect(parseBranchFromFilename('SX_20210101-20260617_01_签单清单_定稿.parquet')).toBe('SX');
    expect(parseBranchFromFilename('20210101-20260617_01_签单清单_定稿.parquet')).toBe('SC');
  });
});

describe('detectPolicyCurrentOverlap 跨省豁免 + 组内回归', () => {
  const mk = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'ovl-'));
    files.forEach(f => writeFileSync(join(dir, f), 'x'));
    return dir;
  };
  it('SC 与 SX 同期不算重叠', () => {
    const d = mk(['20210101-20260617_01_签单清单_定稿.parquet', 'SX_20210101-20260617_01_签单清单_定稿.parquet']);
    try { expect(detectPolicyCurrentOverlap(d).count).toBe(0); } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('同省内真实重叠仍检出', () => {
    const d = mk(['SX_20210101-20260617_01_签单清单_定稿.parquet', 'SX_20250101-20260617_01_签单清单_定稿.parquet']);
    try { expect(detectPolicyCurrentOverlap(d).count).toBeGreaterThan(0); } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
```

**Step 1.3：跑测试确认失败** — Run: `bun run test --run scripts/lib/__tests__/parquet-overlap-check.test.ts`（FAIL：函数未导出 / 跨省误判）

**Step 1.4：实现** — 加导出函数（紧跟 `parseDateRangeFromFilename`）：
```javascript
/** 文件名省份前缀（CHAR(2)）；无前缀＝四川裸名，回退 'SC' */
export function parseBranchFromFilename(filename) {
  const m = filename.match(/^([A-Z]{2})_/);
  return m ? m[1] : 'SC';
}
```
读 `parquet-overlap-check.mjs:52-67` 当前双重循环，按 branch 分组后组内比对（保留 `isComplementaryPair` 剔摩/限摩豁免）：
```javascript
  const byBranch = new Map();
  for (const f of parquetFiles) {
    const b = parseBranchFromFilename(f.name);
    (byBranch.get(b) ?? byBranch.set(b, []).get(b)).push(f);
  }
  const overlaps = [];
  for (const group of byBranch.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.range.start <= b.range.end && b.range.start <= a.range.end) {
          if (isComplementaryPair(a.name, b.name)) continue;
          overlaps.push({ a: a.name, b: b.name, aRange: [a.range.start, a.range.end], bRange: [b.range.start, b.range.end] });
        }
      }
    }
  }
```

**Step 1.5：跑测试确认通过** — Run: `bun run test --run scripts/lib/__tests__/parquet-overlap-check.test.ts`（PASS）

**Step 1.6：登记"孤立限摩"现存缺陷**（评审论点④：注释 `parquet-overlap-check.mjs:7-8` 声称"孤立限摩必须报错"但无实现）。**不在本任务修**，登记 BACKLOG：
Run: `bun scripts/backlog.mjs add --owner @claude --type Bug --priority P3 --title "孤立限摩检测缺失：parquet-overlap-check 注释声称必报错但无实现（单文件无配对剔摩静默放行）"`

**Step 1.7：回归 + 提交**
```bash
bun run governance   # #13 仍绿
git add scripts/lib/parquet-overlap-check.mjs scripts/lib/__tests__/parquet-overlap-check.test.ts BACKLOG*.* 2>/dev/null
git commit -m "fix(governance): 重叠检测按省份分组，跨省同期分片不误报数据翻倍

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 2：quick_reference 分片数按省统计（解 governance #15 CI 卡死）

**为什么**：`数据管理/pipelines/quick_reference.mjs:96` 把 `current/` 文件总数当 `shardCount` 写进 `QUICK_REFERENCE.md`；SC+SX 并存后翻倍，governance #15（`check-governance.mjs:~1173`）在 CI 非交互模式 `exit 1`。

**Files:** Modify `数据管理/pipelines/quick_reference.mjs`（`collectPolicyCurrentStats`）；可能联动 `scripts/check-governance.mjs` #15 判定。Test: `tests/quick-reference-shardcount.test.ts`（新建，若该模块可被单测导入）。

**Step 2.1：读现状** — Run: `sed -n '80,125p' 数据管理/pipelines/quick_reference.mjs` + `sed -n '1170,1230p' scripts/check-governance.mjs`，确认 shardCount 写入格式与 #15 比对逻辑。

**Step 2.2：决定口径** — `shardCount` 改为**按省分组的对象/明细**（如 `{ SC: 4, SX: 4 }` 或仅统计当前 BRANCH_CODE 省的分片数），`QUICK_REFERENCE.md` 文案改"按省 N 个分片"。#15 比对相应改为按省核对。**先写测试固定期望格式**再改实现。

**Step 2.3：失败测试 → 实现 → 通过**（同 Task 1 节奏）。用临时目录放"SC 裸名×4 + SX 前缀×4"验证 shardCount 按省＝各 4，而非 8。

**Step 2.4：回归** — `bun run governance`（#15 在双省场景绿）；构造双省临时分片确认不再 exit 1。

**Step 2.5：提交** — `git commit -m "fix(governance): QUICK_REFERENCE 分片数按省统计，多省并存不触发 #15 误报"`（带 trailer）

## Task 3：daily.mjs 接受 BRANCH_CODE + 全链路 branch-scoped

**目标**：`BRANCH_CODE=SX node 数据管理/daily.mjs premium` 时——① 从 `数据管理/staging/SX/` 读源；② 范围互斥/归档只在 SX 范围内；③ 输出分片带 `SX_` 前缀；④ `data-sources.json` 行数按省。**`BRANCH_CODE=SC`（默认）逐字节同现状**。

**Files:** Modify `数据管理/daily.mjs`（premium 处理函数：源 glob、`RANGE_RE:1449`、归档正则 `~1587`、data-sources 行数 `~1651`、输出路径）；新建纯函数 `数据管理/lib/branch-naming.mjs`。Test: `tests/branch-naming.test.ts`。

**Step 3.1：读三个改造点** — Run: `grep -n "RANGE_RE\|scriptDir\|outputName\|data-sources\|row_count\|join.*current\|archive" 数据管理/daily.mjs | sed -n '1,50p'`（定位源 glob / 互斥 / 归档 / 行数 / 输出五处的确切行）。

**Step 3.2：纯函数 + 测试**（`branch-naming.mjs`）
```javascript
/** 分片输出名加省份前缀；SC/空＝裸名（四川零差异） */
export function applyBranchPrefix(baseName, branchCode) {
  return (!branchCode || branchCode === 'SC') ? baseName : `${branchCode}_${baseName}`;
}
/** 当前省的源 staging 目录；SC＝数据管理根（现状），其余＝staging/<省>/ */
export function branchSourceDir(rootDir, branchCode) {
  return (!branchCode || branchCode === 'SC') ? rootDir : `${rootDir}/staging/${branchCode}`;
}
```
```typescript
import { describe, it, expect } from 'vitest';
import { applyBranchPrefix, branchSourceDir } from '../数据管理/lib/branch-naming.mjs';
describe('branch-naming', () => {
  it('SC 裸名零差异', () => { expect(applyBranchPrefix('a.parquet', 'SC')).toBe('a.parquet'); expect(applyBranchPrefix('a.parquet', undefined)).toBe('a.parquet'); });
  it('SX 加前缀', () => expect(applyBranchPrefix('a.parquet', 'SX')).toBe('SX_a.parquet'));
  it('SC 源＝根，SX 源＝staging/SX', () => { expect(branchSourceDir('/r', 'SC')).toBe('/r'); expect(branchSourceDir('/r', 'SX')).toBe('/r/staging/SX'); });
});
```
Run: `bun run test --run tests/branch-naming.test.ts`（先 FAIL 后 PASS）

**Step 3.3：接入 daily.mjs**（premium 函数顶部 `const BRANCH_CODE = process.env.BRANCH_CODE || 'SC';` + import）。五处改造：
- 源 glob 目录用 `branchSourceDir(scriptDir, BRANCH_CODE)`
- `RANGE_RE`（1449）与归档正则（~1587）：允许可选 `^(?:[A-Z]{2}_)?` 前缀，且分组/比对按 `parseBranchFromFilename` 限定本省
- 输出分片名用 `applyBranchPrefix(name, BRANCH_CODE)`
- `data-sources.json` 行数（~1651）：按 `branch_code` 分组统计（或本省增量更新，不汇总他省）

> ⚠️ 五处逐一 Read 当前实现后再改。每改一处即跑 `BRANCH_CODE=SC` 验证四川输出不变。

**Step 3.4：SC 零差异闸** — Run: `BRANCH_CODE=SC node 数据管理/daily.mjs premium`（若本地有 SC 源）后 `ls 数据管理/warehouse/fact/policy/current/`：文件名/数量与运行前**完全一致**。

**Step 3.5：提交** — `git commit -m "feat(etl): daily.mjs 支持 BRANCH_CODE 全链路 branch-scoped（SC 零差异）"`（带 trailer）

## Task 4：sync-vps 按省安全（--delete / 新鲜度闸）

**为什么**：`scripts/sync-vps.mjs:368`（`--delete`）、`:459`（新鲜度按全目录总行数）、`:595`（整目录同步）在多省下：`--delete` 本身只删"本地没有的"不会误删（评审已确认安全），但**新鲜度闸按全目录总行数**会被他省数据干扰。

**Files:** Modify `scripts/sync-vps.mjs`。Test: 若新鲜度判定可抽纯函数则单测；否则 `--dry-run` 验证。

**Step 4.1：读** — `sed -n '355,470p' scripts/sync-vps.mjs` + `sed -n '585,605p'`，确认 `--delete` 行为与新鲜度计算口径。

**Step 4.2：改** — 新鲜度闸改为"按本省 `branch_code` 行数/签单日期"判定；**0a 阶段额外加一道护栏**：sync-vps 默认**只同步 SC**（或显式 `--branch` 才同步指定省），防止有人在 RLS-on 前误把 SX 推上生产（呼应 ADR D5）。

**Step 4.3：验证** — `node scripts/sync-vps.mjs --dry-run` 打印计划，确认默认不含 SX 前缀文件、新鲜度按省。

**Step 4.4：提交** — `git commit -m "feat(sync): sync-vps 新鲜度按省 + 默认不推非 SC（RLS-on 前防误推 SX 到生产）"`（带 trailer）

## Task 5（仅登记，不改）：web 上传归档正则对省份前缀失明

评审论点①/额外风险 B：`server/src/routes/data.ts:367` 归档正则把 `SX_` 吃进 prefix 段。0a 走 ETL+rsync **不经此路径**，记为已知限制，登记 BACKLOG（`bun scripts/backlog.mjs add ... --title "data.ts:367 web 上传归档正则对省份前缀失明（多省上传可能误归档）"`），待 web 上传支持多省时再修。

---

# 阶段二：山西 ETL 隔离验证（本地，绝不进共享 runtime）

## Task 6：山西源省份化落位（G1）

**Step 6.1：建目录** — `mkdir -p 数据管理/staging/SX`；确认 `.gitignore` 覆盖 `数据管理/staging/`（大文件源禁入 git）。

**Step 6.2：核对真实日期区间后重命名落位**（红线：文件名-数据日期偏移）。先读源真实 MIN/MAX 签单日期：
Run: `duckdb -c "SELECT MIN(签单日期), MAX(签单日期) FROM '/Users/alongor666/Downloads/山西车险数据/山西_签单清单_2021-2026.xlsx'"`（DuckDB 读 xlsx 需 `INSTALL excel; LOAD excel;` 或转 pandas；拿不到则用 pandas 读）。按真实区间命名：

| 山西源 | 目标（`数据管理/staging/SX/`，区间以实测为准） | 域 |
|---|---|---|
| 山西_签单清单_2021-2026.xlsx | `<minYMD>-<maxYMD>_01_签单清单_定稿.xlsx` | premium |
| 山西_理赔明细_报案时间2026(1).xlsx | `<min>-<max>_05_理赔明细.xlsx` | claims_detail |
| 山西_报价清单_商业险2025.12.1-2026.6.17 (1).xlsx | `<min>_02_报价清单_商业险.xlsx` | quotes |
| 山西_厂牌车型(1).xlsx | `<max>_04_厂牌明细.xlsx` | brand |
| 山西_维修资源2026(1).xlsx | `<min>-<max>_03_维修资源.xlsx` | repair |

## Task 7：SX ETL 到独立验证目录 + 口径对账（不进 current/）

**Step 7.1：ETL 到隔离目录** — 用 `transform.py -o` 直接指定隔离输出（**不走会写 `current/` 的 daily.mjs 发布步**），或给 daily.mjs 加 `--validate-only --out 数据管理/staging/SX/_validated/`。产物落 `数据管理/staging/SX/_validated/`，**绝不进 `数据管理/warehouse/fact/policy/current/`**。

**Step 7.2：branch_code 注入验证** — Run:
```bash
duckdb -c "SELECT DISTINCT branch_code FROM '数据管理/staging/SX/_validated/*.parquet'"   # 期望仅 'SX'
```

**Step 7.3：口径对账（万分之一）** — Run:
```bash
duckdb -c "SELECT COUNT(*) rows, ROUND(SUM(premium),2) prem FROM '数据管理/staging/SX/_validated/*.parquet'"
```
与山西原始 Excel 行数/保费比对，误差 ≤ 万分之一（口径对齐_山西.md §2/§3）。字段枚举（客户类别/险类/风险等级）与 SC 偏差记录到 `口径对齐_山西.md` 供业务签字。

**Step 7.4：提交验证脚本/记录**（不提交数据）— `git commit -m "chore(multi-branch): 山西 ETL 隔离验证脚本与口径对账记录（数据不入库）"`（带 trailer）

---

# 阶段三：端到端验证（证据闭环）

**Step V.1：四川零回退（golden-baseline）** — 必须在 **0a 改动前的 commit** 上先抓基线：
```bash
git stash; git checkout <0a前commit>; bun run dev:full & ; node scripts/golden-baseline.mjs --build; git checkout -; git stash pop
bun run dev:full & ; node scripts/golden-baseline.mjs --compare    # 78 端点零差异（admin=SC；此时 current/ 无 SX，天然成立）
```
有差异即 STOP 排查。

**Step V.2：双省场景 governance** — 在临时 `current/` 放"SC 裸名 + SX 前缀"分片，跑 `bun run governance`：#13/#15 均不误报。

**Step V.3：全量校验** — `bun run verify:full`（governance + typecheck + 单测全绿）。

**Step V.4：更新索引/文档**（DONE 判定）— ADR §9 勾掉 0a；`.claude/rules/data-pipeline.md` 注省份前缀约定；`开发文档/00_index/` 加指针。

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 误把 SX 载入共享 runtime → 四川看混省数据 | 阶段二产物落隔离目录；Task 4 sync-vps 默认不推 SX；阶段三 V.1 在"无 SX"下证零差异 |
| daily.mjs 改动误伤四川 | Task 3.4 `BRANCH_CODE=SC` 空跑 + V.1 golden-baseline 双闸 |
| 行号漂移替换错位 | 每处 Edit 前先 Read（计划已标 ⚠️） |
| 日期区间命名错 | Task 6.2 用源真实 MIN/MAX 核对 |

**回滚**：0a 全为新增/旁路改动，SC 路径零变更，不启用 `BRANCH_RLS_ENABLED`。回滚＝`git revert` 各 commit + 删隔离目录 `数据管理/staging/SX/`。

---

## 不在本计划范围（SX 正式上线，按 Day-1 SOP，硬前置）

- **G5 口径业务签字** → **RLS-on（`BRANCH_RLS_ENABLED=true`）** → 载 SX 到 `current/` → sync-vps → 发账号。RLS-on 下重跑 golden-baseline + `multi-branch-stress-test --simulate-sx` 证 SC 隔离。
- G3 维度/派生域省份化、G4 派生域补 branch_code、G6 机构白名单、G7 SX 账号、G8 前端空态。
- 0b（物化层/内存收缩/真 Hive 子目录）、第 2 层（存算分离 / ClickHouse）。
