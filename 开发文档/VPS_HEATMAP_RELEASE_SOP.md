# VPS 热力图发布与验收 SOP

## 目标

将“业绩分析-三级机构连续15天热力图”相关前后端改动发布到 VPS，并用真实网页与 API 完成验收，避免“本地有、线上无”。

## 一键命令（推荐）

```bash
# 发布 + 验收（默认）
bun run release:vps:heatmap

# 仅验收（不部署）
bun run verify:vps:heatmap
```

## 前置条件

```bash
# 1) SSH 别名可连通（见 AGENTS.md §8）
ssh chexian-vps-deploy echo ok

# 2) 如需覆盖默认验收账号，可设置环境变量
export E2E_USERNAME=admin
export E2E_PASSWORD='你的密码'
```

## 命令说明

### `bun run release:vps:heatmap`

执行顺序：

1. 本地构建前端 `dist/`
2. 本地构建后端 `server/dist/`
3. 通过 `ssh + rsync` 同步到 VPS：
   - `/var/www/chexian/frontend/dist`
   - `/var/www/chexian/server/dist`
4. VPS 重启 `pm2 restart chexian-api`
5. 健康检查 `curl http://127.0.0.1:3000/health`
6. 调用 `verify-vps-heatmap.mjs` 做端到端验收

常用参数：

```bash
node scripts/release-vps-heatmap.mjs --host chexian-vps-deploy --base-url https://chexian.cretvalu.com
node scripts/release-vps-heatmap.mjs --skip-verify
```

### `bun run verify:vps:heatmap`

验收内容：

1. 登录线上站点
2. 打开 `/#/performance-analysis`
3. 校验热力图标题存在
4. 校验三标签存在并切换：
   - 增长率
   - 计划达成率
   - 保费规模
5. 校验 `performance-org-heatmap` 接口返回 `200`
6. 输出证据到 `output/playwright/`

常用参数：

```bash
node scripts/verify-vps-heatmap.mjs --base-url https://chexian.cretvalu.com
node scripts/verify-vps-heatmap.mjs --username admin --password '你的密码'
```

## 证据产物

默认输出目录：`output/playwright/`

- `vps-heatmap-verify-*.json`：验收结构化结果
- `vps-heatmap-verify-*.png`：验收截图
- `vps-heatmap-verify-network-*.log`：关键接口网络日志

## 失败排查（最短路径）

1. SSH 失败：先修 `~/.ssh/config` 的 `chexian-vps-deploy` 别名
2. 健康检查失败：`ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api logs 100"`
3. 页面回到“数据导入”：先排查 `/api/data/load/*` 的状态码
4. 热力图不显示：优先看网络日志里 `/api/query/performance-org-heatmap` 是否 200
