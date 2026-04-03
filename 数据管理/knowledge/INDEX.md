# 数据管理知识库 & 工具体系索引 (v2.0)

**最后更新**: 2026-03-31
**维护者**: @claude

---

## 快速导航

| 我想... | 用什么 | 命令 |
|---------|--------|------|
| 更新每日数据 | daily.mjs | `node 数据管理/daily.mjs` |
| 强制更新赔付数据 | daily.mjs claims | `node 数据管理/daily.mjs claims` |
| 强制更新报价数据 | daily.mjs quotes | `node 数据管理/daily.mjs quotes` |
| 全量更新（保费+赔付+报价） | daily.mjs all | `node 数据管理/daily.mjs all` |
| 同步数据到 VPS | sync-vps.mjs | `node scripts/sync-vps.mjs` |
| 诊断某类车型/客户 | diagnose_vehicle.py | `python3 数据管理/pipelines/diagnose_vehicle.py --filter "..."` |
| 诊断某经代公司 | diagnose_agent.py | `python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"` |
| 生成维度表 | generate_dim_tables.py | `cd 数据管理 && python3 warehouse/dim/generate_dim_tables.py` |
| 生成业务员映射 | generate_salesman_mapping.py | `cd 数据管理/warehouse/dim/业务员归属与规划 && python3 generate_salesman_mapping.py` |
| 合并 Parquet 文件 | merge_parquet.py | `python3 数据管理/pipelines/merge_parquet.py f1.parquet f2.parquet out.parquet` |
| 对比两版 Excel | compare_excel.py | `python3 数据管理/pipelines/compare_excel.py` |
| 生成驾意险推介率日报 | daily_report_jiayi.py | `python3 数据管理/驾意险推介率/脚本/daily_report_jiayi.py` |
| 计算已赚保费（月末） | earned_premium_monthly.py | `python3 数据管理/pipelines/已赚保费/earned_premium_monthly.py` |
| 运行率值治理测试 | test_rate_governance.py | `pytest 数据管理/pipelines/test_rate_governance.py -v` |
| 验证交叉销售口径 | verify-cross-sell.py | `python3 scripts/verify-cross-sell.py --date 2026-03-28` |
| 查阅字段值域 | PARQUET_SCHEMA_KNOWLEDGE.md | 见下方知识库索引 |
| 查阅业务规则 | 车险数据业务规则字典.md | 见下方知识库索引 |
| 查阅数据流变换 | DATA_FLOW_KNOWLEDGE.md | 见下方知识库索引 |
| 查阅 ETL 管道规则 | ETL_PIPELINE_KNOWLEDGE.md | 见下方知识库索引 |

---

## 1. 知识库文件索引

| 文件 | 用途 | 读者 |
|------|------|------|
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | 核心字段速查（~200 tokens） | AI / 开发者 |
| [ai/PARQUET_SCHEMA_KNOWLEDGE.md](./ai/PARQUET_SCHEMA_KNOWLEDGE.md) | 完整字段值域 + NL2SQL 映射 | AI SQL 生成器 |
| [ai/DATA_FLOW_KNOWLEDGE.md](./ai/DATA_FLOW_KNOWLEDGE.md) | 数据流字段变换 + JOIN 关系 + Gotcha | 开发者 / AI |
| [ai/ETL_PIPELINE_KNOWLEDGE.md](./ai/ETL_PIPELINE_KNOWLEDGE.md) | ETL 管道规则：分片架构 + 字段变换 + 源数据差异 | 开发者 / AI |
| [ai/BRAND_KNOWLEDGE.md](./ai/BRAND_KNOWLEDGE.md) | 品牌维度表：厂牌车型→品牌_用途复合维度映射（如"长安_客车"） | AI 诊断工具 |
| [rules/车险数据业务规则字典.md](./rules/车险数据业务规则字典.md) | 唯一事实源：字段定义 + 业务规则 | 全员必读 |
| [schema/schema-analysis.json](./schema/schema-analysis.json) | Parquet 字段统计（自动生成） | 工具 |
| [../data-sources.json](../data-sources.json) | 数据域元数据注册表（9 域，ETL 自动更新 last_updated/row_count） | ETL / AI |

---

## 2. 数据架构概览

### 2.1 warehouse/ 目录结构

