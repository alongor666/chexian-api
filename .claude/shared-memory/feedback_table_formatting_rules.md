---
name: 表格排版规则：对齐、单位、指标命名
description: 所有表格文字左对齐数字右对齐，金额万元单位在备注不在列头，指标全链路统一中英文 id
type: feedback
---

所有表格（Markdown/文档/网页 UI）必须遵循：

1. **对齐**：文字列左对齐（`:---`），数字列右对齐（`---:`）
2. **金额单位**：万元为默认单位，在报告备注中说明；案均赔款/件均保费用元，标 `†` 符号
3. **列头不含单位**：`已报告赔款` 而非 `已报告赔款(万)`

**指标命名全链路统一**：
- 每个指标必须在 `metric-registry/categories/*.ts` 注册
- SQL 层注释标注 registry id（如 `-- earned_margin_amount`）
- Python 层 dict key 可用中文但注释标注对应 id
- 前端从注册表派生 label/formatter/unit

**Why:** 用户要求防止认知偏差，从数据库到 UI 端都用同一个 id + name 对应关系。

**How to apply:** 新增指标时先注册 → 再写 SQL/Python/前端，注释中标注 id。
