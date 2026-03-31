---
name: 生产巡检脚本
description: scripts/prod-health-check.sh — 一行命令并行检测全站 41 个 API 端点健康状态，含完整路由表和参数映射
type: reference
---

## 生产全站 API 巡检工具

**脚本**: `scripts/prod-health-check.sh`
**快捷命令**: `bun run health:prod` / `bun run health:prod:verbose`

### 使用方式
```bash
# 凭据配置（首次）
cp .env.health-check.example .env.health-check  # 填入 HEALTH_CHECK_USER + HEALTH_CHECK_PASS

# 运行
bun run health:prod                    # 标准输出
bun run health:prod:verbose            # 显示失败详情
bash scripts/prod-health-check.sh --url http://localhost:3000 --year 2026  # 自定义
```

### 设计要点
- **路由表动态提取**: 从 `server/src/routes/query/*.ts` grep 路由定义 + 内置兜底表，新增路由自动覆盖
- **凭据安全**: 从 `.env.health-check` 读取（已 gitignore），不硬编码。密码含 `!` 等特殊字符必须用文件方式，不能用 shell 内联 export
- **并行执行**: 41 个端点并行 curl，~15s 完成全部检测
- **特殊参数映射**: cost 需 cutoffDate、coefficient 需 startDate+endDate、holiday-drilldown 需 groupBy、premium-plan 需 level

### 输出判定
- ✅ HTTP 200 + success:true + <3s
- ⚠️ HTTP 200 + success:true + >3s（慢）
- ❌ 非 200 或 success 非 true
- 退出码: 0=全通过, 1=有失败, 2=认证失败

### 相关文件
- `.env.health-check.example` — 凭据模板
- `.env.health-check` — 实际凭据（gitignore）
- `package.json` — `health:prod` / `health:prod:verbose` scripts

### 注意事项
- zsh 下 `!` 有历史展开特殊含义，用 `.env.health-check` 文件而非 export 传递密码
- 并行子进程文件名用路由名（tr '/' '_'）而非索引号，避免竞态覆盖
- JSON 构造用 python3 从环境变量读取，避免 shell 转义问题
