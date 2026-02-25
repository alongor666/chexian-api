# 2026-02-25 API-only 分批清理零故障保障报告（B208）

## 目标

按“分批清理 + 每批门禁 + 失败即停”执行 API-only 架构清理，保证清理后项目可启动、可登录、可查询、可导出。

## 批次执行结果

### Batch 0（基线锁定）

- 基线门禁执行并记录日志：
  - `artifacts/cleanup-gates/2026-02-25/01-typecheck.log`
  - `artifacts/cleanup-gates/2026-02-25/02-governance.log`
  - `artifacts/cleanup-gates/2026-02-25/03-build.log`
  - `artifacts/cleanup-gates/2026-02-25/04-tests.log`
  - `artifacts/cleanup-gates/2026-02-25/05-e2e-cleanup-gate.log`

### Batch 1（文档与注释纠偏）

- 已完成 API-only 口径统一（DuckDB-WASM/双模式叙述纠偏）。
- 说明：本批仅文档/注释调整，不改业务语义。

### Batch 2（无引用代码归档，不物理删除）

- 过渡代码按“先归档后删除”策略落档到：
  - `archive/legacy-code/2026-02-api-only/`
- 归档清单：
  - `archive/legacy-code/2026-02-api-only/ARCHIVE_MANIFEST.md`

### Batch 3（类型检查收紧）

- `tsconfig.json` 收紧：移除对活跃源码目录的历史性排除。
- 新增治理护栏：`scripts/check-governance.mjs` 增加“TS 检查范围”检查，防止通过 `exclude` 规避真实类型问题。
- `src/shared/json-render/catalog.ts` 做第三方类型兼容降级（仅类型层），消除 `@json-render/core` 与本地 `zod` 类型冲突，运行行为不变。

## 门禁验证（最终全绿）

### 静态门禁

- `bun run typecheck`：通过
- `bun run governance`：通过
- `bun run build`：通过

### 自动化门禁

- `bun run test -- --run tests/queryBuilder.test.ts tests/api/client.test.ts tests/integration/critical-path.test.ts tests/coverage-report.test.ts tests/formatting-migration-check.test.ts`：通过（84 tests）

### 运行门禁（真实启动 + 浏览器）

- `bun run test:e2e:cleanup-gate`：通过（2 tests）
- 覆盖内容：
  - 登录成功（用户名/密码）
  - 关键页面可达：`dashboard/truck/renewal/growth/cost/coefficient/sql-query/premium-report/marketing-report`
  - 筛选/查询/图表可见
  - 导出可用：CSV / Excel / PDF 下载且文件非空
  - 安全回归：无 token 请求 `401`，有 token 请求 `200`

## 结论

本轮按计划完成 Batch0-3，且门禁日志均可复现；当前清理状态满足“功能完备、流程顺畅、清理后可运行”。

