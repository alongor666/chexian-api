# 多省接入 0a 实施计划 — v3（两轮对抗评审校准）

> **For Claude:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐任务实现。
> **本计划经两轮双模型对抗评审（2026-06-19）**：v1→v2 修架构序列，v2→v3 修执行机制。校准账见 ADR §11。

**Goal:** 把多省接入的"管道层"准备成 branch-aware（纯代码 + 合成文件单测），并在**隔离目录**验证山西（SX）premium ETL 与口径——**SX 数据全程不进 `current/`、不进共享 runtime、不 sync VPS**，四川行为零回退。

**Architecture:** 单数据湖 + `branch_code` 列 + RLS（ADR D1）。**0a 关键不变量（v3 纠正）**：`数据管理/warehouse/fact/policy/current/` 在 0a 期**保持 SC-only**；SX premium ETL 产物落隔离目录 `数据管理/warehouse/validation/SX/`。SX 进 `current/` 是 GATED 上线事件（口径签字 G5 + `BRANCH_RLS_ENABLED=true`），**不在 0a**（ADR D5 / Day-1 SOP）。

**Tech Stack:** Node.js（parquet-overlap-check.mjs / quick_reference.mjs / daily.mjs / sync-vps.mjs）、Python（transform.py）、DuckDB、vitest、bun。

---

## 执行状态与断点续传（SSOT — 每完成一任务即更新本节并提交）

> **为什么有本节**：单会话上下文会满、聊天记录不持久。本节是**唯一的执行状态事实源**，落在 git 里。任何新会话只需读「本计划 + ADR §11 校准账」即可热启动，无需翻聊天。

**热启动步骤（新会话照做）**：
1. 读本文件全文 + `开发文档/multi-branch/全国多省架构决策_2026-06-19.md`（尤其 §11 两轮评审校准，避免重蹈已修的洞）。
2. `git log --oneline -10` 看已落地的任务 commit，对照下表"状态/commit"列。
3. 从下表第一个 ⏳ 任务续做。**worktree 内只做"可验证"列为✅的任务**；标"需数据环境"的转主目录跑。
4. 完成一任务：跑其验证 → `git commit`（带 `Co-Authored-By: Claude` trailer）→ 回填下表"状态/commit"→ 提交本计划。

**铁律护栏（续传时务必守住，来自两轮评审）**：
- 🔴 `数据管理/warehouse/fact/policy/current/` 在 0a 期**保持 SC-only**；SX 产物只落 `warehouse/validation/SX/`。每次 SX 相关操作前后 `git status` 双查 current/ 无 SX。
- 🔴 SX 源用**普通命名**放 `staging/SX/`、靠 `BRANCH_CODE` env 贴省份，**不靠文件名前缀** → 不改 `shard-classify.mjs`。
- 🔴 不改 frozen 文件 `.claude/rules/data-pipeline.md`（需 `[policy-override]`）。

**任务状态表**：

| # | 任务 | 可在 worktree 验证 | 状态 | commit |
|---|------|:---:|------|--------|
| — | ADR 决策 + 两轮评审校准 | — | ✅ | `c99e35b9` / `017a46da` |
| — | 计划 v3（隔离模型） | — | ✅ | `411e3c5f` |
| 1 | 重叠检测按省分组 | ✅ | ✅ | `77e65745`（19/19 测试 + governance 42） |
| 2 | quick_reference 分片数按省（保 SC 整数兼容） | ✅ | ⏸ 缓（GATED 上线预备；0a 期 current/ SC-only，零影响，不空转） | — |
| 3 | daily.mjs `BRANCH_CODE` + 隔离输出根 | 纯函数✅ / 接线需数据 | ✅ | `f40bb858`（纯函数 5 测试）+ `59eff5fb`（接线：SC 路径等价证明 + SC ETL 实跑 current/ sha256 零差异 + governance 42） |
| 4 | sync-vps 纵深防御（默认不推非 SC） | ✅ | ⏸ 缓（GATED 上线预备） | — |
| 5 | 登记 GATED 上线命名库扩展（BACKLOG） | ✅ | ⏳ | — |
| 6 | 山西源落位 staging/SX | 需数据环境 | ⏳ 主目录 | — |
| 7 | SX premium ETL → validation/SX + 口径对账 | 需数据环境 | ⏳ 主目录 | — |
| V | 端到端验证（单测/governance worktree；golden-baseline 需数据） | 部分 | 🟡 单测/governance 已绿；golden-baseline 待主目录 | — |

