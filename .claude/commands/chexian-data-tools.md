---
name: chexian-data-tools
description: ⚠️ 当前不可用 — Python 数据分析工具库（数据管理/cli.py）的 9 个注册工具模块文件已全部缺失，等待重建或退役决策（见 BACKLOG）。仅保留本文件作状态指针，防止误调用。
category: data-analysis
version: 2.0.0
author: "@claude"
scope: project
requires:
  - python3
dependencies:
  - 数据管理/cli.py
last_updated: "2026-06-09"
---

# Python 数据分析工具库（当前不可用）

> **状态（2026-06-09 实测）**：`数据管理/cli.py` 本体存在且 `--list` 可显示 9 个注册工具，但所有工具的模块文件（`data_tools/`、`field_tools/`、`conversion_tools/`、`business_tools/`、`diagnosis_tools/` 目录）在主仓库与 git 跟踪中均不存在，实际运行任何工具都会报"模块文件不存在"。已登记 BACKLOG 等待"重建 / 退役"决策。

## 禁止

- ❌ 按本命令旧版文档调用 `python3 cli.py <tool>` 并期待结果（必然失败）
- ❌ 向用户声称这些工具可用

## 替代路径（当前可用的等价能力）

| 旧工具 | 替代 |
|--------|------|
| analyze_parquet / field_* | `duckdb -c "DESCRIBE SELECT * FROM '<path>.parquet'"` + `SUMMARIZE` 直查 |
| excel_to_parquet | `node 数据管理/daily.mjs`（统一 ETL 管道，含 Schema 契约校验） |
| earned_premium | `server/src/sql/cost/cost-ratios.ts` 实现层口径（闰年感知） |
| diagnose_agent | `/diagnose-agent` 命令（驱动 `数据管理/pipelines/diagnose_agent.py`，该脚本存在且正常） |

## 后续

待 BACKLOG 任务裁决后，本文件要么随工具重建恢复为速查表，要么随 cli.py 退役一并删除。
