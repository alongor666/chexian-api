# 多省接入 0a（省份物理隔离）+ governance #13 实施计划

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实现本计划。

**Goal:** 让山西（SX）数据能与四川（SC）共存于同一数据湖、各自独立刷新、且 governance 不误报"数据翻倍"，全程不动 71 端点 SQL / RLS / cache，四川行为零回退。

**Architecture:** 沿用"单数据湖 + `branch_code` 省份列 + 行级安全（RLS）"（决策见 [开发文档/multi-branch/全国多省架构决策_2026-06-19.md](../../开发文档/multi-branch/全国多省架构决策_2026-06-19.md)）。本计划只做 **0a＝省份物理隔离 + governance #13**，不做 0b（内存随省份收缩，性能工程）。

**Tech Stack:** Node.js（daily.mjs / check-governance.mjs / 共享 .mjs）、Python（transform.py，ETL）、DuckDB、vitest（测试）、bun（运行器）。

---

## 0. 关键设计修正（执行前必读）

实证发现本代码库**多处假设 `current/` 是扁平目录**：
- 重叠检测 `detectPolicyCurrentOverlap` 用 `readdirSync(currentDir)`（**非递归**），见 [scripts/lib/parquet-overlap-check.mjs:43](../../scripts/lib/parquet-overlap-check.mjs)。
- VPS 加载器固定 glob `current/*.parquet`（扁平），见 `.claude/rules/data-pipeline.md`「VPS 数据加载路径」。

因此 **0a 不采用 Hive 子目录（`current/branch_code=SX/`）**——那会触发多个扁平 glob 失明点，blast radius 远超 0a 预算。**0a 采用：**

> **省份前缀文件名 + 目录保持扁平 + `branch_code` 仍是数据列**
> - 例：山西分片落 `current/SX_20210101-20260617_01_签单清单_定稿.parquet`
> - **四川分片文件名保持原样不变**（保证 golden-baseline 零差异），其 `branch_code` 列已是 `SC`
> - DuckDB 加载器、VPS glob、RLS、71 端点 **全部不动**（扁平 glob 照样命中带前缀文件，`branch_code` 列来自数据本身）
> - 省份前缀**仅**被两处消费：① 重叠检测按省分组、② daily.mjs 单省归档/刷新按省限定

真正的 Hive 子目录分区（用于 DuckDB 分区剪枝）推迟到 0b，届时一并改扁平 glob 假设。

**完成定义（DoD）**：
1. `bun run governance` 全绿（SC + SX 文件并存时 #13 不误报）。
2. `duckdb` 直查：`current/*.parquet` 含 `branch_code='SX'` 行，且 `branch_code='SC'` 行数与改造前一致。
3. `scripts/golden-baseline.mjs --compare`：四川（默认 admin=SC）71 端点零差异。
4. `scripts/multi-branch-stress-test.mjs --simulate-sx`：SC/SX cache 隔离、无串读。

---

## Task 1：governance #13 — 重叠检测按省份分组（最小、独立、先做）

**为什么先做**：它是独立的纯函数修复，不依赖 SX 数据已落地；做完即可让"SC+SX 同年份区间并存"不再误报。这是本计划唯一完全自包含、可单测的任务。

**Files:**
- Modify: `scripts/lib/parquet-overlap-check.mjs`（加 `parseBranchFromFilename` + `detectPolicyCurrentOverlap` 内按省分组）
- Test: `scripts/lib/__tests__/parquet-overlap-check.test.ts`（若不存在则 Create；先确认）

**Step 1.1：确认测试文件位置**

Run: `ls scripts/lib/__tests__/ 2>/dev/null; grep -rl "parquet-overlap-check" scripts tests server 2>/dev/null | grep test`
预期：找到现有测试文件路径；若无，则新建 `scripts/lib/__tests__/parquet-overlap-check.test.ts` 并确认它在 `vite.config.ts` 的 include 范围内（否则 CI 不跑）。

**Step 1.2：写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { detectPolicyCurrentOverlap, parseBranchFromFilename } from '../parquet-overlap-check.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('parseBranchFromFilename', () => {
  it('提取省份前缀，无前缀回退 SC（向后兼容四川裸名）', () => {
    expect(parseBranchFromFilename('SX_20210101-20260617_01_签单清单_定稿.parquet')).toBe('SX');
    expect(parseBranchFromFilename('20210101-20260617_01_签单清单_定稿.parquet')).toBe('SC');
  });
});

