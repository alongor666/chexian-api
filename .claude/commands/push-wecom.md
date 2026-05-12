---
name: push-wecom
description: 把本地 markdown 报告推送到企业微信智能表格（章节表格化），按 H1/H2 拆成多行，返回 url 和 docid 供复粘到群
category: integration
version: 2.0.0
author: "@claude"
tags: [wecom, push, markdown, smartsheet, integration]
scope: project
requires:
  - Python 3.x
  - wecom-cli (>= 0.1.8)
dependencies:
  - 数据管理/integrations/wecom_doc/push_markdown.py
  - 数据管理/integrations/wecom_smartsheet/create_renewal_tracker.py
  - 数据管理/integrations/wecom_smartsheet/field_spec.py
last_updated: "2026-05-08"
---

# 推送 markdown 到企业微信智能表格

把本地 markdown 报告（如 `/report-weekly`、`/diagnose-*` 生成的产物）发布为企业微信「智能表格」，按 H1/H2 自动拆成多行——每个章节一条记录，便于按层级筛选、按章节定位。

## 何时使用

- 用户说「推到企微 / 发到企业微信 / 推送报告 / push wecom」
- 用户已生成 markdown 报告，希望让团队通过链接查看（非自己留档）
- 报告生成命令（`/report-weekly` 等）执行完后用户主动要求分享

## 用法

```bash
# 基本用法（按 H1 拆 page，文档名取首个 H1 或文件名）
python3 数据管理/integrations/wecom_doc/push_markdown.py <markdown 路径>

# 指定文档名
python3 数据管理/integrations/wecom_doc/push_markdown.py <md路径> --name "2026-W19 周报"

# 干跑：先看拆分结果，确认无误再去掉 --dry-run
python3 数据管理/integrations/wecom_doc/push_markdown.py <md路径> --dry-run
```

## 行为约定

- **拆分规则**：按 H1（`# `）和 H2（`## `）拆，每个标题对应表格中一行；标题之前的前置内容作为"前言"行
- **字段方案**：章节标题 / 层级（H1|H2） / 序号 / 正文 / 字数 — 共 5 列
- **正文渲染**：smartsheet 的文本字段不渲染 markdown 语法，正文里 `# 标题` `- 列表` `|表格|` 都是字面字符串。要原生 markdown 渲染请改用 smartpage 接口（不在本命令范围内）
- **每次新建**：每次调用都创建一篇新文档，不维护"同名覆写"映射
- **链接处理**：脚本只输出 docid + url 和一段可复粘的群分享话术；**不自动发群**（企业禁用 `wecom-cli msg` 接口）
- **单元格上限**：超过 32000 字符的章节正文会被截断并附"原文 N 字符"标注

## 推荐工作流

1. 先 `--dry-run` 验证 H1/H2 切分是否符合预期（看章节数、是否有意外的截断）
2. 确认无误后去掉 `--dry-run` 实际推送
3. 复制脚本输出末尾的「复粘到企微群」话术发到群里

## 错误处理

| 错误码 | 原因 | 处理 |
|--------|------|------|
| `[ERROR] Markdown 文件不存在` | 路径错 | 检查路径 |
| `[ERROR] Markdown 文件内容为空` | 文件空 | 检查报告生成是否成功 |
| `[ERROR] wecom-cli 调用失败` | wecom-cli 未配置 / 鉴权过期 / 接口被禁 | 先 `wecom-cli init`；若 errcode=851002 检查文档类型 |
| `wecom-cli doc 缺少必需子命令` | wecom-cli 版本过老 | 升级 wecom-cli 到 0.1.8+ |

## 与其他命令的衔接

报告生成类命令（`/report-weekly`、`/diagnose-agent` 等）执行完，若用户希望推到企微，AI 应主动建议：

> 报告已生成在 `<path>`。如需推送到企业微信，运行：
> `python3 数据管理/integrations/wecom_doc/push_markdown.py <path>`