**当前断点**（2026-06-19 主目录续传更新）：Task 1 + Task 3（纯函数 **+ 接线**）已完成并验证（SC 零差异闸通过，commit `59eff5fb`）。Task 2/4 是 GATED 上线预备、0a 期零影响，已缓。**下一步**：golden-baseline 四川零差异确认（回归网）→ Task 6（山西源落位 staging/SX）→ Task 7（SX premium ETL 隔离验证 + 口径对账）。本会话在带数据湖的主目录（分支 `claude/mp-0a-etl-wiring`）执行。

---

## 主目录热启动提示词（新会话复制即用）

> 当本会话上下文将满 / 需切到带数据的主目录继续时，把下面整段贴给新会话。

```
我在 chexian-api 主目录（/Users/alongor666/Downloads/底层数据湖DUD/chexian-api，带数据湖）继续"山西多省接入 0a"。

【已完成·勿重做】分支 claude/zen-booth-c2fadd（worktree 已提交，主目录先 git fetch + checkout 或 cherry-pick 这些 commit）：
- ADR + 两轮对抗评审校准：开发文档/multi-branch/全国多省架构决策_2026-06-19.md（读 §11 校准账，避免重蹈已修的洞）
- 计划 SSOT：.claude/plans/2026-06-19-multi-province-0a-branch-partition.md（读"执行状态与断点续传"节）
- Task 1 重叠检测按省分组：scripts/lib/parquet-overlap-check.mjs（commit 77e65745，19/19 测试+governance 42 通过）
- Task 3 纯函数 branchSourceDir/branchOutputRoot：数据管理/lib/branch-naming.mjs（commit f40bb858，5 测试）

【铁律护栏·必须守住】
1. 数据管理/warehouse/fact/policy/current/ 在 0a 期保持 SC-only；SX premium ETL 产物只落 warehouse/validation/SX（用 branchOutputRoot 计算，非 current/）。每次 SX 操作前后 git status 双查 current/ 无 SX。
2. SX 源用普通命名（无 SX_ 前缀）放 数据管理/staging/SX/，靠 BRANCH_CODE=SX env 注入省份列；不靠文件名前缀 → 不改 shard-classify.mjs。
3. 不改 frozen 文件 .claude/rules/data-pipeline.md（需 [policy-override]）。
4. 不启用 BRANCH_RLS_ENABLED（那是 GATED 上线 + 口径签字 G5 之后的事）。

【剩余步骤·按序】
1. Task 3 接线：daily.mjs premium 函数顶部读 const BRANCH_CODE=process.env.BRANCH_CODE||'SC'，源目录用 branchSourceDir(scriptDir,BRANCH_CODE)、输出根用 branchOutputRoot(join(__dirname,'warehouse'),BRANCH_CODE)。每改一处先 Read 当前行。改完先 BRANCH_CODE=SC node 数据管理/daily.mjs premium 跑，确认 current/ 文件名/数量逐字节不变（四川零差异）。
2. golden-baseline 四川零差异：在 0a 改动前 commit 上 bun run dev:full 等 ready → node scripts/golden-baseline.mjs --build（落 .planning/golden-baseline/，77 活跃端点）；应用 0a 改动后 --compare 期望零差异。
3. Task 6 山西源落位：mkdir 数据管理/staging/SX；先用 pandas/duckdb 读 /Users/alongor666/Downloads/山西车险数据/山西_签单清单_2021-2026.xlsx 真实 MIN/MAX 签单日期，按真实区间用普通命名落位（<min>-<max>_01_签单清单_定稿.xlsx）。确认 .gitignore 覆盖 数据管理/staging/。
4. Task 7 SX premium ETL 隔离验证：git status 基线 → BRANCH_CODE=SX node 数据管理/daily.mjs premium（产物落 warehouse/validation/SX）→ git status 确认 current/ 无新增 → duckdb 查 validation/SX/*.parquet：branch_code 全 SX、行数/保费 vs 山西原始 Excel 误差≤万分之一 → 字段枚举对比记入 口径对齐_山西.md 供业务签字。
5. 每完成一步：跑验证 → git commit（带 Co-Authored-By: Claude trailer）→ 回填计划"任务状态表"commit 列 → 提交计划。

【不在 0a 范围】Task 2/4（GATED 上线预备）、G3-G8、非 premium 域 branch_code 注入、0b、第2层。这些等口径签字 G5 + RLS-on 再做（Day-1 SOP）。

【要回避的坑·两轮评审】① 别把 SX 写进 current/（v2 犯过，违反 D5）② 别只改 daily.mjs 局部正则而漏 shard-classify（v3 用"普通命名+env"绕开，故不用改它，但别又给 SX 源加前缀）③ quick_reference 改格式会撞 parser/governance#15/既有测试（0a 不动它）④ golden-baseline 是 77 活跃端点、仅 admin=SC 视角、基线须改动前 commit 抓。
```

