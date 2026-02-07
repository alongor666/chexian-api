# /src/services/ - 服务层索引

> **说明**：本文件夹包含业务逻辑服务，负责图表渲染和 Worker 管理。
>
> ⚠️ **架构变更说明（2026-02-04）**：
> - `DataService.ts` 已废弃，数据处理迁移至 `src/shared/duckdb/` (DuckDB-WASM)
> - `FilterService.ts` 已废弃，筛选逻辑迁移至 `src/shared/contexts/FilterContext.tsx` 和 SQL WHERE 子句生成

---

## 服务清单

### ChartService.ts - 图表服务
- **用途**: 图表渲染逻辑、ECharts 配置生成
- **核心 API**:
  - `renderKPICards(data): void` - 渲染 KPI 卡片
  - `renderStackedBarChart(data): void` - 渲染堆积柱状图
  - `renderPremiumProgressChart(data): void` - 渲染保费进度图表
  - （其他图表渲染方法待补充）
- **依赖**: echarts, /src/types/chart.types.ts
- **被依赖**: App.ts
- **状态**: ✅ 已拆分并实现（拆分为 charts 子模块）
- **相关任务**: #3.1-#3.9 图表渲染层
- **相关文档**: /docs/architecture.md#图表服务
- **代码位置**: /src/services/ChartService.ts
- **实现位置**:
  - /src/services/charts/ChartService.ts
  - /src/services/charts/BaseChartService.ts
  - /src/services/charts/ChartOptionBuilder.ts
  - /src/services/charts/AdvancedChartRenderer.ts
  - /src/services/charts/KpiCardRenderer.ts

---

---

## 已废弃服务（历史记录）

### ~~DataService.ts~~ - 数据服务（已删除）
- **废弃原因**: 已迁移至 DuckDB-WASM 架构
- **替代方案**: `src/shared/duckdb/client.ts` + `src/shared/duckdb/worker.ts`
- **删除日期**: 2026-02-04

### ~~FilterService.ts~~ - 筛选服务（已删除）
- **废弃原因**: 已迁移至 React Context + SQL WHERE 生成
- **替代方案**:
  - 状态管理: `src/shared/contexts/FilterContext.tsx`
  - SQL 生成: `src/shared/utils/queryBuilder.ts`
- **删除日期**: 2026-02-04

### ~~WorkerService.ts~~ - Worker 管理服务（已废弃）
- **废弃原因**: 旧 data.worker.ts 已删除
- **替代方案**: `src/shared/duckdb/worker.ts` (DuckDB-WASM Worker)

---

## 服务关系图（新架构）

```
App.tsx (React 入口)
  ├── FilterContext.tsx (筛选状态)
  ├── DataContext.tsx (数据状态)
  │     └── src/shared/duckdb/
  │           ├── client.ts (主线程客户端)
  │           └── worker.ts (DuckDB-WASM Worker)
  └── ChartService.ts (charts/ 子模块)
        ├── BaseChartService.ts
        ├── ChartOptionBuilder.ts
        └── KpiCardRenderer.ts
```

---

## 护栏规则

⚠️ **重要**：服务层涉及核心业务逻辑，任何修改必须：
1. 在 `/BACKLOG.md` 登记任务
2. 确保类型定义不破坏现有接口（`/src/types/`）
3. 确保业务配置映射正确（`/reference/`）
4. 在 `/PROGRESS.md` 记录变更详情，包括：
   - 文件变更（新建/修改/删除）
   - 关联代码（文件路径 + 行号）
   - 验收证据（类型检查、测试结果）
5. 同步更新本文件（README.md）

---

## 开发指南

### 新增服务
如需新增服务（如 ExportService.ts），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 创建类型定义（如需要，在 `/src/types/` 中新增）
3. 创建服务文件 `/src/services/NewService.ts`
4. 遵守 TypeScript 严格模式（禁止 `any`）
5. 添加 JSDoc 注释（公共 API 必须）
6. 编写单元测试（覆盖率 > 80%）
7. 更新本 README.md，添加服务条目
8. 更新 `/docs/00_index/CODE_INDEX.md`
9. 在 `/PROGRESS.md` 记录完成信息

### 修改现有服务
1. 查看 `/PROGRESS.md` 了解服务的历史变更
2. 在 `/BACKLOG.md` 登记任务
3. 如需修改接口，确保向后兼容或更新所有引用
4. 使用 `mcp__serena__find_referencing_symbols` 查找所有引用
5. 运行 `bun run type-check && bun run lint && bun run test`
6. 更新本 README.md 的服务描述（如有必要）
7. 在 `/PROGRESS.md` 记录变更详情

---

## 质量检查

运行以下命令确保代码质量：
```bash
# 类型检查
bun run type-check

# 代码规范检查
bun run lint

# 单元测试
bun run test

# 测试覆盖率
bun run test:coverage
```

---

## 相关链接

- **全局代码索引**: /docs/00_index/CODE_INDEX.md
- **类型定义**: /src/types/README.md
- **DuckDB 模块**: /src/shared/duckdb/README.md
- **业务配置**: /reference/README.md
- **架构文档**: /docs/architecture.md
- **开发进展**: /PROGRESS.md
- **任务清单**: /BACKLOG.md
- **协作规范**: /AGENTS.md

---

**最后更新**: 2026-02-04
**维护者**: All AI Agents
