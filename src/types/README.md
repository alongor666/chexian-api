# /src/types/ - 类型定义索引

> **说明**：本文件夹包含所有 TypeScript 类型定义，是项目的类型系统基础。

---

## 🔒 护栏规则（CRITICAL）

⚠️ **禁止破坏性变更**：类型定义属于护栏保护范围，**禁止**以下操作：
1. **禁止重命名**现有类型、接口、字段
2. **禁止删除**现有类型、接口、字段
3. **禁止修改**现有字段的口径（如从可选改为必填）

✅ **允许的操作**：
1. **追加**新类型、新接口、新字段（不影响现有代码）
2. **扩展**现有类型（使用 `extends`、`Partial`、`Pick` 等）
3. **添加注释**和 JSDoc 文档

⚠️ **若必须进行破坏性变更**：
1. 在 `/BACKLOG.md` 登记任务，优先级设为 **P0**
2. 提供**充分的证据**（如需求文档、业务规则变更说明）
3. 使用 `mcp__serena__find_referencing_symbols` 查找所有引用
4. 创建迁移计划（`/docs/decisions/migration-plan-YYYYMMDD.md`）
5. 在 `/PROGRESS.md` 详细记录变更和影响范围

---

## 类型文件清单

### data.types.ts - 数据类型定义
- **用途**: 定义原始数据行、聚合数据、KPI 指标等核心数据结构
- **核心类型**:
  - `RawDataRow` - CSV/Excel 原始数据行（13 个筛选维度 + 核心业务字段）
  - `AggregatedData` - 聚合后的数据结构
  - `KPIMetrics` - KPI 指标（8 个核心指标）
  - `BusinessTypeMapping` - 业务类型映射配置
- **被依赖**: DuckDB 客户端, SQL 生成器, 功能模块
- **状态**: ✅ 已完成
- **相关任务**: #2.1 TypeScript 类型定义
- **相关配置**: /reference/business_type_mapping.json
- **代码位置**: /src/types/data.types.ts

---

### filter.types.ts - 筛选类型定义
- **用途**: 定义筛选器状态、筛选维度、筛选选项等
- **核心类型**:
  - `FilterState` - 筛选器状态（包含 13 个维度的筛选条件）
  - `TimeRange` - 时间范围筛选
  - `FilterDimension` - 筛选维度枚举
  - `FilterOptions` - 筛选选项（动态生成的可选值列表）
  - `DrillDownFilter` - 钻取筛选（AND 逻辑）
- **被依赖**: FilterContext, 筛选组件, SQL 生成器
- **状态**: ✅ 已完成
- **相关任务**: #2.1 TypeScript 类型定义
- **代码位置**: /src/types/filter.types.ts

---

### chart.types.ts - 图表类型定义
- **用途**: 定义图表配置、图表数据结构、图表主题等
- **核心类型**:
  - `ChartConfig` - 图表配置（ECharts option）
  - `ChartData` - 图表数据结构
  - `ChartTheme` - 图表主题配置
  - `KPICardData` - KPI 卡片数据
  - `StackedBarChartData` - 堆积柱状图数据
  - （其他图表类型待补充）
- **被依赖**: ChartService.ts
- **状态**: 🚧 骨架已创建，待补充
- **相关任务**: #2.1 TypeScript 类型定义, #3.1-#3.9 图表渲染层
- **代码位置**: /src/types/chart.types.ts

---

## 类型依赖关系图

```
/src/types/
  ├── data.types.ts
  │     └── 被依赖: DuckDB 客户端, SQL 生成器, 功能模块
  ├── filter.types.ts
  │     ├── 依赖: data.types.ts
  │     └── 被依赖: FilterContext, 筛选组件, SQL 生成器
  └── chart.types.ts
        ├── 依赖: data.types.ts
        └── 被依赖: ChartService, 图表组件
```

> ⚠️ **架构变更说明（2026-02-04）**：
> - 旧服务（DataService, FilterService）已废弃
> - 数据处理迁移至 `src/shared/duckdb/` (DuckDB-WASM)
> - 状态管理迁移至 `src/shared/contexts/FilterContext.tsx`

---

## 类型命名规范

### 接口命名
- 数据实体：使用名词，如 `RawDataRow`, `KPIMetrics`
- 配置对象：使用 `Config` 后缀，如 `ChartConfig`, `FilterConfig`
- 选项对象：使用 `Options` 后缀，如 `FilterOptions`, `AggregationOptions`

### 类型别名命名
- 联合类型：使用 `Type` 后缀，如 `FilterDimensionType`, `ChartType`
- 泛型类型：使用 `T`, `K`, `V` 等单字母，如 `Record<K, V>`

### 枚举命名
- 使用 PascalCase，如 `FilterDimension`, `ChartType`
- 枚举成员使用 UPPER_SNAKE_CASE，如 `FILTER_DIMENSION.ORG_LEVEL_1`

---

## 开发指南

### 新增类型文件
如需新增类型文件（如 ui.types.ts），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 创建类型文件 `/src/types/new.types.ts`
3. 添加文件头注释：
   ```typescript
   /**
    * @file new.types.ts
    * @description [用途描述]
    * @author [AI Agent Name]
    * @created YYYY-MM-DD
    * @related /docs/requirements/[需求文档].md
    */
   ```
4. 所有导出类型必须有 JSDoc 注释
5. 运行 `bun run type-check` 确保无错误
6. 更新本 README.md，添加类型文件条目
7. 更新 `/docs/00_index/CODE_INDEX.md`
8. 在 `/PROGRESS.md` 记录完成信息

### 扩展现有类型
如需扩展现有类型（如为 `RawDataRow` 添加新字段），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 提供证据（如业务需求、配置文件变更）
3. 使用 `mcp__serena__find_referencing_symbols` 查找类型引用
4. 评估影响范围（哪些服务、组件会受影响）
5. 进行扩展（仅追加，不删除不改名）：
   ```typescript
   export interface RawDataRow {
     // 现有字段...
     newField?: string; // 新增字段（可选）
   }
   ```
6. 运行 `bun run type-check` 确保无破坏性变更
7. 更新本 README.md 的类型描述
8. 在 `/PROGRESS.md` 记录变更详情

### 破坏性变更（极少情况）
如果**必须**进行破坏性变更：
1. 创建迁移计划：`/docs/decisions/migration-YYYYMMDD-[主题].md`
2. 记录变更原因、影响范围、迁移步骤
3. 使用版本化类型（如 `RawDataRowV2`）逐步迁移
4. 保留旧类型标记为 `@deprecated`
5. 在 `/PROGRESS.md` 详细记录迁移过程

---

## 质量检查

运行以下命令确保类型定义质量：
```bash
# 类型检查（最重要）
bun run type-check

# 代码规范检查
bun run lint

# 查找类型引用
# 使用 mcp__serena__find_referencing_symbols 工具
```

---

## 相关链接

- **全局代码索引**: /docs/00_index/CODE_INDEX.md
- **业务配置**: /reference/README.md (类型定义的数据来源)
- **服务层**: /src/services/README.md (类型的使用者)
- **架构文档**: /docs/architecture.md#类型系统
- **开发进展**: /PROGRESS.md
- **任务清单**: /BACKLOG.md
- **协作规范**: /AGENTS.md

---

**最后更新**: 2026-02-04
**维护者**: All AI Agents

**重要提醒**：类型定义是项目的契约，修改前请三思！