---

## 0. v3 核心纠正（执行前必读）

**round-2 评审证实 v2 仍违反自己的 D5**：v2 Task3 让 SX 写进 `current/`，而服务端本地优先加载 `current/`（`server/src/config/paths.ts:28`）→ SX 仍进本地共享 runtime。v3 的根本纠正：

1. **current/ 在 0a 期保持 SC-only**。SX premium ETL 用 `BRANCH_CODE=SX` 注入省份列，输出落隔离目录 `warehouse/validation/SX/`，**绝不进 `current/`**。因此：
   - 服务端 / golden-baseline / 派生域只读 `current/`（SC-only）→ 四川零差异自然成立、无 D5 矛盾。
   - governance #13/#15 扫的 `current/` 仍 SC-only → 0a 期**不会**因双省误报；branch-aware 改造是**为 GATED 上线预备**（纯代码+合成单测验证），非"0a 因 SX 在 current/ 而必须"。
2. **SX 源文件用普通命名放 `数据管理/staging/SX/`**（如 `20210101-20260617_01_签单清单_定稿.xlsx`，**无 `SX_` 前缀**）。省份身份来自 `BRANCH_CODE` env（列注入）+ staging 目录，**不靠文件名前缀** → `shard-classify.mjs:extractDateRange`/`getShardType`/`extractBatchDateFromName` **无需改动**（round-2 N1-B/N5 的"漏改识别正则"问题因此消失）。
3. **省份前缀文件名仅用于 GATED 上线后 current/ 内多省共存**，那时才需要 overlap-check/quick_reference 的 branch-aware（本计划提前备好+测好，但不在 0a 启用到 current/）。
4. **行号会漂移**：每次 Edit 前先 Read 当前内容（红线：验证不声称）。worktree 无数据，golden-baseline 须在带数据环境（主目录）跑，见阶段三。

**完成定义（DoD）**：
- 阶段一管道单测全绿（合成临时文件，worktree 内可跑）；`bun run governance` + `bun run verify:full` 不回退。
- 阶段二：SX premium ETL 产物在 `warehouse/validation/SX/` 经 `duckdb` 直查，`branch_code` 全 `SX`、行数/保费与山西原始 Excel 误差 ≤ 万分之一。
- 全程 `git status` 确认 `warehouse/fact/policy/current/` 无 SX 文件。

---

# 阶段一：branch-aware 管道（纯代码 + 合成单测，为 GATED 上线预备）