```
warehouse/
├── fact/
│   ├── policy/
│   │   ├── current/                          ← 服务端加载此目录（4 个分片）
│   │   │   ├── 每日数据_20200101_20211231.parquet   18MB  静态分片
│   │   │   ├── 每日数据_20220101_20230630.parquet   28MB  静态分片
│   │   │   ├── 每日数据_20230701_20241130.parquet   27MB  静态分片
│   │   │   └── 每日数据_20241201_20260328.parquet   35MB  热分片（周更）
│   │   ├── staging/                          ← 日增量暂存（不同步 VPS）
│   │   ├── cache/                            ← Parquet 缓存
│   │   └── archive/                          ← 历史版本归档
│   ├── claims/
│   │   └── latest.parquet                    9.7MB  赔付+费用（全量替换）
│   ├── quotes/
│   │   └── latest.parquet                    588KB  报价状态（全量替换）
│   ├── quotes_conversion/
│   │   └── latest.parquet                    15MB   报价转化率（独立分析）
│   └── renewal/
│       └── renewal_funnel_2026q1.parquet     1.1MB  续保漏斗
├── dim/
│   ├── salesman/
│   │   └── latest.parquet                    18KB   业务员主数据（296人）
│   ├── plan/
│   │   └── latest.parquet                    29KB   保费计划（2025+2026）
│   ├── generate_dim_tables.py                       维度表生成脚本
│   ├── dim_summary.json                             维度表统计摘要
│   └── 业务员归属与规划/
│       ├── salesman_organization_mapping.json 124KB 业务员-团队-机构映射
│       ├── generate_salesman_mapping.py             映射生成脚本
│       └── README.md
└── vps-export/
    ├── aggregated.parquet                    3.1MB  VPS 预聚合（旧架构产物）
    ├── cross_sell_agg.parquet                2.1MB  交叉销售聚合
    └── renewal_agg.parquet                   307B   续保聚合
```

### 2.2 三层分片架构

由 `shard-config.json` 控制：

| 分片类型 | 条件 | 策略 |
|---------|------|------|
| **static** | 签单结束日 ≤ 2024-11-30 | 一次性转换，永不重建 |
| **weekly** | 签单开始日 = 2024-12-01 | 每次强制重建（含续保匹配），旧版归档 |
| **daily** | 单日增量 | mtime 缓存判断，输出到 staging/ |

---

## 3. 数据处理流程

```
原始 Excel（每日数据_*.xlsx）
    │
    ▼ node 数据管理/daily.mjs
    │  ├─ 读取 shard-config.json 分类文件
    │  ├─ static: 存在→跳过，不存在→transform.py
    │  ├─ weekly: 归档旧版→transform.py -r 续保源
    │  └─ daily:  mtime过期→transform.py→staging/
    │
    ▼ pipelines/transform.py（14 步流水线）
    │  1. 读取 Excel（多 sheet 自动合并）
    │  2. 续保类型匹配（-r 参数）
    │  3. 保单号/车架号标准化
    │  4. 数据质量报告
    │  5. 保费字段重命名
    │  6. 续保状态处理
    │  7. 险别组合重命名
    │  8. 是否可续判定
    │  9. 电销标识判定
    │  9.5 新字段处理（赔付/费用/风险等级/交叉销售/保额）
    │  9.8 admin 账号拆分
    │  10. 日期标准化（缴费日期→签单日期，原签单日期→提核日期）
    │  10.5 增量过滤
    │  11. 去重策略
    │  12. 按域选择输出字段
    │  13. 最终质量检查
    │  14. 写入 Parquet
    │
    ▼ 产出
    │  policy/current/*.parquet  （保单分片）
    │  claims/latest.parquet     （赔付+费用，--domain claims）
    │  quotes/latest.parquet     （报价状态，--domain quotes 或 convert_quotes.py）
    │
    ▼ node scripts/sync-vps.mjs
    │  rsync policy/current/ + dim/ + renewal/ → VPS
    │  PM2 重启 + 健康检查
    │
    ▼ VPS: server/src/services/duckdb.ts
       loadMultipleParquet()     → raw_parquet 视图（UNION ALL 多分片）
       createPolicyFactView()    → PolicyFact 视图（中文→英文字段映射）
       materializePolicyFactWorkingSet() → PolicyFactRealtime 物化表（3 索引）
       loadDimParquet()          → SalesmanDim + PlanFact + SalesmanTeamMapping
       buildAchievementView()    → achievement_cache（三部分聚合）
       createCrossSellRealtimeView() → CrossSellDailyAgg（分批物化）
       loadRenewalFunnel()       → RenewalFunnel 视图
       loadQuoteConversion()     → QuoteConversion 视图
```

---

## 4. ETL 工具链

### 4.1 daily.mjs — 主 ETL 入口

