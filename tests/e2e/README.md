# E2E 测试说明 (Playwright)

本目录包含车险业绩分析系统的端到端（E2E）测试，使用 [Playwright](https://playwright.dev/) 框架。

## 快速开始

### 前置要求

1. 已安装依赖：`bun install`
2. 已安装 Playwright 浏览器：`bunx playwright install chromium`
3. 前后端服务正常启动（测试时会自动启动）

### 运行命令

```bash
# 运行所有 E2E 测试
bun run test:e2e

# 交互式 UI 模式（调试推荐）
bun run test:e2e:ui

# 仅运行指定文件
bunx playwright test tests/e2e/01-dashboard-flow.spec.ts

# 运行清理零故障门禁（关键页面+导出+401/200）
bun run test:e2e:cleanup-gate

# 查看测试报告（运行测试后）
bunx playwright show-report
```

## 测试文件说明

| 文件 | 场景 | 覆盖范围 |
|------|------|----------|
| `01-dashboard-flow.spec.ts` | 仪表盘核心流程 | 登录→仪表盘加载→视角切换→趋势视图 |
| `02-filter-sql.spec.ts` | 筛选器与SQL查询 | 保费报表筛选→SQL编辑器执行→结果渲染 |
| `03-cleanup-zero-downtime-gate.spec.ts` | 清理门禁回归 | 关键页面可达→筛选/查询/图表→CSV/Excel/PDF导出→401/200 鉴权 |

## 测试架构

```
tests/e2e/
├── README.md              # 本文件
├── 01-dashboard-flow.spec.ts   # 仪表盘流程测试（B128）
├── 02-filter-sql.spec.ts       # 筛选器+SQL测试（B129）
└── 03-cleanup-zero-downtime-gate.spec.ts # API-only 清理门禁测试（B208）
```

## 配置说明

配置文件：`playwright.config.ts`（项目根目录）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `baseURL` | `http://localhost:5173` | 前端开发服务器地址 |
| `testDir` | `./tests/e2e` | 测试文件目录 |
| `webServer.command` | `bun run dev:full` | 自动启动前后端服务 |
| `retries` | CI: 2 次 / 本地: 0 次 | CI 环境自动重试 |
| `screenshot` | `only-on-failure` | 仅失败时截图 |

## 编写新测试

```typescript
import { test, expect } from '@playwright/test';

test('描述你的测试场景', async ({ page }) => {
  // 1. 导航到目标页面
  await page.goto('/#/dashboard');

  // 2. 断言页面状态
  await expect(page.getByRole('heading', { name: '保费分析看板' })).toBeVisible();

  // 3. 用户交互
  await page.getByRole('button', { name: '保单件数' }).click();

  // 4. 验证结果
  await expect(page.getByText('保单件数趋势')).toBeVisible();
});
```

## CI 集成

GitHub Actions 中的 E2E 测试（如需添加）参考 `.github/workflows/` 目录。

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 浏览器启动失败 | 运行 `bunx playwright install chromium` |
| 服务器连接超时 | 检查后端是否启动（`bun run dev:full`） |
| 测试不稳定 | 增加 `waitFor` 或提高 `actionTimeout` |
| 截图路径 | 默认保存至 `playwright-report/` 目录 |

## 凭据说明（清理门禁用例）

- `03-cleanup-zero-downtime-gate.spec.ts` 默认登录账号：
  - 用户名：`admin`
  - 密码：`CxAdmin@2026!`
- 可通过环境变量覆盖：
  - `E2E_USERNAME`
  - `E2E_PASSWORD`