> 全部用合成临时文件单测，**不需要真实数据、不碰 current/**，worktree 内可完整验证。四川零差异天然成立（current/ 不变）。

## Task 1：重叠检测按省份分组（GATED 上线预备）

**Files:**
- Modify: `scripts/lib/parquet-overlap-check.mjs`（加 `parseBranchFromFilename` 导出 + `detectPolicyCurrentOverlap` 按省分组）
- Test: `scripts/__tests__/parquet-overlap-check.test.mjs`（**既有文件**，.mjs，追加用例）

**Step 1.1：写失败测试**（追加到既有 `describe('detectPolicyCurrentOverlap')` 内）
```javascript
  it('SC 裸名 + SX 前缀 同期 → 跨省不算重叠', () => {
    dir = makeDir([
      '20210101-20260617_01_签单清单_定稿.parquet',       // SC 裸名
      'SX_20210101-20260617_01_签单清单_定稿.parquet',    // SX 前缀
    ]);
    expect(detectPolicyCurrentOverlap(dir).count).toBe(0);
  });
  it('同省内真实重叠仍检出（SX 组内）', () => {
    dir = makeDir([
      'SX_20210101-20260617_01_签单清单_定稿.parquet',
      'SX_20250101-20260617_01_签单清单_定稿.parquet',
    ]);
    expect(detectPolicyCurrentOverlap(dir).count).toBeGreaterThan(0);
  });
```
并加 `parseBranchFromFilename` 用例（新 describe）：裸名→'SC'，`SX_*`→'SX'。

**Step 1.2：跑测试确认失败** — `bun run test --run scripts/__tests__/parquet-overlap-check.test.mjs`（跨省用例 FAIL：当前 count=1）

**Step 1.3：实现** — 导出 `parseBranchFromFilename`（紧跟 `parseDateRangeFromFilename`）：
```javascript
/** 文件名省份前缀（CHAR(2)）；无前缀＝四川裸名，回退 'SC' */
export function parseBranchFromFilename(filename) {
  const m = filename.match(/^([A-Z]{2})_/);
  return m ? m[1] : 'SC';
}
```
`detectPolicyCurrentOverlap` 内（读 52-67 现状后）：构建 `parquetFiles` 后按 `parseBranchFromFilename(f.name)` 分组，组内沿用原双重循环（保留 `isComplementaryPair` 豁免）。**既有用例全为裸名→同属 'SC' 组→行为不变，向后兼容。**

**Step 1.4：跑全量该测试文件确认通过（含既有用例不回退）** — `bun run test --run scripts/__tests__/parquet-overlap-check.test.mjs`

**Step 1.5：登记现存缺陷**（评审④：注释声称"孤立限摩必报错"但无实现）— `bun scripts/backlog.mjs add ...`（P3 Bug）

**Step 1.6：提交** — `git commit -m "fix(governance): 重叠检测按省份分组（GATED 上线预备，跨省同期不误报）"`（带 trailer）

## Task 2：quick_reference 分片数 branch-aware（保 SC 整数兼容）

**round-2 N1.4 教训**：parser（`quick_reference.mjs:79-86`）/ governance #15（`check-governance.mjs:1163`）/ 既有测试（`quick_reference.test.mjs:14-22`）都只认整数 `shardCount`。

**做法**：**只在 current/ 出现 >1 个省时**才输出按省明细；**单省（含 0a 期 SC-only）保持原整数格式**——三处消费方零改动。先读三处现状，写测试固定"SC-only 输出整数不变 + 双省输出明细"，再改。

**Files:** `数据管理/pipelines/quick_reference.mjs` + 可能 `check-governance.mjs` #15（仅多省分支）+ `数据管理/pipelines/quick_reference.test.mjs`。
**验证**：既有 quick_reference 测试不回退；`bun run governance` #15 在 SC-only 下绿。提交带 trailer。

## Task 3：daily.mjs `BRANCH_CODE` + 隔离输出根（SX 永不进 current/）

**目标**：`BRANCH_CODE=SX node 数据管理/daily.mjs premium` 从 `staging/SX/` 读源、注入 `branch_code=SX`、**输出到 `warehouse/validation/SX/`**（隔离，非 current/）。**`BRANCH_CODE=SC`（默认）逐字节同现状**（读根目录、写 current/）。

**Files:** `数据管理/daily.mjs`（premium 函数：源目录、输出根）；纯函数 `数据管理/lib/branch-naming.mjs`。Test: `tests/branch-naming.test.ts`。

**Step 3.1：纯函数 + 测试**
```javascript
/** 当前省源 staging 目录：SC＝根（现状），其余＝staging/<省>/ */
export function branchSourceDir(rootDir, branchCode) {
  return (!branchCode || branchCode === 'SC') ? rootDir : `${rootDir}/staging/${branchCode}`;
}
/** 当前省输出根：SC＝warehouse/fact/policy/current（现状），其余＝warehouse/validation/<省>（隔离，不进 current/） */
export function branchOutputRoot(warehouseDir, branchCode) {
  return (!branchCode || branchCode === 'SC')
    ? `${warehouseDir}/fact/policy/current`
    : `${warehouseDir}/validation/${branchCode}`;
}
```
测试：SC→根/current；SX→staging/SX、validation/SX。

**Step 3.2：读 daily.mjs premium 的源 glob 目录 + 输出路径构建**（`grep -n "scriptDir\|WAREHOUSE\|current\|outputName" 数据管理/daily.mjs`），定位确切行。

**Step 3.3：接入**（premium 函数顶部 `const BRANCH_CODE = process.env.BRANCH_CODE || 'SC';`）：源目录用 `branchSourceDir`，输出根用 `branchOutputRoot`。**SX 源文件用普通命名**（无前缀），故 `shard-classify` 不改。

> ⚠️ 逐处 Read 后改；每改一处跑 `BRANCH_CODE=SC` 确认四川输出不变。**强制护栏**：SX 路径下若计算出的输出根包含 `policy/current` 则 `throw`（防回归到 D5 矛盾）。

**Step 3.4：SC 零差异闸 + SX 隔离闸** — `BRANCH_CODE=SC ... premium` 后 current/ 文件名/数量不变；`BRANCH_CODE=SX ... premium`（阶段二跑）后 `git status` 确认 current/ 无新增。提交带 trailer。

## Task 4：sync-vps 纵深防御（0a 期默认不推非 SC）

**主护栏是 SX 不在 current/**（Task 3）；本任务是第二道：sync-vps 若发现 `current/` 出现非 SC 前缀文件（未来 GATED 误操作）→ 默认拒绝，需 `--allow-branch <省>` 显式放行。读 `scripts/sync-vps.mjs:368/595` 现状后加守卫 + `--dry-run` 验证默认计划只含 SC。提交带 trailer。

## Task 5（仅登记）：GATED 上线前置的命名库扩展

登记 BACKLOG（不在 0a 实现）：GATED 上线（SX 进 current/）前需统一 branch-aware：`shard-classify.mjs:extractDateRange/getShardType`、`daily.mjs:extractBatchDateFromName`、`data.ts:367` web 上传归档正则——届时 current/ 多省共存才需要。0a 因 current/ SC-only 不触发。

---

# 阶段二：山西 premium ETL 隔离验证（落 validation/SX，绝不进 current/）

> ⚠️ 本阶段需真实 SX 源 + Python 环境 + 数据。**worktree 无数据**，建议在主目录（带数据）跑；worktree 内只做命令准备与脚本审阅。

## Task 6：山西源落位 staging/SX（普通命名）

`mkdir -p 数据管理/staging/SX`；确认 `.gitignore` 覆盖 `数据管理/staging/`。先用 pandas/duckdb 读源真实 MIN/MAX 签单日期，按真实区间用**普通命名**（无 SX_ 前缀）落位（`<min>-<max>_01_签单清单_定稿.xlsx` 等）。日期以实测为准（红线：文件名-数据日期偏移）。

## Task 7：SX premium ETL → validation/SX + 口径对账

**Step 7.1** `BRANCH_CODE=SX node 数据管理/daily.mjs premium`（Task 3 后输出自动落 `warehouse/validation/SX/`）。**先 `git status` 基线**，跑完再 `git status` 确认 `policy/current/` 无任何新增/改动。
**Step 7.2** `duckdb -c "SELECT DISTINCT branch_code FROM '数据管理/warehouse/validation/SX/*.parquet'"` → 仅 `SX`。
**Step 7.3** `duckdb` 直查行数/保费 vs 山西原始 Excel，误差 ≤ 万分之一；字段枚举（客户类别/险类/风险等级）与 SC 对比记入 `口径对齐_山西.md` 供业务签字。
**Step 7.4** 提交脚本/记录（**不提交数据**）。

> **非 premium 域（理赔/报价/厂牌/维修）的 SX 隔离验证 = G4**：评审证实仅 `transform.py` 注入 branch_code，其余 ETL（quote_etl/convert_*）未注入。**剥离出 0a**，作为 GATED 上线前置单独任务。0a 只验证 premium。

---

# 阶段三：验证（证据闭环）

**Step V.1 单测 + governance（worktree 可跑）** — `bun run test --run`（阶段一新测全绿 + 既有不回退）；`bun run governance`（current/ SC-only，#13/#15 绿）；`bun run verify:full`。

**Step V.2 四川零差异（golden-baseline，须带数据环境）** — worktree 无数据跑不出意义；在**主目录**（带 `current/` 数据）于 **0a 改动前 commit** `--build` 抓基线（77 活跃端点）→ 改动后 `--compare`：
```bash
bun run dev:full   # 等 server ready 再跑（不要盲目 & 两次）
node scripts/golden-baseline.mjs --build    # 改动前 commit
# ...应用 0a 改动...
node scripts/golden-baseline.mjs --compare  # 期望零差异（current/ SC-only，本就不变）
```
0a 不动 current/，零差异本应天然成立；golden-baseline 是回归网，防管道改动意外触达加载路径。

**Step V.3 双省 governance 烟测（合成）** — 临时目录放"SC 裸名 + SX 前缀"分片跑 `detectPolicyCurrentOverlap`/quick_reference：不误报（已被 Task 1/2 单测覆盖，此为集成确认）。

**Step V.4 文档/索引** — ADR §9 勾 0a；`开发文档/00_index/` 加指针。**不在 DONE 改 `.claude/rules/data-pipeline.md`**（frozen，需 `[policy-override]`，round-2 N5.3）；改它单独向用户申请授权。

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| SX 误入 current/（D5 矛盾复发） | Task 3 硬护栏（SX 输出根含 current/ 即 throw）+ Task 7.1 前后 `git status` 双查 + Task 4 sync 守卫 |
| 管道改动误伤四川 | Task 3.4 `BRANCH_CODE=SC` 空跑 + V.2 golden-baseline（带数据环境） |
| 行号漂移替换错位 | 每处 Edit 前 Read |
| quick_reference 格式破坏 #15/parser | Task 2 单省保整数兼容，仅多省出明细 |
| 日期区间命名错 | Task 6 用源真实 MIN/MAX |

**回滚**：0a 全新增/旁路，current/ 零变更，不启用 RLS。回滚＝`git revert` 各 commit + 删 `warehouse/validation/SX/` + `staging/SX/`。

---

## 不在本计划范围（GATED 上线，按 Day-1 SOP）

- **G5 口径签字** → **`BRANCH_RLS_ENABLED=true`** → 命名库扩展（Task 5）→ SX 进 `current/` → sync-vps（`--allow-branch SX`）→ 发账号。RLS-on 下重跑 golden-baseline + `multi-branch-stress-test --simulate-sx` 证 SC 隔离。
- G3 维度省份化、G4 非 premium 派生域补 branch_code、G6 机构白名单、G7 SX 账号、G8 前端空态。
- 0b（物化层/内存收缩/真 Hive 子目录）、第 2 层（存算分离 / ClickHouse）。
