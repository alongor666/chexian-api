# 山西多省「生产数据就绪」Task A — evidence-loop 合同 + codex 闸-1 裁决

> backlog `2026-06-24-claude-9e5bac`（P1·非 GATED）· 分支 `claude/loop-mpdata` · GATED 后续 = Task B `2026-06-24-claude-533e57`（sync 生产，dispatch 标 gated）。
> 起草：Claude（loop-mpdata 会话）· codex 闸-1：codex-cli 0.141.0（read-only）判 **GO-with-fixes**，4 P1 + 4 P2 全采纳。

## 1. 合同（evidence-loop 六要素）

| 要素 | 内容 |
|------|------|
| **目标/边界** | 本地 warehouse 各**运行时消费**域物理补 per-row `branch_code`，使 `multiProvince=true` + `BRANCH_RLS_ENABLED=true` 时分公司管理员查所有 typed 路由 **0 个 5xx / 0 fail-close**。**边界**：只许新增 `branch_code` 列；不碰 sync-vps（Task B GATED）；不进 SX 到 `current/`。 |
| **基线/度量** | 各域现状 parquet（行数 + 非 branch 列 sha256 + schema）；当前 `multiProvince=false`（salesman 无 branch_code）；premium 已含 branch_code（2,600,421 行 SC）。 |
| **正确性 oracle** | ① **值级**字节安全（read_parquet 回读 · 非 branch 列名序+类型+逐行 sha256 全等 · branch_code 全 'SC'；证逻辑层值级不变，不声称 parquet 容器原始字节相等——重写必改压缩属预期）② RLS-on server 实测（分域断言 · 见 §4）③ multiProvince=true 启动日志 + DESCRIBE 四视图含 branch_code |
| **回归门禁** | `bun run verify:full` + `bun run governance`（44/44）·（代码改 = generate_dim_tables.py，从 worktree 跑） |
| **发布安全** | 本任务**不发布**（Task B GATED）。代码改 = ETL 生产者（非部署链）→ 可 auto-merge |
| **停止/回滚** | 任一域**非 branch 列字节变更** → 停（codex P2.4：写入脚本唯一模式 = 读旧 parquet + 仅追加列 + 写回 + oracle；**禁用域 ETL 重跑做物化**——重跑拉最新源会刷新业务数据，违反本条） |

## 2. 全域现状（duckdb 实证）与物化分工

| 域 | rows | policy_no | branch_code | 运行时消费 | 物化方式（codex 裁决） |
|---|---|---|---|---|---|
| premium(policy) | 2,600,421 | — | **YES** | PolicyFact 物理 | 已就绪（P1 #762） |
| salesman(dim) | 615 | 无 | NO | SalesmanDim 单源 `SELECT *`（**不补常量** → multiProvince 触发器） | **A1**：脚本改(durable) + in-place 加常量 'SC' |
| cross_sell | 420,899 | 100% 非空 610 | NO | CrossSellFact（loader 补常量） | 通用 backfill（prefix→SC，校验） |
| claims_detail | 288,198(8分区) | **100% 非空 610**（修正任务书"17行"错） | NO | ClaimsDetail union_by_name；RLS 经 PolicyFact JOIN（非硬需，生产就绪一致性） | 通用 backfill（逐分区 prefix→SC） |
| customer_flow | 188,340 | 100% 非空 610 | NO | 运行时 loadCustomerFlow 从 PolicyFact 派生（不读此 parquet）；**但 sync-vps + 企微续保同步直接消费**（codex P1.2） | 通用 backfill（生产就绪一致性） |
| quotes_conversion | 880,489 | 92.5% NULL | NO | QuoteConversion（loader 补常量）；**validation/SX 副本已 wire 为 extra → 本地已 SC+SX UNION** | 复用 `quote_etl.derive_branch_code(df,'SC')` warn 模式 |
| renewal_tracker | 128,016 | 无列（有 source/renewed_policy_no） | NO | RenewalTrackerFact；**validation/SX 副本已 wire** | 复用 `derive_renewal_tracker_branch_code(df,'SC')` |
| new_energy_claims | 901 | 100% NULL | NO | NewEnergyClaims（loader 补常量） | VIN→policy JOIN 校验全 SC（820/820 实证）→ 加常量 'SC'（不动 org_level_3） |

**跳过/不纳入**：plan/repair（dim）——派生视图 branch_code 取自 salesman 侧，multiProvince 由 salesman 单独触发，本任务不需（codex 未反对；登 follow-up）。

## 3. codex 闸-1 裁决（4 P1 + 4 P2 全采纳）

