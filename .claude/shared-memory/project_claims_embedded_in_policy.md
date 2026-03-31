---
name: 赔付字段已内嵌在 policy 分片中，claims/latest.parquet 是废弃文件
description: policy/current/*.parquet 已包含赔案件数/已报告赔款/费用金额，不需要 JOIN claims 表
type: project
---

policy/current/ 的 4 个分片文件已内嵌完整的赔付字段（赔案件数、已报告赔款、费用金额），覆盖 2021-2026 全量数据。

claims/latest.parquet 是 daily.mjs claims 域的产出物，但：
- 由于 `findLargestXlsx()` 按文件体积选最大 xlsx，只覆盖 2025-2026 年
- 服务端 app.ts 不加载此文件
- diagnose_agent.py v2.0 已移除对它的 JOIN

**Why:** 之前 LEFT JOIN claims 会用 claims 中的 NULL/0 覆盖 policy 中已有的赔付值，导致 2021-2023 年赔案显示为 0。

**How to apply:** 任何新脚本需要赔付数据时，直接从 policy/current/*.parquet 读取，不要 JOIN claims/latest.parquet。
