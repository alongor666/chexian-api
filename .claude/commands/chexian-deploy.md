---
name: chexian-deploy
description: 当用户需要将代码发布到生产 VPS 时使用 — 正常发布走 CI（merge 到 main 自动部署），本命令覆盖发布前检查、数据同步与应急手动部署，执行前必须读部署链 SOP。
category: deployment
scope: project
dependencies:
  - .claude/rules/deploy-chain-sop.md
last_updated: "2026-06-09"
---

# 部署到 VPS

> **执行前必须读取并遵从 [.claude/rules/deploy-chain-sop.md](../rules/deploy-chain-sop.md)**（wrapper 同步机制、部署链 PR 禁 auto-merge、8 项部署清单）。
> **正常发布路径是 CI**：PR merge 到 main → `.github/workflows/deploy.yml` 自动构建、部署、健康检查。本命令的手动部署章节仅用于 CI 不可用时的应急通道。

按顺序执行，任何一步失败立即停止并报告：

## Pre-flight 检查

1. `bun run build` — 确认零 TS 报错
2. `bun run governance` — 治理通过
3. `grep -rn '<<<<<<' src/ server/src/` — 无冲突标记
4. 确认当前分支已推送到 remote

## 数据同步（如有数据变更）

5. `node scripts/sync-vps.mjs` — rsync 全部已注册数据域（域清单以 `数据管理/data-sources.json` 为准，禁止凭记忆列举）

## 部署执行

- **正常路径**：merge PR 到 main，盯 GitHub Actions run 至绿色（部署链 PR 必须人工监控窗口，见 SOP §2）
- **应急手动路径**（仅 CI 不可用时）：
  6. `ssh chexian-vps-deploy`
  7. `cd /var/www/chexian && git pull origin main && bun install && bun run build`
  8. PM2 重载：`sudo /usr/local/bin/deploy-chexian-api reload`（deployer 无法直接调 pm2；若进程 errored 用 `describe` 先诊断，禁止只 restart）

## 健康验证

9. `curl -s -o /dev/null -w '%{http_code}' https://chexian.cretvalu.com/` — 期望 200
10. `curl -s -o /dev/null -w '%{http_code}' https://chexian.cretvalu.com/health` — 期望 200
11. `curl -s https://chexian.cretvalu.com/api/query/kpi | jq '.data | length'` — 期望 >0
12. 如任何检查失败：`sudo /usr/local/bin/deploy-chexian-api logs` 诊断（bcrypt 原生模块缺失看 MODULE_NOT_FOUND，参见 memory `project_vps_bcrypt_reload_landmine`）

所有步骤通过后，按 SOP §4 部署清单逐项确认，再报告：部署完成 + 各端点状态码。
