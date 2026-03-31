---
name: 巡检方法论
description: 全站巡检用 Bash 并行 curl 而非 Puppeteer MCP 逐页截图，效率差 10x+
type: feedback
---

全站 API 巡检用 `bash scripts/prod-health-check.sh`，不用 Puppeteer MCP 逐页导航+截图。

**Why:** Puppeteer MCP 每页需 3 步（navigate → sleep → screenshot），串行 41 端点需 ~40 分钟 + ~40 轮对话。Bash 并行 curl 同样 41 端点只需 ~15 秒 + 1 轮对话。效率差 100x。

**How to apply:**
- 生产巡检 → 直接 `bun run health:prod`
- 前端渲染检查 → 用已有 Playwright E2E (`bun run test:e2e`)
- Puppeteer MCP 仅用于**单页调试**（如排查特定页面的交互 bug）
- 批量检查场景永远优先用脚本，不用交互式浏览器