- **P1.1（验证设计）**：`resolveBranchFactExtras` 自动 wire `validation/SX/{quotes_conversion,renewal_tracker}` → 这两域本地已多省 UNION。**RLS 验证禁用"SX 全空"统一断言**；改分域：core/SC-only 域 SX 空，quotes/renewal SX 见 validation SX 数据（真跨省隔离测试）+ SC 不见 SX。
- **P1.2（customer_flow）**：非运行时孤儿——sync-vps + 企微续保同步消费。**纳入 backfill**（policy_no 100% 净，byte-safe，生产就绪一致）。
- **P1.3 + P2.4（A3 机制）**：禁盲常量、禁 ETL 重跑。A3 = 零刷新 + 域专用校验后加列（quotes/renewal 复用各域已合并 derive 函数；new_energy VIN-JOIN 预检全 SC 后加列、不回填 org_level_3）。
- **P1.4（oracle 增强）**：非 branch 列名**序**一致 + Arrow/DuckDB **类型**一致 + 逐文件 row_count + **逐行 ordered sha256** + claims_detail 逐分区出 hash/schema。
- **P2.1**：claims_detail backfill 前 `--dry-run` 留证（8 分区/288198 行/0 error）。
- **P2.2（salesman 一致性）**：不全脚本覆盖；做一次「`build_salesman_table` 产物 schema == 手工物化」对比证明（10 旧列同 + 末尾 branch_code + 615 行全 SC）。
- **P2.3（验证路由）**：补 DESCRIBE SalesmanDim/SalesmanTeamMapping/SalesmanPlanFact/achievement_cache 含 branch_code + 扫 premium-report salesman 路由无 Binder Error。

## 4. 验证（确定性闸）
1. 字节安全 oracle（per-domain per-file，增强版）。
2. `bun run verify:full` + `bun run governance`（44/44）— worktree。
3. RLS-on server（**主仓** `BRANCH_RLS_ENABLED=true bun run dev:full`）：
   - 启动日志 `multiProvince=true` + DESCRIBE 四视图含 branch_code。
   - 自签 SC/SX token（`scripts/multi-branch-stress-test.mjs` signServiceToken）扫 typed 路由：
     - **0 个 5xx / 0 fail-close**（核心目标）。
     - SC token：各域见 SC 数据、**不见 SX**。
     - SX token：core/SC-only 域空；quotes/renewal 见 validation SX 数据、**不见 SC**。
   - 扫 premium-report salesman 路由无 Binder Error。

## 6. 对抗闸-2 结果（codex CLI + evidence-verifier）

- **evidence-verifier（fresh-context·sonnet·独立证伪）→ CONFIRMED**：7 域 branch_code 全 SC/0 NULL/前缀一致；RLS SC token premium-plan/kpi/comprehensive 200 带数据、SX 空无串读；governance 44/44、python 26、branch-naming 11/11。无法推翻声明。
- **codex CLI 0.141.0（read-only·完成 diff）→ PARTIAL（1 P1 + 3 P2）**：
  - **P1（full_name 跨省串数）= 登记 follow-up，非 Task A 阻断**：`achievement_cache`/dim 兼容层 multiProvince 后仍按 `full_name` 单键去重/聚合/JOIN（duckdb-domain-loaders.ts），SC/SX 同名会串数。**Task A 是 SC-only**（validation/SX 无 dim/salesman，本地+生产 salesman 全 SC）→ 碰撞**不可能发生**。修复是 **SX salesman维度 GATED 上线硬前置**（backlog `2026-06-24-claude-43e39b`），不在 Task A 范围（R28：跨模块 multi-province RLS 正确性 = scope 蔓延让位）。
  - **P2.1（new_energy 逐行 VIN guard）= 已修**：加「源表 0 NULL/空 VIN」断言（防未来脏数据被常量静默标 SC；当前 901 行 0 NULL）。
  - **P2.2（oracle 值级 vs 原始字节）= 已修**：md5→sha256 + NULL 哨兵/列含 NULL 标记；docstring/产物 wording 全改「值级字节安全」（不声称 parquet 容器原始字节相等）。
  - **P2.3（缺文件假绿）= 已修**：materialize 缺文件默认 fail-fast + `--allow-missing` 显式容忍。
  - 修复后幂等重派生（--force）+ sha256 oracle verify：7 域非 branch 列值级逐行全等 + branch_code 全 SC。
- **evidence-verifier 补充（两入口/daily 集成）= 已澄清**：各域 ETL 已合并 branch_code 派生（P3-A~E + salesman generate_dim_tables）→ 下次 daily 自然产列；materialize 脚本是**存量一次性补列桥**，无需接入 daily.mjs（脚本 docstring 已注明）。

## 5. 交付物（PR）
- `数据管理/warehouse/dim/generate_dim_tables.py`（salesman branch_code='SC'）
- `数据管理/pipelines/materialize_branch_code_special.py`（quotes/renewal/new_energy/salesman 零刷新校验加列 + 内置 oracle，Task B/未来省可复用）
- `scripts/oracle_mpdata_byte_safety.py`（增强字节安全 oracle）
- 单测 + backlog 流转 + pr-evolution 三问复盘 + loop-quality-ledger 一行
- 数据是 gitignore → 不进 PR；物化是本地操作步，证据进 PR 描述。
