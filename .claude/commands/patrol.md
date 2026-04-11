# 续保数据巡检

## 用法

- `/patrol` — 执行续保巡检，生成报告并给出文本摘要
- `/patrol --dry-run` — 只打印 SQL 不执行
- `/patrol --sync` — 执行巡检后同步到 VPS

## 步骤

1. 执行巡检引擎：`python3 数据管理/patrol/patrol_engine.py --domain renewal`
2. 读取产出 JSON：`数据管理/patrol_reports/renewal/latest.json`
3. 分析巡检结果，给出文本摘要：
   - 严重警报（红灯）：哪些维度值异常，可能的原因
   - 盲点发现：偏离整体最大的交叉组合
   - 环比变化：哪些月份出现显著趋势变化
   - 行动建议：优先关注哪些方向
4. 如果指定 `--sync`：`node scripts/sync-vps.mjs`

## 交互追问

用户可以追问：
- "XX 机构为什么续保率下降？" → 自动查询 renewal_universe parquet 下钻分析
- "XX 类别的盲点详情" → 从 JSON 中提取并展示
- "与上月对比" → 使用环比数据说明变化

## AI 研判协议（Phase 2）

在完成步骤 1-4 的基础巡检后，执行以下 AI 深度研判：

### 5. 识别 Top N 异常

从 latest.json 中提取最严重的异常：
- 读取 `sections` 中所有 findings，按 `worst_alert` 排序（red > orange > yellow）
- 读取 `blindspots` 中偏离最大的交叉组合
- 合并排序，取 Top 5 异常

### 6. 下钻查询

对每个 Top 异常，用 DuckDB 做 2-3 次交叉下钻：

```bash
duckdb -c "
  SELECT <交叉维度>, COUNT(*) AS cnt,
    ROUND(SUM(is_renewed::INT)*1.0/COUNT(*), 4) AS renewal_rate,
    ROUND(SUM(is_quoted::INT)*1.0/COUNT(*), 4) AS quote_coverage_rate
  FROM read_parquet('数据管理/warehouse/fact/renewal_universe/latest.parquet')
  WHERE <异常条件>
  GROUP BY <交叉维度>
  HAVING COUNT(*) >= 30
  ORDER BY renewal_rate ASC
"
```

下钻方向：
- 异常维度值 × 客户类别（结构分解）
- 异常维度值 × 到期月份（时间趋势）
- 异常维度值 × 新旧车/能源类型（属性交叉）

### 7. 探索配置外维度

renewal.json 配置了 6 个维度，但 RenewalUniverse 还有更多：
- `coverage_combination`（险别组合：主全/交三/单交）
- `is_new_car`（新旧车）
- `is_transfer`（过户车）
- `salesman_name`（业务员）
- `tonnage_segment`（吨位段，仅货车）

选择 2-3 个做 GROUP BY，标注偏离整体 >20% 的发现。
标注这些发现为 `discovered_via: 'exploration'`。

### 8. 写回 JSON + Markdown

**幂等性保护**：
1. 读取 `数据管理/patrol_reports/renewal/latest.json`
2. 删除已有的 `ai_findings` 和 `ai_meta` 字段（如果存在）
3. 追加新的研判数据
4. 写回同一文件

**ai_findings 结构**：
```json
{
  "ai_findings": [
    {
      "severity": "red",
      "title": "简短标题（如：天府×营业货车 续保率严重偏低）",
      "metric_value": "8.1%",
      "overall_value": "20.2%",
      "narrative": "2-3句分析文字，描述现象和可能原因。禁止假设因果。",
      "dimensions": [{"id": "org_level_3", "value": "天府"}, {"id": "customer_category", "value": "营业货车"}],
      "evidence": [{"query": "GROUP BY customer_category WHERE org_level_3='天府'", "result": "营业货车 8.1%, 非营业个人客车 22.5%"}],
      "discovered_via": "config_drill"
    }
  ],
  "ai_meta": {
    "generated_at": "2026-04-11T16:00:00.000Z",
    "queries_executed": 28,
    "extra_dimensions_explored": ["coverage_combination", "is_new_car"],
    "duration_seconds": 180
  }
}
```

**Markdown 报告**：同时写入 `数据管理/数据分析报告/renewal_patrol_YYYYMMDD.md`

## 护栏

- **禁止假设因果关系**：所有业务假设标注 `⚠️ 待用户确认`
- **率值禁止加权平均**：汇总时基于绝对值（分子/分母）重算
- **探索性发现必须标注**：`discovered_via: 'exploration'` 区分于配置内发现
- **DuckDB 语法**：查询失败时查 DuckDB 文档，不猜测

## 数据源

- 输入：`数据管理/warehouse/fact/renewal_universe/latest.parquet`（118,886 条应续保单）
- 配置：`数据管理/patrol/domain_configs/renewal.json`（6 维度 × 5 指标）
- 产出：`数据管理/patrol_reports/renewal/latest.json`（含 ai_findings）
- 报告：`数据管理/数据分析报告/renewal_patrol_YYYYMMDD.md`
