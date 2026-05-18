# Repair Network Quality Implementation Plan

**Goal:** 修订维修合作网络质量 P0 验证资产，使输出底表具备可信口径：拆清 shadow 与流程占位，统一维修金额口径，避免资源金额在赔案 JOIN 后被重复放大。

**Architecture:** 保持“文档先行 + Parquet 直读验证”路径。本阶段只修改 `docs/plans` 两份文档与 `scripts/chexian-verify-repair-network.py`，不新增 API、不改前端、不改现有 repair 页面。脚本直接加载 `RepairDim` 与 `ClaimsDetail`，输出整体、机构、4S、区县、风险网点、未登记影子、流程占位七类底表。

**Tech Stack:** Markdown、Python 3、DuckDB、Parquet、项目现有维修资源口径。

## Task 1: 修订设计文档

**Files:**
- Update: `docs/plans/2026-04-28-repair-network-quality-design.md`

**Steps:**
- 增加四类网点池定义：`repair_all`、`repair_base`、`process_excluded_shops`、`unregistered_shadow`。
- 明确 `repair_to_premium_ratio` 只做相对排序和异常识别，不做绝对经营判断。
- 明确维修承接金额使用 `settled_vehicle_amount`，`settled_amount` 仅作核对。
- 增加聚合安全规则：资源侧金额先独立聚合，赔案侧数量先独立聚合，最后合并。

## Task 2: 修订 P0 验证脚本

**Files:**
- Update: `scripts/chexian-verify-repair-network.py`

**Steps:**
- 构建 `repair_all`：RepairDim 全量登记网点，仅用于判断是否真正未登记。
- 构建 `repair_base`：剔除非维修/流程占位后的有效维修网点池，用于活跃率、修保比、本地承接。
- 构建 `process_excluded_shops`：已登记或赔案名称侧命中“定损/自选/无/无车损/外观定损/现场定损”等规则的流程占位/伪网点。
- 构建 `claim_shop_classification`：
  - `effective_registered`
  - `excluded_process_shop`
  - `registered_not_effective`
  - `unregistered_shadow`（未登记且未命中流程占位规则）
- 将影子网点金额改为 `vehicle_settled_amount = settled_vehicle_amount`。
- 输出未登记影子网点 TOP 与流程占位/伪网点 TOP 两张表。

## Task 3: 修复聚合放大风险

**Files:**
- Update: `scripts/chexian-verify-repair-network.py`

**Steps:**
- 机构质量排名中，资源侧 `damage_assessment_amount` / `net_premium` 先按机构聚合。
- 4S 对比中，资源侧 `damage_assessment_amount` / `net_premium` 先按 4S 类型聚合。
- 本地承接赔案数只在赔案 JOIN 聚合中计算。
- 最终表通过机构或 4S 类型合并资源聚合与赔案聚合，禁止在明细 JOIN 后直接汇总资源金额。

## Task 4: 增加回归断言

**Files:**
- Update: `scripts/chexian-verify-repair-network.py`

**Assertions:**
- 整体 `repair_base.total_net_premium` 必须等于各 4S 分组 `net_premium` 合计。
- 机构分组 `net_premium` 合计不得大于整体有效网点池净保费。
- `unregistered_shadow_claims + excluded_process_claims + effective_registered_claims` 不得超过 `claims_scope` 去重赔案数。
- 本地资源占比必须使用归一化后的区县名，raw 比较结果只作为诊断输出。

## Task 5: 验证闭环

**Run:**

```bash
python3 -m py_compile scripts/chexian-verify-repair-network.py
python3 scripts/chexian-verify-repair-network.py --window rolling12 --top-n 10
python3 scripts/chexian-verify-repair-network.py --window ytd --top-n 10
```

**Expected:**
- 三条命令均成功。
- rolling12 与 YTD 输出样本数存在差异。
- 输出包含“未登记影子网点 TOP”和“流程占位/伪网点 TOP”。
- 回归断言全部 PASS。

## Task 6: 一次性交付

**Files:**
- `docs/plans/2026-04-28-repair-network-quality-design.md`
- `docs/plans/2026-04-28-repair-network-quality-implementation-plan.md`
- `scripts/chexian-verify-repair-network.py`

**Steps:**
- 完成修订后统一查看 diff。
- 通过验证后一次性提交，不再按旧计划拆成文档、脚本、计划三个独立提交。

## Productization Boundary

- 本阶段不页面化。
- 后续如进入页面/API，优先复用现有：
  - `server/src/sql/repair.ts`
  - `server/src/routes/query/repair.ts`
  - `src/features/repair/*`
- 页面化前必须先把确认后的流程占位/伪网点清洗规则同步到业务规则字典和现有 repair SQL。
