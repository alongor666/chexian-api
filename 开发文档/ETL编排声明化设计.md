# ETL 编排声明化设计

> **时间**：2026-04-18 · **状态**：三阶段全部合并入 `main`
> **范围**：`数据管理/` 下 xlsx → parquet 管道
> **关联代码**：`数据管理/daily.mjs` · `数据管理/pipelines/base_converter.py` · `数据管理/data-sources.json`

---

## 1. 决策起点

### 1.1 原始问题

> xlsx→parquet 流程是否需要独立成独立项目？或外包给第三方 ETL 平台（dbt / Airflow / dlt 等）？

### 1.2 现状摸底（3 个并行 sub-agent 调研）

| 指标 | 现状 |
|------|------|
| 域数量 | 13 个（fact 8 + dim 5） |
| 编排层 | `daily.mjs` 999 行 |
| 转换层 | Python convert 脚本约 3.9k 行 |
| 最大源文件 | 624MB xlsx（`02_理赔明细`） |
| 跨层共享契约 | `fields.json`（42 字段）+ `data-sources.json`（数据域元数据） |

调研报告保留在 `.planning/etl-architecture-review/`：
- `A-orchestration-analysis.md` — 编排层设计分析
- `B-base-class-prototype.md` — 基类抽象原型
- `C-benchmark.py` — 性能基准脚本

### 1.3 决策结论：沿当前声明式路径渐进重构

**否决"独立成项目"**：违反单一事实源原则——`fields.json` / `data-sources.json` 已被后端、前端、ETL 三层共享，拆出去就必须跨仓库同步契约。

**否决"外包给 dbt/Airflow/dlt"**：
- 合规出局：金融数据不能出本地集群
- 规模太小：13 域、每日增量 < 200MB，第三方平台反而引入运维开销
- 强契约冲突：本项目的自动 schema 适配（`union_by_name=true`、`Schema Contract` 强拦截）与主流 ETL 平台的"显式声明列"模型语义不对齐

**选定路径**：C → B → A 三阶段渐进抽象，每阶段独立 PR + 独立验证。

---

## 2. 三阶段落地