describe('detectPolicyCurrentOverlap — 跨省豁免', () => {
  it('SC 与 SX 同日期区间不算重叠（不同省份物理隔离）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ovl-'));
    try {
      // 同为 2021-2026 区间，仅省份不同 → 不应判为重叠
      writeFileSync(join(dir, '20210101-20260617_01_签单清单_定稿.parquet'), 'x'); // SC（裸名）
      writeFileSync(join(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet'), 'x'); // SX
      const r = detectPolicyCurrentOverlap(dir);
      expect(r.count).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同一省份内真实重叠仍被检出（回归保护）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ovl-'));
    try {
      writeFileSync(join(dir, 'SX_20210101-20260617_01_签单清单_定稿.parquet'), 'x');
      writeFileSync(join(dir, 'SX_20250101-20260617_01_签单清单_定稿.parquet'), 'x'); // 与上重叠
      const r = detectPolicyCurrentOverlap(dir);
      expect(r.count).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

**Step 1.3：运行测试，确认失败**

Run: `bun run test --run scripts/lib/__tests__/parquet-overlap-check.test.ts`
预期：FAIL（`parseBranchFromFilename` 未导出 / 跨省被误判重叠）。

**Step 1.4：实现 — 加省份解析 + 按省分组**

在 `scripts/lib/parquet-overlap-check.mjs` 加导出函数（紧跟 `parseDateRangeFromFilename` 之后）：

```javascript
/**
 * 从文件名提取省份编码（CHAR(2)）。多省物理隔离用：不同省份的同期分片不构成数据翻倍。
 * 约定：省份前缀 `<BRANCH>_...`（如 SX_）；无前缀＝四川裸名（向后兼容），回退 'SC'。
 */
export function parseBranchFromFilename(filename) {
  const m = filename.match(/^([A-Z]{2})_/);
  return m ? m[1] : 'SC';
}
```

在 `detectPolicyCurrentOverlap` 内，构建 `parquetFiles` 后**按 branch 分组**，仅组内两两比对（保留原 `isComplementaryPair` 剔摩/限摩豁免）。替换 [parquet-overlap-check.mjs:52-67](../../scripts/lib/parquet-overlap-check.mjs) 的双重循环为：

```javascript
  // 按省份分组：不同省份的同期分片是物理隔离，不构成数据翻倍（多省 0a）
  const byBranch = new Map();
  for (const f of parquetFiles) {
    const b = parseBranchFromFilename(f.name);
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b).push(f);
  }

  const overlaps = [];
  for (const group of byBranch.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.range.start <= b.range.end && b.range.start <= a.range.end) {
          if (isComplementaryPair(a.name, b.name)) continue;
          overlaps.push({
            a: a.name, b: b.name,
            aRange: [a.range.start, a.range.end],
            bRange: [b.range.start, b.range.end],
          });
        }
      }
    }
  }
```

> ⚠️ 执行前用 Read 核对 52-67 当前确切内容再做精确替换（避免行号漂移）。其余（早退、返回结构）保持不变。

**Step 1.5：运行测试，确认通过**

Run: `bun run test --run scripts/lib/__tests__/parquet-overlap-check.test.ts`
预期：PASS（3 例）。

**Step 1.6：回归 governance（无 SX 数据时不破坏现状）**

Run: `bun run governance`
预期：#13 仍通过（四川现状文件区间互补无重叠）。

**Step 1.7：提交**

```bash
git add scripts/lib/parquet-overlap-check.mjs scripts/lib/__tests__/parquet-overlap-check.test.ts
git commit -m "fix(governance): 重叠检测按省份分组，跨省同期分片不误报数据翻倍

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2：daily.mjs — 接受 `--branch` / `BRANCH_CODE`，SX 分片落省份前缀文件名

**目标**：`BRANCH_CODE=SX node 数据管理/daily.mjs premium` 时，输出分片文件名带 `SX_` 前缀、归档/互斥守卫只在 SX 范围内生效；**`BRANCH_CODE=SC`（默认）行为与现状逐字节一致**。

**Files:**
- Modify: `数据管理/daily.mjs`（premium 处理函数：① 读 `process.env.BRANCH_CODE`，默认 `SC`；② 输出分片名拼省份前缀，仅当 branch≠SC；③ 范围互斥守卫 `RANGE_RE`、归档逻辑按 branch 限定）
- 参考（不改）：`数据管理/pipelines/transform.py:1054-1089`（branch_code 列已由 `BRANCH_CODE` 注入，无需改）

**Step 2.1：先读，定位三个改造点**

Run: `grep -n "outputName\|current\|RANGE_RE\|transform\|-o \|getShardType\|join.*current" 数据管理/daily.mjs | sed -n '1,40p'`
读出 premium 处理函数里：分片 xlsx → transform.py 输出 parquet 到 `current/` 的**确切路径构建处**，以及 `RANGE_RE`（1449）、归档循环（1463-1473）。

**Step 2.2：写失败测试（纯函数优先）**

把"输出文件名拼省份前缀"抽成纯函数便于测：在 `数据管理/lib/` 新建 `branch-naming.mjs`：

```javascript
/** 给分片输出名加省份前缀；SC（默认/四川）保持裸名以兼容历史与 golden-baseline 零差异 */
export function applyBranchPrefix(baseName, branchCode) {
  if (!branchCode || branchCode === 'SC') return baseName;
  return `${branchCode}_${baseName}`;
}
```

Test: `tests/branch-naming.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { applyBranchPrefix } from '../数据管理/lib/branch-naming.mjs';

describe('applyBranchPrefix', () => {
  it('SC / 空 → 裸名不变（四川零差异）', () => {
    expect(applyBranchPrefix('20210101-20260617_01_签单清单_定稿.parquet', 'SC')).toBe('20210101-20260617_01_签单清单_定稿.parquet');
    expect(applyBranchPrefix('a.parquet', undefined)).toBe('a.parquet');
  });
  it('SX → 加前缀', () => {
    expect(applyBranchPrefix('a.parquet', 'SX')).toBe('SX_a.parquet');
  });
});
```

Run: `bun run test --run tests/branch-naming.test.ts` → 预期先 FAIL（模块不存在），建文件后 PASS。

**Step 2.3：接入 daily.mjs**

- 在 premium 处理函数顶部：`const BRANCH_CODE = process.env.BRANCH_CODE || 'SC';`
- import：`import { applyBranchPrefix } from './lib/branch-naming.mjs';`
- 在分片输出 parquet 文件名处用 `applyBranchPrefix(outputName, BRANCH_CODE)`（Step 2.1 定位的确切位置）。
- 范围互斥守卫（1449 `RANGE_RE`）与归档：保持逻辑，但 **xlsx 源已天然按 staging 目录分省**（见 Task 3），故 SX 跑只看 SX staging；输出端用前缀确保 SX parquet 不与 SC parquet 撞名。

> ⚠️ 这是本计划风险最高任务（改 ETL 编排）。务必：(a) 改完先 `BRANCH_CODE=SC` 空跑确认四川输出文件名/内容不变；(b) 任何拿不准的行，Read 当前实现后再 Edit，禁止凭本计划片段直接替换。

**Step 2.4：SC 零差异验证（关键护栏）**

Run（需本地有 SC 源或现成 current/）：`BRANCH_CODE=SC node 数据管理/daily.mjs premium` 后 `ls 数据管理/warehouse/fact/policy/current/`
预期：文件名与运行前**完全一致**（无 `SC_` 前缀，无新增/重命名）。

**Step 2.5：提交**

```bash
git add 数据管理/daily.mjs 数据管理/lib/branch-naming.mjs tests/branch-naming.test.ts
git commit -m "feat(etl): daily.mjs 支持 BRANCH_CODE，SX 分片落省份前缀文件名（SC 保持裸名零差异）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3：山西源文件省份化摄入（G1）

**目标**：SX 的 5 个源 xlsx 进入 daily.mjs 能识别的命名/路径，使 `BRANCH_CODE=SX node 数据管理/daily.mjs all` 跑通。

**现状对不上**：daily.mjs 从 `数据管理/`（scriptDir）glob `01_签单清单_*.xlsx` 等固定命名；山西文件名为 `山西_签单清单_2021-2026.xlsx` 等，命名不匹配。

**0a 最小做法（省 staging 目录 + 重命名映射）：**

**Step 3.1：建省份 staging 目录并落入 SX 源（按映射重命名）**

```bash
mkdir -p 数据管理/staging/SX
```

重命名映射（源 → daily.mjs 可识别名；日期区间用文件名实际范围，签单示例用 2021-2026 → 须确认确切起止）：

| 山西源文件 | 目标名（放 `数据管理/staging/SX/`） | 域 |
|---|---|---|
| `山西_签单清单_2021-2026.xlsx` | `20210101-20260617_01_签单清单_定稿.xlsx` | premium |
| `山西_理赔明细_报案时间2026(1).xlsx` | `20260101-20260617_05_理赔明细.xlsx` | claims_detail |
| `山西_报价清单_商业险2025.12.1-2026.6.17 (1).xlsx` | `20251201_02_报价清单_商业险.xlsx` | quotes |
| `山西_厂牌车型(1).xlsx` | `20260617_04_厂牌明细.xlsx` | brand |
| `山西_维修资源2026(1).xlsx` | `20260101-20260617_03_维修资源.xlsx` | repair |

> ⚠️ 日期区间必须用源数据真实 MIN/MAX 签单日期核对后再定名（红线：文件名-数据日期偏移），勿照搬文件名字面。先 `duckdb` 或 pandas 读源 xlsx 的签单日期 min/max。

**Step 3.2：让 daily.mjs premium 从省 staging 目录读源（小改）**

在 premium 处理函数：当 `BRANCH_CODE!=='SC'` 时，`scriptDir` 源 glob 改为 `数据管理/staging/${BRANCH_CODE}/`。
（SC 默认仍读 `数据管理/` 根，零变更。）

> 这是 Task 2 `--branch` 改造的延伸；与 Step 2.3 同一函数，建议合并到 Task 2 的同一 PR，Task 3 专注源落位 + 日期核对。

**Step 3.3：跑通 SX ETL**

Run: `BRANCH_CODE=SX node 数据管理/daily.mjs premium`
预期：`数据管理/warehouse/fact/policy/current/SX_*.parquet` 生成，日志无报错。

**Step 3.4：源数据口径验证（红线：源数据验证）**

Run:
```bash
duckdb -c "SELECT branch_code, COUNT(*) rows, ROUND(SUM(premium),2) prem FROM '数据管理/warehouse/fact/policy/current/*.parquet' GROUP BY 1 ORDER BY 1"
```
预期：出现 `SX` 行（rows>0）+ `SC` 行（与改造前一致）；SX premium/rows 与山西原始 Excel 误差 ≤ 万分之一（口径对齐_山西.md §2/§3）。

**Step 3.5：提交**

```bash
git add 数据管理/daily.mjs 数据管理/staging/.gitkeep
git commit -m "feat(etl): 山西源省份化摄入（staging/SX + premium 按省读源）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> 注：`staging/SX/` 下的真实 xlsx 是大文件源数据，**禁止入 git**（确认 `.gitignore` 覆盖 `数据管理/staging/`）。

---

## Task 4：端到端验证（证据闭环）

**Step 4.1：四川零回退（golden-baseline）**

```bash
# 若 .planning/golden-baseline/ 无基线：先在 0a 改动前的 commit 上 --build 抓基线
bun run dev:full   # 后台起服务
node scripts/golden-baseline.mjs --compare
```
预期：71 端点零差异（默认 admin=SC）。**有差异即 STOP 回滚**。

**Step 4.2：多分公司隔离压测**

```bash
JWT_SECRET=<生产/本地 jwt secret> bun run scripts/multi-branch-stress-test.mjs --simulate-sx --concurrency 10
```
预期：SC/SX cache 各自命中、SX token 不读到 SC 行、无串读（脚本自带断言，违反则 exit 1）。

**Step 4.3：治理 + 全量校验**

```bash
bun run governance      # #13 在 SC+SX 并存下绿
bun run verify:full     # preflight + governance + typecheck + 单测
```

**Step 4.4：更新文档索引（DONE 判定）**

- 在架构决策 ADR §9 勾掉"实施计划/0a 落地"。
- 若核心数据布局约定变化，更新 `.claude/rules/data-pipeline.md`「数据文件」表注明省份前缀约定。
- `开发文档/00_index/` 相关 INDEX 增本计划与 ADR 指针。

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| Task 2 改 ETL 编排误伤四川 | Step 2.4 `BRANCH_CODE=SC` 空跑零差异 + Step 4.1 golden-baseline 零差异双闸 |
| 行号漂移导致 Edit 替换错位 | 每个替换前先 Read 当前确切内容（计划已标 ⚠️） |
| 日期区间命名错 → 重叠误判/数据缺口 | Step 3.1 用源真实 MIN/MAX 签单日期核对后命名 |
| 大文件源误入 git | Task 3 末确认 `.gitignore` 覆盖 `数据管理/staging/` |

**回滚**：0a 全部为新增/旁路改动（SC 路径零变更）。回滚＝`git revert` 三个 commit + 删除 `current/SX_*.parquet`。RLS flag `BRANCH_RLS_ENABLED` 本计划不启用（发账号阶段才启，见 Day-1 SOP），故 0a 落地不影响线上四川用户。

---

## 不在本计划范围（后续）

- 0b（物化层改造 / 内存随省份收缩）、第 2 层（存算分离 / ClickHouse）—— 见 ADR §7。
- G3 维度表省份化、G4 派生域补 branch_code、G6 机构白名单、G7 SX 账号、G8 前端空态 —— 发账号前置，独立任务。
- G5 业务口径签字 —— 业务方动作，与 0a 并行。