**路径**: `数据管理/daily.mjs`
**状态**: 现役（每日/每周运行）

```bash
node 数据管理/daily.mjs              # 默认：premium 分片
node 数据管理/daily.mjs claims       # 赔付域全量替换
node 数据管理/daily.mjs quotes       # 报价域全量替换
node 数据管理/daily.mjs all          # premium + claims + quotes
node 数据管理/daily.mjs --no-sync    # 跳过 VPS 同步
```

| 输入 | 输出 |
|------|------|
| `每日数据_*.xlsx`（源数据） | `warehouse/fact/policy/current/*.parquet` |
| `续保类型匹配*.xlsx`（可选） | `warehouse/fact/claims/latest.parquet` |
| `商业险续转保报价*.xlsx`（可选） | `warehouse/fact/quotes/latest.parquet` |
| `shard-config.json`（分片配置） | |

调用链: `daily.mjs` → `transform.py` / `convert_quotes.py` → `sync-vps.mjs`

### 4.2 pipelines/transform.py — Excel→Parquet 核心转换

**路径**: `数据管理/pipelines/transform.py`（~1024 行）
**状态**: 核心现役

```bash
python3 数据管理/pipelines/transform.py -i input.xlsx -o output.parquet
python3 数据管理/pipelines/transform.py -i input.xlsx -o output.parquet -r 续保源.xlsx
python3 数据管理/pipelines/transform.py -i input.xlsx -o output.parquet --domain claims
```

| 参数 | 说明 |
|------|------|
| `-i` | 输入 Excel |
| `-o` | 输出 Parquet |
| `-r` | 续保源 Excel（按保单号匹配续保业务类型） |
| `--domain` | 输出域：policy（默认）/ claims / quotes / all |
| `--after-date` | 增量截止日期 |

**域输出字段**:
- **policy**：23 核心 + 19 可选 = 最多 42 字段（含经代名、客户源等原始字段）
- **claims**：保单号、车架号、赔案件数、已报告赔款、费用金额（按保单号 SUM 聚合）
- **quotes**：续保单号、签单日期（仅 `是否报价=True`）

### 4.3 pipelines/convert_quotes.py — 独立报价文件转换

**路径**: `数据管理/pipelines/convert_quotes.py`
**状态**: 现役（被 daily.mjs 调用）

输入: `商业险续转保报价*.xlsx`（独立报价数据，字段结构与主数据不同）
输出: `warehouse/fact/quotes/latest.parquet`

### 4.4 pipelines/quote_etl.py — 报价转化率 ETL

**路径**: `数据管理/pipelines/quote_etl.py`
**状态**: 独立分析工具（不在 daily.mjs 主流程中）

输入: `旧车商业险报价*.xlsx` + `dim/salesman/latest.parquet`
输出: `warehouse/fact/quotes_conversion/latest.parquet`

### 4.5 pipelines/enrich.py — 续保匹配

**路径**: `数据管理/pipelines/enrich.py`
**状态**: 功能已内化进 transform.py 的 `-r` 参数，保留独立使用

### 4.6 pipelines/merge_parquet.py — Parquet 合并

**路径**: `数据管理/pipelines/merge_parquet.py`
**状态**: 独立维护工具

```bash
python3 数据管理/pipelines/merge_parquet.py f1.parquet f2.parquet output.parquet
```

pyarrow columnar concat，自动推断兼容类型。

### 4.7 pipelines/compare_excel.py — Excel 对比

**路径**: `数据管理/pipelines/compare_excel.py`（~500 行）
**状态**: 独立验证工具

输出: `output/` 下的 HTML + Excel 差异报告

### 4.8 scripts/sync-vps.mjs — VPS 数据同步

**路径**: `scripts/sync-vps.mjs`
**状态**: 现役（被 daily.mjs 自动调用）

```bash
node scripts/sync-vps.mjs               # 标准同步+重启
node scripts/sync-vps.mjs --check       # 预检文件清单
node scripts/sync-vps.mjs --dry-run     # 仅打印计划
node scripts/sync-vps.mjs --no-restart  # 同步但不重启
```

同步目录:
| 本地 | VPS |
|------|-----|
| `warehouse/fact/policy/current/` | `server/data/current/` |
| `warehouse/dim/salesman/` | `server/data/dim/salesman/` |
| `warehouse/dim/plan/` | `server/data/dim/plan/` |
| `warehouse/fact/renewal/` | `server/data/fact/renewal/`（存在时） |

---

## 5. 诊断工具体系

### 5.1 diagnose_vehicle.py — 车型/客户类别诊断（v4.1）

