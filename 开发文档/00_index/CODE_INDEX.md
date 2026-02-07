# 代码索引 (CODE_INDEX)

**核心层目录地图**：快速定位关键代码入口与模块职责。

## 核心层目录

| 层级 | 路径 | 职责 | 索引文件 |
|------|------|------|----------|
| 共享逻辑层 | `src/shared/` | DuckDB客户端、数据规范化、SQL模板 | [INDEX.md](../../src/shared/INDEX.md) |
| 功能特性层 | `src/features/` | Dashboard、Filters 业务功能 | [INDEX.md](../../src/features/INDEX.md) |
| UI 组件层 | `src/widgets/` | Charts、KPI、Table 通用组件 | [INDEX.md](../../src/widgets/INDEX.md) |
| 自动化脚本 | `scripts/` | 治理校验、构建、CI/CD | [INDEX.md](../../scripts/INDEX.md) |

## 快速入口

### 数据处理链路
```
用户上传 Parquet
  ↓
src/shared/duckdb/client.ts:loadParquet()        # 加载文件
  ↓
src/shared/normalize/validator.ts:validateSchema() # 列名校验
  ↓
src/shared/duckdb/client.ts:78-95                # 创建 PolicyFact 视图
  ↓
src/shared/sql/kpi.ts:generateKpiSQL()           # 生成查询
  ↓
src/shared/duckdb/worker.ts:query()              # Worker 执行
  ↓
src/features/dashboard/Dashboard.tsx              # UI 渲染
```

### 关键类型定义

| 类型/接口 | 路径 | 说明 |
|-----------|------|------|
| `ColumnMapping` | `src/shared/normalize/mapping.ts` | 列名映射类型（支持多别名） |
| `WorkerMessage` | `src/shared/types/duckdb.ts` | Worker 通信协议 |
| `ValidationResult` | `src/shared/normalize/validator.ts` | 数据校验结果 |
| `KpiConfig` | `src/shared/sql/kpi.ts` | KPI 查询配置 |

### 禁止直接修改的文件

| 文件 | 原因 | 如需变更 |
|------|------|----------|
| `src/shared/normalize/mapping.ts` | 指标口径定义 | 只能追加新别名，不得删除；需 BACKLOG 证据 |
| `src/shared/sql/kpi.ts` | SQL 业务规则 | 只能追加新模板，不得改已有逻辑；需 BACKLOG 证据 |
| `src/shared/duckdb/client.ts:78-95` | PolicyFact 视图定义 | 涉及业务口径，需产品确认 + BACKLOG 登记 |

## 测试入口

| 测试文件 | 覆盖范围 | 路径 |
|----------|----------|------|
| `mapping.test.ts` | 别名解析、列名映射 | `tests/mapping.test.ts` |
| `validator.test.ts` | 类型验证、数据质量 | `tests/validator.test.ts` |
| `kpi.test.ts` | SQL 生成、业务逻辑 | `tests/kpi.test.ts` |

运行测试：`bun test`

## 链接到其他索引

- **文档索引**: [DOC_INDEX.md](./DOC_INDEX.md) - 业务规则、架构文档
- **进展索引**: [PROGRESS_INDEX.md](./PROGRESS_INDEX.md) - 任务状态、待办事项

---

**变更规则**：
- 新增核心层目录：必须创建 INDEX.md 并在此处登记。
- 新增关键类型：必须在"关键类型定义"表格登记。
- 修改禁止文件：必须先在 BACKLOG.md 登记需求并提供证据链。
