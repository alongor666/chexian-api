# 部署到 VPS

按顺序执行以下步骤，任何一步失败立即停止并报告：

## Pre-flight 检查
1. `bun run build` — 确认零 TS 报错
2. `bun run governance` — 治理通过
3. `grep -rn '<<<<<<' src/ server/src/` — 无冲突标记
4. 确认当前分支已推送到 remote

## 数据同步（如有变更）
5. 同步到 VPS：`node scripts/sync-vps.mjs`
   （rsync 事实表 policy/daily + claims + quotes + 维度表 salesman + plan）

## 部署执行
7. SSH 到 VPS：`ssh chexian-vps-deploy`
8. `cd /var/www/chexian && git pull origin main`
9. `cd /var/www/chexian && bun install`
10. `cd /var/www/chexian && bun run build`
11. PM2 重启（禁止 restart/reload）：`pm2 delete chexian-api && pm2 start ecosystem.config.js`

## 健康验证
12. `curl -s -o /dev/null -w '%{http_code}' https://chexian.cretvalu.com/` — 期望 200
13. `curl -s -o /dev/null -w '%{http_code}' https://chexian.cretvalu.com/health` — 期望 200
14. `curl -s https://chexian.cretvalu.com/api/query/kpi | jq '.data | length'` — 期望 >0
15. 如任何检查失败：`pm2 logs chexian-api --lines 30` 诊断

所有步骤通过后报告：部署完成 + 各端点状态码。