**路径**: `数据管理/pipelines/diagnose_vehicle.py`
**数据连接**: 内存 DuckDB 直读 `policy/current/*.parquet`（绕过 PolicyFact 视图）

```bash
# 诊断营业货车
python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'"

# 诊断牵引车（仅板块 1,5,9）
python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'" --sections 1,5,9

# 跳过风险评分和能源板块
python3 数据管理/pipelines/diagnose_vehicle.py --filter "..." --skip 3,4
```

| 参数 | 说明 |
|------|------|
| `--filter` | **必选**，SQL WHERE 条件 |
| `--title` | 报告标题（默认用 filter 条件） |
| `--years` | 年份范围，如 `2022-2026` |
| `--compare` | `ytd`（同期对比）/ `full`（全年对比） |
| `--sections` | 仅运行指定板块，如 `1,5,9`（与 --skip 互斥） |
| `--skip` | 跳过指定板块（与 --sections 互斥） |
| `--no-summary` | 跳过板块 9 |

**9 个可插拔板块**（`sections/`）:

| 板块 | 文件 | 内容 |
|------|------|------|
| 1 | s01_overview.py | 整体经营概况（全量 KPI 按年展开） |
| 2 | s02_vehicle_type.py | 新转续过户维度（新车/续保/转保/过户分项） |
| 3 | s03_energy.py | 能源类型（燃油/新能源） |
| 4 | s04_risk_grade.py | 风险评分（智能检测字段，动态获取等级） |
| 5 | s05_quarter.py | 季度趋势（最近 24 季度 + 7 个 ASCII 条形图） |
| 6 | s06_insurance_type.py | 险类（商业/交强分项年度表） |
| 7 | s07_combo.py | 险别组合（动态获取所有组合） |
| 8 | s08_customer.py | 客户类别（各类别分项 + 货车吨位子板块） |
| 9 | s09_summary.py | 诊断总结（亮灯 + 关键发现 + 建议） |

输出: `数据分析报告/{title}_经营诊断_{years}_截至{max_date}.md`

### 5.2 diagnose_agent.py — 经代公司诊断（v1.0）

**路径**: `数据管理/pipelines/diagnose_agent.py`（753 行）
**数据连接**: 内存 DuckDB 直读 `policy/current/*.parquet`（`经代名` 字段未进 PolicyFact）

```bash
python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"
python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "诚安达" --precise-earned
```

| 参数 | 说明 |
|------|------|
| `--org` | **必选**，三级机构名称 |
| `--agent` | **必选**，经代名（模糊匹配） |
| `--years` | 年份列表（多年），如 `2025 2026` |
| `--precise-earned` | 精确已赚保费（含首日费用拆分） |

**10 维度分析**:

| 序号 | 维度 | 内容 |
|------|------|------|
| 1 | 核心 KPI | 分年：保费/满期保费/赔款/费用率/赔付率/变动成本率/边际贡献率/续保率/驾意保费/出险率 |
| 2 | 险类 | 商业险/交强险：件数/保费/赔付率/费用率 |
| 3 | 客户类别 | 分类保费 + 续保率 |
| 4 | 险别组合 | 各组合件数/保费/占比 |
| 5 | 月度趋势 | 月度保费/满期保费/赔付率/费用率/赔案件数 |
| 6 | 业务员 | 件数/保费/件均/续保率/驾意保费 |
| 7 | 商车系数 | 均值/中位数/最低/最高/低系数占比 |
| 8 | 对标 | 经代 vs 机构整体（赔付率/费用率/变动成本率） |
| 9 | 损失暴露 | 出险率/案均赔款/赔案件数 |
| 10 | 驾乘险 | 推介率/渗透率/驾乘保费/件均 |

### 5.3 公共模块

| 文件 | 用途 |
|------|------|
| `diagnose_common.py` | 路径常量、满期保费公式（闰年感知）、四级亮灯函数、KPI SELECT 公式、率值聚合（A/B 类治理）、阈值常量 |
| `diagnose_context.py` | `RunContext` 数据类（板块间共享：DuckDB 连接、WHERE 条件、年份、风险字段等） |
| `diagnose_report.py` | `Report` 类：年度表、维度汇总表、季度表、ASCII 条形图、趋势分析文字 |
| `test_rate_governance.py` | 率值治理防回归测试（A 类/B 类/推介率，pytest） |

**四级亮灯阈值**（`diagnose_common.py` TH_* 常量）:

