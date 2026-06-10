---
name: chexian-patrol
description: ⚠️ 前置条件缺失暂不可执行 — 续保数据巡检（patrol_engine.py 三口径 × 5 优先客户类别 + AI 深度研判）。设计思路评估已登记 BACKLOG（P2），裁决前禁止直接执行。
category: data-analysis
scope: project
last_updated: "2026-06-09"
---

# 续保数据巡检

> **状态（2026-06-09 核实）**：本命令依赖的数据源 `数据管理/warehouse/fact/renewal_universe/latest.parquet` 与必读规范 `数据管理/knowledge/ai/RENEWAL_PATROL_REPORT_FRAMEWORK.md` 在主仓库均不存在，当前不可执行。其三口径巡检与 `/diagnose-renewal` v2.2（基于 `renewal_tracker`）的关系评估已登记 BACKLOG（uid `2026-06-10-claude-3a6daf`，P2）。裁决前若用户触发本命令，应说明现状并引导改用 `/diagnose-renewal`。

## 用法

- `/chexian-patrol` — 执行续保巡检，生成报告并给出文本摘要
- `/chexian-patrol --dry-run` — 只打印 SQL 不执行
- `/chexian-patrol --sync` — 执行巡检后同步到 VPS

## 必读

**撰写报告前必须读取规范框架**：`数据管理/knowledge/ai/RENEWAL_PATROL_REPORT_FRAMEWORK.md`
该框架定义了三口径体系、客户类别优先级、指标命名（流失保费）、报告结构、撰写规则。

## 步骤

### Phase 1: 数据采集

1. 执行巡检引擎：`python3 数据管理/patrol/patrol_engine.py --domain renewal`
2. 读取产出 JSON：`数据管理/patrol_reports/renewal/latest.json`
3. 读取报告规范：`数据管理/knowledge/ai/RENEWAL_PATROL_REPORT_FRAMEWORK.md`

### Phase 2: 三口径分析

确定 `latest_data_date`（PolicyFact 当年最新 policy_date），然后对 5 个优先类别各跑三口径：

```python
# 口径定义
已到期: expiry_date <= latest_data_date - 1天
30天内: expiry_date ∈ (latest_data_date - 1天, latest_data_date + 29天]
全年:   无日期限制
```

优先类别（按此顺序）：
1. 非营业个人客车
2. 非营业货车（个人货车）
3. 非营业企业客车
4. 营业货车（企业货车）
5. 营业公路客运

每个类别 × 三口径 → 续保率、报价覆盖率、报价转化率、流失保费。
再对每个类别做机构下钻（已到期口径）。

### Phase 3: AI 深度研判

1. **识别 Top N 异常**：从 latest.json 的 sections + blindspots 提取
2. **下钻查询**：每个 Top 异常做 2-3 次 DuckDB 交叉下钻
3. **探索配置外维度**：is_new_car、is_transfer、coverage_combination 等
4. **写回 JSON**：幂等覆盖 ai_findings + ai_meta

### Phase 4: 撰写报告

**按 RENEWAL_PATROL_REPORT_FRAMEWORK.md 规范撰写**，输出两个文件：
- `数据管理/patrol_reports/renewal/report.md`（前端展示，文件头 `<!-- generated: ISO_DATE -->`）
- `数据管理/数据分析报告/renewal_patrol_YYYYMMDD.md`（存档副本）

### Phase 5: 同步（可选）

如果指定 `--sync`：`node scripts/sync-vps.mjs`

## 交互追问

用户可以追问：
- "XX 机构为什么续保率下降？" → 自动查询 renewal_universe parquet 下钻分析
- "XX 类别的盲点详情" → 从 JSON 中提取并展示
- "与上月对比" → 使用环比数据说明变化

## ai_findings 结构

```json
{
  "ai_findings": [
    {
      "severity": "red|orange|yellow",
      "title": "简短中文标题",
      "metric_value": "8.1%",
      "overall_value": "20.2%",
      "narrative": "2-3句分析文字。禁止假设因果。",
      "dimensions": [{"id": "维度id", "value": "维度值"}],
      "evidence": [{"query": "查询描述", "result": "结果摘要"}],
      "discovered_via": "config_drill|cross_drill|exploration"
    }
  ],
  "ai_meta": {
    "generated_at": "ISO时间",
    "queries_executed": 12,
    "extra_dimensions_explored": ["is_new_car", "is_transfer"],
    "duration_seconds": 15
  }
}
```

## 护栏

- **禁止假设因果关系**：所有业务假设标注 `⚠️ 待用户确认`
- **率值禁止加权平均**：汇总时基于绝对值（分子/分母）重算
- **探索性发现必须标注**：`discovered_via: 'exploration'`
- **"流失保费"不叫"风险保费"**：面向用户统一使用"流失保费"
- **三口径必须同时展示**：禁止只展示一个口径
- **DuckDB 语法**：查询失败时查 DuckDB 文档，不猜测
- **<30 件不做结论**：统计不显著

## 数据源

- 输入：`数据管理/warehouse/fact/renewal_universe/latest.parquet`
- 配置：`数据管理/patrol/domain_configs/renewal.json`（6 维度 × 5 指标）
- 规范：`数据管理/knowledge/ai/RENEWAL_PATROL_REPORT_FRAMEWORK.md`
- 产出 JSON：`数据管理/patrol_reports/renewal/latest.json`（含 ai_findings）
- 产出报告：`数据管理/patrol_reports/renewal/report.md` + `数据管理/数据分析报告/renewal_patrol_YYYYMMDD.md`
