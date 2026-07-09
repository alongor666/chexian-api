# B5 分省子目录 cutover 残留裸 glob 排查（2026-07-08）

- **backlog uid**：`2026-07-08-claude-170419`（P2 · 数据/ETL）
- **关联**：PR #987 / #988（B5 cutover 收尾）· 省份隔离红线 `.claude/rules/data-pipeline.md`
- **结论（一句话）**：**cutover-遗留轴零 live 残留** —— 全仓保单直查点已 100% 收编到共享 helper `policy_current_glob`（双布局自适应），无任何硬编码扁平 glob 会在子目录 cutover 后读 0 行。

---

## 1. 背景

B5 cutover 把 `warehouse/fact/policy/current/` 从**扁平布局**（顶层 `*.parquet`，省份靠文件名前缀区分）迁移为**分省子目录布局**（`current/SC/`、`current/SX/`）。迁移后，任何硬编码的扁平 glob 字符串 `current/*.parquet` 会匹配到 0 个文件（DuckDB 直接 `IO Error: No files found`，fail-loud），或在并存态混省。本卡系统性排查全仓是否有残留裸 glob，确认统一收编到共享 helper。

## 2. 双轴隔离模型（判定基准）

省份隔离沿两条独立的轴：

| 轴 | 机制 | 本卡关注 |
|----|------|---------|
| **布局轴（cutover 遗留）** | 扁平 `current/*.parquet` 在子目录 cutover 后读 0 行 / 混省。收编到 `policy_current_glob` 双布局自适应 helper 即安全 | ✅ **本卡主轴** |
| **省份轴（预存多省债）** | `branch=None` 取全省，唯一权威隔离键 = SQL 里的 `WHERE branch_code = ?`。文件名 glob / 子目录仅性能辅助 | 属 `project_multiprovince_hardcode_debt`，见 §6 follow-up |

判定 live 混省点的正确标准**不是"是否裸 glob"**，而是"是否在多省 warehouse 上跑、且未经 helper 收编（布局轴）/ 未带 branch_code 过滤（省份轴）"。

## 3. grep 全仓分类清单

grep 模式：`current/*.parquet`、`[!S]*.parquet`、`SX_*.parquet`、`sichuan_*`、`[0-9]*.parquet`、全部 `read_parquet(...current...)` 直查点，范围 `数据管理/`、`scripts/`、`server/`。

### 3.1 LIVE-executable（真跑 duckdb/read）—— 全部已收编 helper

| 消费者 | glob 来源 | 隔离 |
|--------|----------|------|
| `pipelines/diagnose_common.py`（`_PATHS["policy_glob"]`，被 ulr_*/transfer_*/moto/agent/segment/cohort 等全诊断族 import） | `policy_current_glob(current, "SC")` | SC 子目录 / 扁平 `[!S]*` |
| `pipelines/materialize_branch_code_special.py`、`convert_claims_detail.py`、`convert_new_energy_claims.py`、`ulr_triangle.py`、`diagnose_lng_tractor.py` 等 | `policy_current_glob(...)` | helper 自适应 |
| `integrations/wecom_smartsheet/sync_renewal_v2.py`（**live daily 引擎**） | `policy_current_glob` + `WHERE branch_code=?`（22 处）+ `assert_single_branch` 出口断言 | 双防线 · governance 闸 #52 盯 |
| `integrations/wecom_smartsheet/sync_filtered_policies.py`（**live daily 引擎**） | `policy_current_glob` + `assert_single_branch` 出口断言 | governance 闸 #52 盯 |
| `scripts/sync-vps.mjs`（fingerprint）、`scripts/prepublish-gate/lib/fetch-local-metrics.mjs` | Node helper `listPolicyCurrentShards` + `toDuckdbReadParquetList`（显式分片数组） | 双布局枚举 |
| `pipelines/renewal_common.py`（续保族）、`数据管理/scripts/accident_profile_report.py`、`数据管理/tools/analyze_flow.py` | `policy_current_glob(...)` | helper 自适应 |

**关键印证**：主仓 warehouse 已物理 cutover 为子目录布局（§5 证据1）。若任一 live 路径残留硬编码扁平 glob，daily ETL / 诊断 / 企微此刻即报 `IO Error`。PR #987/#988（2026-07-08 ETL 收尾）在该子目录 warehouse 上跑绿 → **动态运行绿 + 静态 grep 溯源双重印证零残留**。

### 3.2 非 bug（禁改 —— 注释 / 文档 / report 标注 / config / 测试 / 基础设施）

