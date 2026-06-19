---
paths: ["scripts/cleanup-reports.mjs", "scripts/sync-vps.mjs", "deploy/vps-wrapper/**"]
---

# Reports 累积清理三件套（RED LINE）

policy: append-only

> 来源：PR #476。`sync-vps.mjs` 的 `html_reports` 和 `public_reports` 任务用 `deleteRemote: false` 模式累积，VPS 曾盘到 1.3 GB。本文件沉淀清理机制 + 部署 SOP。
> 适用：任何改动 `scripts/cleanup-reports.mjs`、`scripts/sync-vps.mjs` 的 reports 清理逻辑、`deploy/vps-wrapper/cleanup-reports-vps.sh` 的 PR。

## 1. 问题

- `scripts/sync-vps.mjs` 中两个任务用 `deleteRemote: false` 保留历史报告：
  - `html_reports`：`server/data/reports/` → VPS `data/reports/`
  - `public_reports`：`public/reports/` → VPS `frontend/dist/reports/`
- 长期累积只增不减——曾盘到 **1.3 GB**，其中 `diagnose-loss-development/<日期>/` 单次 100 MB，多日累积是主要来源
- 顶层散 HTML 中开发期 demo（`<日期>-<HHMMSS>-<hash>.html` 纯时间戳模式）也大量遗留

## 2. 清理三件套（精→中→粗）

| 层级 | 工具 | 触发 | 作用 |
|------|------|------|------|
| **精** 一次性 | `node scripts/cleanup-reports.mjs [--apply]` | 手动 | 默认 dry-run；按业务名分组保最新 + 删纯时间戳测试 + 子目录按日期保最新；`--dir <path>` 切换目标目录 |
| **中** 同步前 | `runReportsCleanup()` in `sync-vps.mjs` | 每次 `node scripts/sync-vps.mjs` | 依次清 `server/data/reports/` + `public/reports/`，再 rsync。`--no-cleanup` 可跳过 |
| **粗** VPS cron 兜底 | `deploy/vps-wrapper/cleanup-reports-vps.sh` | crontab 每日 3:30 | 纯 bash，BSD/GNU find 兼容，专杀两类大头：纯时间戳测试 + 日期格式子目录非最新；同时覆盖 `server/data/reports/` 和 `frontend/dist/reports/` |

## 3. 清理算法（mjs 精清理）

**顶层 HTML 文件**：
- `^\d{8}-\d{6}-[a-f0-9]+\.html$` 纯时间戳 → 全删（开发期 demo）
- `^\d{8}-<业务名>-<hash>\.html$` → 按 `<业务名>` 分组，每组保 mtime 最新
- 无日期前缀（如 `邮政四川_经营复盘.html`） → 保留（遗留特殊）

**顶层子目录**：
- 子目录下的 `YYYY-MM-DD` 日期格式二级子目录 → 保留最新一个

## 4. VPS cron 部署（仅首次需要）

```bash
# 1. 拷脚本到 VPS 标准路径
sudo cp /var/www/chexian/server/deploy/vps-wrapper/cleanup-reports-vps.sh \
       /usr/local/bin/cleanup-chexian-reports.sh
sudo chmod +x /usr/local/bin/cleanup-chexian-reports.sh

# 2. 安装 cron（root crontab，每日 3:30）
sudo crontab -e
# 追加一行：
# 30 3 * * * /usr/local/bin/cleanup-chexian-reports.sh >> /var/log/cleanup-chexian-reports.log 2>&1

# 3. 验证
sudo /usr/local/bin/cleanup-chexian-reports.sh --dry-run
sudo tail -f /var/log/cleanup-chexian-reports.log
```

## 5. 禁止

- ❌ 关闭 sync-vps 的前置清理（`--no-cleanup` 仅供调试，长期使用会让 reports 复发累积）
- ❌ 直接 `rm -rf reports/*`（会误删保留中的业务报告唯一份）
- ❌ 把"业务命名报告"误判为"测试文件"批量删（业务名带"v2"、"已修阈值"等修饰词，算法已按完整 `<业务名>` key 分组）
- ❌ 在 sync-vps `runReportsCleanup()` 中只清一个目录漏掉另一个（必须 server/data/reports + public/reports 都覆盖）

## 关联

- 母 PR：[#476 feat(vps): reports 累积清理三件套](https://github.com/alongor666/chexian-api/pull/476)
- 实现：`scripts/cleanup-reports.mjs`、`scripts/sync-vps.mjs` 的 `runReportsCleanup()`、`deploy/vps-wrapper/cleanup-reports-vps.sh`
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