| 指标 | 关注 🔵 | 预警 🟡 | 危险 🔴 |
|------|--------|--------|--------|
| 变动成本率 | 85% | 91% | 94% |
| 边际贡献率 | 15% | 9% | 6% |
| 满期赔付率 | 60% | 70% | 75% |
| 满期出险率 | 8% | 10% | 12% |
| 案均赔款-货车 | 8,000 | 10,000 | 12,000 |

---

## 6. 维度表生成

### 6.1 generate_dim_tables.py

**路径**: `数据管理/warehouse/dim/generate_dim_tables.py`

```bash
cd 数据管理 && python3 warehouse/dim/generate_dim_tables.py
```

| 输入 | 用途 |
|------|------|
| `2025年分产品保费计划达成情况（0105）.xlsx` | 2025 年业务员计划+实际 |
| `川分销售人员名单__3月12日更新.xlsx` | 业务员基础信息 |
| `四川分公司机构业务日报（截止2026年3月23日）.xlsx` | 2026 年机构计划 |
| `salesman_organization_mapping.json` | 2026 年业务员计划 |

| 输出 | 说明 |
|------|------|
| `dim/salesman/latest.parquet` | 业务员主数据（296 人，含编号/姓名/团队/机构/岗位/状态/入离职） |
| `dim/plan/latest.parquet` | 多年多层级计划（2025 业务员 + 2026 业务员 + 2026 机构 = 484 行） |
| `dim/dim_summary.json` | 统计摘要 |

### 6.2 generate_salesman_mapping.py

**路径**: `数据管理/warehouse/dim/业务员归属与规划/generate_salesman_mapping.py`

前置步骤，生成 `salesman_organization_mapping.json`，被 `generate_dim_tables.py` 读取。

---

## 7. 分析报告工具

### 7.1 驾意险推介率日报

**路径**: `数据管理/驾意险推介率/脚本/daily_report_jiayi.py`
**状态**: 现役（每日运行）

读取最近 14 天 Parquet → 生成 Markdown 日报 + CSV 数据 + 飞书卡片 JSON

辅助: `split_data_by_org.py`（按机构拆分到 `机构数据/` CSV）

### 7.2 已赚保费月末计算

**路径**: `数据管理/pipelines/已赚保费/earned_premium_monthly.py`
**口径**: 监管 1/365，一年封顶，首日费用拆分（交强 0.82，商业 0.94）

---

## 8. 废弃清单

| 文件/目录 | 废弃原因 | 替代方案 |
|-----------|---------|---------|
| `run.mjs` | 第 2 行输出废弃警告 | `daily.mjs` |
| `archive/legacy-scripts/daily.sh` | bash 版 ETL | `daily.mjs` |
| `archive/legacy-scripts/sync-data.sh` | bash 版同步 | `scripts/sync-vps.mjs` |
| 旧 CLI 工具目录（data_tools/ 等） | 已删除，INDEX.md v1.0 遗留引用 | `pipelines/` 下实际脚本 |
| `cli.py` TOOL_REGISTRY | 注册表指向不存在的模块 | 直接调用 pipelines/ 下脚本 |

---

## 9. 服务端 DuckDB 视图/表全景

```
raw_parquet (VIEW)
    ↓ 列名映射（中文→英文）
PolicyFact (VIEW) → PolicyFactRealtime (TABLE，物化)
PolicyFactRenewal (VIEW → PolicyFact)
    │
    ├─→ CrossSellDailyAgg (TABLE，分批物化，19 维度 GROUP BY)
    ├─→ achievement_cache (TABLE，3 部分 UNION ALL)
    │     Part A1: 正常映射业务员（organization != '未分配'）
    │     Part A2: 跨机构业务员（按 org_level_3 拆分，每机构一行）
    │     Part B:  未映射业务员（有保单但不在 mapping 中）
    │
SalesmanDim (TABLE ← dim/salesman/latest.parquet)
PlanFact (TABLE ← dim/plan/latest.parquet)
SalesmanTeamMapping (TABLE ← SalesmanDim LEFT JOIN PlanFact)
SalesmanPlanFact (VIEW ← PlanFact LEFT JOIN SalesmanDim，多年计划)
RenewalFunnel (VIEW ← renewal/*.parquet，动态计算到期天数+优先级 P1-P4)
QuoteConversion (VIEW ← quotes_conversion/*.parquet，透传)
```

---

## 变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.0 | 2026-03-31 | 全面重写：工具索引→知识库+工具体系索引，覆盖 ETL/诊断/维度表/分析报告 |
| 1.0 | 2026-01-16 | 初始版本（8 个 CLI 工具索引，已废弃） |