| 阶段 | PR | 主要内容 | 量化结果 |
|------|----|----|------|
| **C** | [#204](https://github.com/alongor666/chexian-api/pull/204) ✅ | Excel 引擎切换 calamine | 27MB xlsx 12.36s → 2.14s（5.8x 加速） |
| **B** | [#205](https://github.com/alongor666/chexian-api/pull/205) ✅ | 抽出 `BaseConverter` + 5 个 convert 迁移 | 共减 280 行 boilerplate |
| **A** | [#206](https://github.com/alongor666/chexian-api/pull/206) ✅ | `daily.mjs` 编排声明化 | 999 → 798 行（-20%） |

### 2.1 C 阶段：Excel 引擎切换 calamine

**核心动作**：`pandas.read_excel(engine='calamine')` 替换默认 `openpyxl`。

**关键特性**：
- **Drop-in 替换**：一行代码改动，无需调整其他逻辑
- **dtype 行为 100% 等价**：字符串、数值、日期解析结果与 openpyxl 完全一致
- **代码位置**：`数据管理/pipelines/etl_validation.py` + `transform.py` 引入 `EXCEL_ENGINE='calamine'` 常量，替换 6 处 `pd.read_excel()`

**为何是 Drop-in**：`calamine` 是 Rust 实现的 Excel 读取库（通过 `python-calamine` 绑定），与 `openpyxl` 共用 `pandas` 的上层接口，只换底层实现。pandas 的 dtype inference 不受引擎影响。

**为何不做完整 benchmark**：Agent C 在 624MB xlsx 上跑 50 分钟未产出已经是最强论据——**过程数据本身就是结论**。27MB 文件上 5.8x 对比足以支撑决策。

### 2.2 B 阶段：BaseConverter 模板方法

**设计**：5 个 abstract method + 3 个可选 hook。

```
class BaseConverter:
    # abstract
    def load_source(self) -> DataFrame
    def get_cn_to_en_mapping(self) -> dict
    def transform(self, df) -> DataFrame
    def get_dedup_key(self) -> str | None    # 默认 None
    def get_required_non_null_cols(self) -> list[str]  # 默认 []

    # optional hooks
    def pre_write_hook(self, df)   # 写出前（如 customer_flow diff 计算）
    def post_write_hook(self, path) # 写出后（如 archive）
    def validate_output(self, df)  # 自定义校验
```

**迁移的 5 个 convert**：

| convert | 原行数 | 新行数 | 减少 |
|---------|-------|-------|------|
| `convert_cross_sell.py` | 145 | 80 | -45% |
| `convert_renewal.py` | 138 | 86 | -38% |
| `convert_repair.py` | 149 | 92 | -38% |
| `convert_brand_dim.py` | 135 | 84 | -38% |
| `convert_customer_flow.py` | 250 | 167 | -33% |

**关键设计决策**：
1. **`get_dedup_key()` 默认 None**：大多数 convert 不需要去重；需要时在子类 override
2. **`get_required_non_null_cols()` 与 dedup 解耦**：dedup key 可以为空（不去重），但非空校验是独立契约
3. **`pre_write_hook` 时机**：在 parquet 写出前，用于需要读历史 parquet 做 diff 的场景（`customer_flow` 的"新增/消失"判定需要对比上版快照）

**附带修复的 bug**：5 个 convert 之前**全部漏调** `update_data_sources()`，导致 `data-sources.json` 元数据长期停滞。基类在 `post_write_hook` 默认实现中统一调用 `update_data_sources()`，一次性修复。

### 2.3 B' 阶段：评估后保留独立的 3 个 convert

用户问"评估"后，诚实划分：

| convert | 保留独立 | 否决理由 |
|---------|---------|---------|
| `convert_quotes.py` | ✅ | 动态 `CN_TO_EN` 加载（从外部 JSON 读），与基类静态字典假设冲突 |
| `convert_claims_detail.py` | ✅ | 多文件合并 + `insurance_year` JOIN 复杂派生，走基类会产生更多特例代码 |
| `quote_etl.py` | ✅ | 跨文件合并 + 3 字段重命名（业务规则变更），已是高度定制 |

**原则**：抽象不是越多越好。强行抽象比保留独立更糟。
**否决信号**：动态 schema / 多文件合并 / 复杂派生 → 保留独立。

### 2.4 A 阶段：daily.mjs 编排声明化

**核心动作**：删除 6 个 `runXxx` 函数（每个 40-60 行），引入通用执行器 `runStandardDomain(python, scriptDir, manifest)`。

**Manifest schema**（在 `data-sources.json` 中以 `trigger` 子对象扩展）：

```jsonc
{
  "id": "cross_sell",
  "etl_script": "pipelines/convert_cross_sell.py",
  "output": "warehouse/fact/cross_sell/latest.parquet",
  "trigger": {
    "input_strategy": "multi_file_merge",   // single | multi_file_input | multi_file_merge
    "input_glob": "03_交叉销售_*.xlsx",
    "merge_dedup_key": "policy_no",
    "merge_order_by": "policy_date DESC NULLS LAST",
    "archive_prefix": "cross_sell_latest"
  }
}
```

**三种 input_strategy**：
1. **`single`**：一个 xlsx → 一个 parquet（brand / renewal_v2 / customer_flow）
2. **`multi_file_input`**：多 xlsx 整体传入 convert 脚本（quotes_conversion）
3. **`multi_file_merge`**：每 xlsx 单独转 parquet → `merge_parquet.py` dedup 合并（cross_sell / repair_resource）

**保留为具名函数**（业务复杂性不可声明化）：
- `runPremium` — 3 层分片状态机（static/weekly/daily），含续保匹配
- `runClaimsDetail` — 两步流水线（convert_claims_detail + claims_partition_manager）
- `runRenewalUniverse` — 诊断脚本派生，非 convert 模式

**附带修复的 bug**：
- `runRenewal` 原调 `updateDataSources('renewal_funnel')`（应为 `renewal_v2`）→ 新通用执行器由 `manifest.id` 驱动，bug 消失
- `field_count` 改从 parquet 实读（`getParquetColumnCount`），不再依赖 manifest 中可能过时的预期值（实测 brand: 5 → 15）

---

## 3. 元数据治理协议（P3a/P3b 落实 2026-04-18）

### 3.1 field_count / row_count 事实源

**唯一事实源**：parquet schema 自身。

**为何需要校准**：B 阶段前 5 个 convert 漏调 `update_data_sources()` 导致历史偏差累积。2026-04-18 全量校准：

| 域 | field_count 修正 | row_count 修正 |
|----|---|---|
| premium | 53 → 41 | — |
| claims_detail | 38 → 39 | — |
| quotes_conversion | 33 → 32 | — |
| renewal_funnel | 10 → 20 | 119,636 → 35,011 |
| brand | 5 → 15 | 37,810 → 371,359 |
| cross_sell | — | 403,709 → 164,928 |
| renewal_v2 | None → 10 | 新增 119,636 |

**工具**：`数据管理/pipelines/sync_data_sources_metadata.py`

```bash
# 仅对比差异
PYTHONPATH=数据管理 python3 数据管理/pipelines/sync_data_sources_metadata.py --dry-run

# 回写
PYTHONPATH=数据管理 python3 数据管理/pipelines/sync_data_sources_metadata.py
```

**设计要点**：
- 从 `data-sources.json:domains[*].output` 字段派生 parquet 路径，**不硬编码 glob 模式**
- `deprecated: true` 的域跳过（`quotes_v2` / `quotes_status`）
- 调用现有 `update_data_sources()` 函数，不重复实现

### 3.2 为何 merge_parquet.py 不调 update_data_sources

**评估结论**：维持现状，不在 `merge_parquet.py` 内部调用。

**理由**：
1. `merge_parquet.py` 是通用合并工具，不感知 `domain_id`（Unix 哲学：单一职责）
2. 编排层 `runStandardDomain`（`daily.mjs:336-338`）已在合并/转换完成后**从 parquet 实读** fieldCount/rowCount 并调 `updateDataSources(id, ...)`，不会漏
3. 独立调用 `merge_parquet.py`（调试场景）不应产生 `data-sources.json` 副作用
4. 未来新增 multi_file_merge 域，仅需改 manifest（`data-sources.json:trigger`），无需改合并工具

---

## 4. 累计代码变更

| 文件 | 变更 |
|------|------|
| `数据管理/pipelines/etl_validation.py` | +EXCEL_ENGINE 常量，替换 2 处 engine |
| `数据管理/pipelines/transform.py` | +EXCEL_ENGINE 常量，替换 4 处 engine |
| `数据管理/pipelines/base_converter.py` | **新增 192 行**（模板方法基类） |
| `数据管理/pipelines/convert_cross_sell.py` | 145 → 80 |
| `数据管理/pipelines/convert_renewal.py` | 138 → 86 |
| `数据管理/pipelines/convert_repair.py` | 149 → 92 |
| `数据管理/pipelines/convert_brand_dim.py` | 135 → 84 |
| `数据管理/pipelines/convert_customer_flow.py` | 250 → 167 |
| `数据管理/pipelines/merge_parquet.py` | +116 行（新增 dedup 模式） |
| `数据管理/pipelines/sync_data_sources_metadata.py` | **新增**（元数据校准工具） |
| `数据管理/data-sources.json` | 6 域新增 `trigger` 子对象 + 7 域 fc/rc 回写 |
| `数据管理/daily.mjs` | 999 → 798 行（删 6 个 runXxx + 8 对路径常量，新增通用执行器） |

**净减约 270 行代码，工程契约从分散文件收拢到 2 个核心 manifest（`fields.json` + `data-sources.json`）。**

---

## 5. 设计原则总结

| 原则 | 落地体现 |
|------|---------|
| **渐进不推倒** | C→B→A 每阶段独立 PR，没有一次性大重构 |
| **严格等价验证** | B/A 阶段都用 `DataFrame.equals()` 比对产出 parquet，不靠"应该没问题" |
| **不强行抽象** | 3 个 convert 评估后保留独立，抽象适配度否决信号明确 |
| **单一事实源** | `data-sources.json` 既是元数据注册表，也是 manifest 配置源；`fields.json` 驱动 3 个下游文件 codegen |
| **事实源实读** | row_count / field_count 一律从 parquet 实读，不依赖手写值 |
| **工具与编排分离** | `merge_parquet.py` 保持纯工具职责，副作用（元数据更新）由编排层统一承担 |

---

## 6. 待办与后续

| 优先级 | 事项 | 状态 |
|-------|------|-----|
| P1 | 观察一周生产 ETL 是否稳定（A 阶段 5 个未实测域走相同代码路径） | 用户待办 |
| P2 | 运行一次完整 `node 数据管理/daily.mjs all` 验证 multi_file_merge 串联 | 用户待办 |
| P3 | ✅ 校准 data-sources.json field_count / row_count | 2026-04-18 完成 |
| P3 | ✅ 评估 merge_parquet.py 元数据职责边界 | 2026-04-18 完成 |
| P4 | ✅ 本文档 | 2026-04-18 完成 |

---

## 附录：关联资源

- **三个 PR**：[#204 calamine](https://github.com/alongor666/chexian-api/pull/204) · [#205 BaseConverter](https://github.com/alongor666/chexian-api/pull/205) · [#206 声明化编排](https://github.com/alongor666/chexian-api/pull/206)
- **调研报告**：`.planning/etl-architecture-review/`（A/B/C）
- **会话沉淀**：`/Users/alongor666/Documents/人生修炼/02车险智慧分析系统/xlsx到parquet架构决策与三阶段声明式重构_20260418.md`
- **相关文档**：
  - `数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md` — 字段定义
  - `开发文档/TECHNICAL_DECISIONS.md` — 系统级技术决策
  - `.claude/rules/data-pipeline.md` — 数据管道规则