| 类别 | 命中示例 | 性质 |
|------|---------|------|
| 性能探针 | `scripts/perf/cube-build-prod-probe.ts:86` `POLICY_GLOB` 默认 `current/*.parquet` | **刻意手抄生产装载器 `duckdb-parquet-loader.ts`**（VPS 运行时每省单独部署=单省目录，裸 glob 在生产正确）；测内存/耗时不产业务口径，改它反偏离生产 |
| report 数据源标注 | `diagnose_segment.py:579`、`diagnose_lng_tractor.py:371`、`ulr_v1_maturity.py:355` `f"数据源：policy/current/*.parquet"` | 打印进报告的**说明文字**，非查询（禁止条款①）|
| config 写目标 | `data-sources.json` `output: current/*.parquet` | ETL **写**目标（写侧由 `POLICY_CURRENT_SUBDIR_LAYOUT` 开关落子目录），非读 glob（禁止条款②）|
| 隔离执行闸 | `scripts/check-governance.mjs:1162`（`[!S]*` 前缀隔离闸）、`scripts/lib/parquet-overlap-check.mjs`（并存态 fail-closed 检测） | **隔离基础设施本身**，非泄漏 |
| helper 实现 | `pipelines/branch_paths.py`、`scripts/lib/policy-current-shards.mjs` | SSOT helper 定义 |
| 测试 / fixture | `tests/pipelines/test_branch_paths.py`、`test_province_isolation.py`、`generate-ci-fixture.mjs`（99 开头合成号） | 测试断言 / 合成数据 |
| server 路径常量 | `server/src/config/paths.ts:30` `warehouseCurrent`、`policy-dedup.ts:17`（注释） | 目录常量 / 注释 |

## 4. 验证证据

### governance（54/54 全绿）
```
✓ 企微引擎/实例省份隔离检查通过（两引擎 policy 读均有 branch_code/断言 · v2 实例均声明省份）  ← 闸 #52
✓ 省份静默默认反模式：通过（扫描 162 个文件）                                              ← 无 ?? 'SC'
✓ 省份前缀映射一致（SC/SX，两源同步）
```
（闸 #1162 `[!S]*` 前缀隔离在 worktree 无 parquet 时 skip = success；其前提在子目录布局下由物理子目录路由承担，见 §5）

### pytest（34/34 passed）
`tests/pipelines/test_branch_paths.py` + `test_province_isolation.py` + `test_branch_isolation_v2.py`。

## 5. duckdb 隔离直查证据（主仓 warehouse，93 parquet）

主仓 `数据管理/warehouse/fact/policy/current/` 已是子目录布局（`SC/` + `SX/`，无顶层扁平 parquet）：

- **证据1（扁平失明）**：`read_parquet('current/*.parquet')` → `IO Error: No files found`（cutover 后硬编码扁平 glob 必然报错，非静默）
- **证据2（SC 纯净）**：`read_parquet('current/SC/*.parquet')` → `branch_code=SC` **2,633,380 行**，零 SX
- **证据3（SX 纯净）**：`read_parquet('current/SX/*.parquet')` → `branch_code=SX` **1,840,502 行**，零 SC
- **helper 路由**：`policy_current_glob(current, 'SC')` → `current/SC/*.parquet`；`(…, 'SX')` → `current/SX/*.parquet`；`(…, None)` → `current/[A-Z][A-Z]/*.parquet`（单层多省，非递归）

## 6. Follow-up（不在本卡强修，已登记）

### 6.1 branch=None 非 daily 手动工具的省份轴收窄
以下**非 daily 路由**的手动工具以 `branch=None` 调 helper（子目录布局下读 `current/[A-Z][A-Z]/*.parquet` = 全省），且无 `WHERE branch_code`：
- `integrations/wecom_bot/agent_diagnose_report.py`（经代/机构诊断报告，argparse 手动生成）
- `integrations/wecom_smartsheet/sync_may_renewal_fields.py`（电销续保表 update-only，按 `vehicle_frame_no` JOIN 限制混入）
- `数据管理/tools/analyze_flow.py`、`scripts/ad-hoc/*.py`（一次性分析脚本，部分 SC 意图）

均已**布局轴安全**（走 helper，cutover 后不读 0 行）。省份轴收窄需给每个工具加 `--province` fail-closed 解析（禁硬编码 "SC" 字面量，违 cutover 卡禁止条款③）——属 `project_multiprovince_hardcode_debt` 91 处审计范畴，独立 backlog 跟踪。

### 6.2 `sync_org_renewal_from_xlsx.py --wecom` exit-1
复核确认**不碰 policy/current glob**（`read_parquet` / `branch_code` 命中均为 0），是 webhook 登记表驱动的包装器；exit-1 = `--i-checked-wecom-rows` 门控下逐机构 webhook 部分失败的正常信号，**非本 glob bug**。独立 note 登记。

## 7. 关联 memory
`fact-current-mixes-sc-sx-bare-glob` · `wecom-renewal-engine-branch-isolation` · `project_multiprovince_hardcode_debt` · `feedback_audit_fix_scope_boundary`
</content>
</invoke>
