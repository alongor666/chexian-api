# 共享逻辑层 (Shared Layer)

**职责**：提供业务无关的通用逻辑、数据处理、SQL生成、类型定义。

## 子模块

| 模块 | 路径 | 职责 | 文档 |
|------|------|------|------|
| DuckDB | `duckdb/` | DuckDB-WASM 客户端、Worker 通信、Arrow IPC | [README](./duckdb/README.md) |
| Normalize | `normalize/` | 列名映射、数据校验、质量检查 | [README](./normalize/README.md) |
| SQL | `sql/` | KPI/TopN/Table SQL 模板生成 | [README](./sql/README.md) |
| Types | `types/` | TypeScript 类型定义 | 无独立文档 |
| Utils | `utils/` | 通用工具函数（日志、导出、安全等） | 无独立文档 |
| Cache | `cache/` | LRU查询缓存（性能优化、智能淘汰） | [README](./cache/README.md) |
| Hooks | `hooks/` | React 自定义 Hooks（状态管理、数据获取） | 无独立文档 |
| Contexts | `contexts/` | React Context（全局状态共享） | 无独立文档 |
| Config | `config/` | 全局配置（图表样式、部署配置） | 无独立文档 |
| Export | `export/` | PDF/PPT导出引擎（图表截图、报告生成） | [README](./export/README.md) |
| Theme | `theme/` | 主题系统（浅色/深色/随系统模式切换） | 无独立文档 |
| UI | `ui/` | 基础 UI 组件库（Card/Button/Badge/Input/Select/Table/Icon/Skeleton） | 见下方详细说明 |
| Styles | `styles/` | 统一设计系统（颜色/字体/间距/状态/工具函数） | 见下方详细说明 |

## 关键入口文件

### DuckDB 模块
- **`duckdb/client.ts`**: 主线程 DuckDB 客户端（RPC、请求管理、Arrow 解码）
- **`duckdb/worker.ts`**: Worker 线程 DuckDB 执行器（SQL 查询、Arrow 编码）

### Normalize 模块
- **`normalize/mapping.ts`**: 列名别名映射（支持中英文、多别名）
- **`normalize/validator.ts`**: 数据类型验证、数据质量检查

### SQL 模块
- **`sql/kpi.ts`**: KPI/TopN/Table SQL 生成器（业务规则封装）
- **`sql/trend.ts`**: 趋势分析 SQL 生成器（时间序列）
- **`sql/truck.ts`**: 营业货车专项分析 SQL 生成器（吨位分段、占比计算）
- **`sql/perspective-adapter.ts`**: 视角SQL适配层（支持保费/商业险件数/交强险件数视角切换）
- **`sql/salesman-ranking.ts`**: 业务员排名 SQL 生成器（全部业务 Top10 + 优质业务 Top10）
- **`sql/cost.ts`**: 成本分析 SQL 生成器（赔付率/费用率/综合费用率/变动成本率/已赚保费，满期计算+三段分解公式）

### Types 模块
- **`types/index.ts`**: 类型定义统一导出
- **`types/duckdb.ts`**: Worker 通信协议类型定义
- **`types/sql-query.ts`**: SQL 查询功能类型定义（模板、结果、历史）
- **`types/data.ts`**: 核心数据类型定义（KPI、趋势、表格、筛选器等）
- **`types/echarts.ts`**: ECharts 事件/tooltip 参数类型定义
- **`types/view-perspective.ts`**: 视角类型定义（保费/商业险件数/交强险件数）
- **`types/alert.ts`**: 预警系统类型定义（预警级别/类型/规则/消息/摘要/目标进度）

### Hooks 模块
- **`hooks/index.ts`**: 自定义 Hooks 统一导出
- **`hooks/useLoadingStates.ts`**: 统一管理多个 loading 状态
- **`hooks/useDataFetch.ts`**: 通用数据获取 Hook（自动管理 loading/error 状态）

### Contexts 模块
- **`contexts/DataContext.tsx`**: 数据加载状态 Context（Provider + useDataStatus Hook）
- **`contexts/FilterContext.tsx`**: 全局筛选器状态 Context（Provider + useGlobalFilters Hook，支持跨页面筛选共享）
- **`contexts/PermissionContext.tsx`**: 用户权限认证 Context（Provider + usePermission/useVisibleOrganizations Hook，支持分公司管理员/三级机构用户两种角色）

### Utils 模块
- **`utils/logger.ts`**: 统一日志服务（分级日志、上下文管理、生产环境优化）
- **`utils/export.ts`**: CSV/Excel 导出工具（Table → 文件）
- **`utils/security.ts`**: 安全限制常量（SQL长度、超时、行数限制）
- **`utils/sql-validator.ts`**: SQL 安全验证器（只读+聚合+边界检查）
- **`utils/formatters.ts`**: 统一格式化工具（保费/占比/数值）
- **`utils/queryBuilder.ts`**: 高级筛选 WHERE 子句构建器（多维度过滤）
- **`utils/size-sensor.ts`**: size-sensor 安全兼容层（避免 ResizeObserver 清理异常）
- **`utils/echarts.ts`**: ECharts 按需导入注册（图表组件与渲染器）
- **`utils/alertChecker.ts`**: 预警检测引擎（增长率下降/目标落后/续保率下降/保费波动检测）
- **`utils/storage.ts`**: 安全 localStorage 封装（隐私模式兼容、错误处理、内存后备）

### Config 模块
- **`config/chartStyles.ts`**: 图表样式配置（颜色、字体、轴样式）
- **`config/deploy.ts`**: 部署配置（内网模式、自动加载、数据URL）
- **`config/organizations.ts`**: 机构和权限配置（12个三级机构、用户角色BRANCH_ADMIN/ORG_USER、权限判断函数）

### Export 模块
- **`export/types.ts`**: 导出类型定义（ExportFormat/ExportConfig/ExportContent/ExportProgress）
- **`export/chartCapture.ts`**: 图表截图工具（html2canvas/ECharts getDataURL）
- **`export/pdfExporter.ts`**: PDF报告生成器（jsPDF + jspdf-autotable）
- **`export/index.ts`**: 统一导出接口（仅支持 PDF 格式）

### Theme 模块
- **`theme/ThemeContext.tsx`**: 主题 Context（ThemeProvider + useTheme Hook）
- **`theme/index.ts`**: 模块导出入口

## 禁止触碰区域

以下文件涉及业务口径定义，修改需产品确认 + BACKLOG 登记：

| 文件 | 原因 | 如需变更 |
|------|------|----------|
| `normalize/mapping.ts` | 列名映射规则（指标口径） | 只能追加新别名，需 BACKLOG 证据 |
| `sql/kpi.ts` | KPI 计算逻辑（业务规则） | 只能追加新模板，需 BACKLOG 证据 |
| `duckdb/client.ts:78-95` | PolicyFact 视图定义（去重规则） | 涉及业务口径，需产品确认 |

## 数据流

```
用户上传 Parquet
  ↓
duckdb/client.ts:loadParquet()              # 1. 加载文件到 Worker
  ↓
normalize/validator.ts:validateSchema()      # 2. 校验列名（别名解析）
  ↓
duckdb/client.ts:createPolicyFactView()     # 3. 创建去重视图（MAX 聚合）
  ↓
sql/kpi.ts:generateKpiSQL()                 # 4. 生成 SQL（应用业务规则）
  ↓
duckdb/worker.ts:query()                    # 5. 执行查询（返回 Arrow IPC）
  ↓
duckdb/client.ts:query()                    # 6. 解码 Arrow（返回 Table）
  ↓
features/dashboard/Dashboard.tsx             # 7. UI 渲染
```

## 链接到全局索引

- **代码索引**: [CODE_INDEX](../../开发文档/00_index/CODE_INDEX.md) - 核心模块入口
- **文档索引**: [DOC_INDEX](../../开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档

---

**变更规则**：
- 新增子模块：必须创建 README.md 并在此处登记。
- 修改禁止区域：必须在 BACKLOG.md 登记需求并提供证据链。

## 新增 SQL 生成器登记（续保分析）

- **`sql/renewal.ts`**: 续保专项分析 SQL 生成器
  - `generateRenewalKpiQuery`: 续保KPI查询（整体续保率）
  - `generateRenewalTrendQuery`: 续保趋势查询（按日/周/月）
  - `generateRenewalRankingQuery`: 续保排名查询（按业务员和机构）
  - `generateExpiringPoliciesQuery`: 到期预警查询（未来30天）
  - `generateSuccessfulRenewalQuery`: 续保单号关联查询（历史对比）
  - `generateRenewalRateByOrgMonthQuery`: **分机构月度续保率排名查询**（三种续保率：当日/当月/当年，支持闰年自动处理）

## 变更记录

- **`sql/truck.ts`**: 营业货车专项分析 SQL 生成器支持视角切换（保费/商业险件数/交强险件数）
- **`sql/renewal.ts`**: 续保明细表格查询支持视角切换与商业险/交强险口径过滤
- **`utils/queryBuilder.ts`**: 高级筛选新增 renewal_mode 多选过滤（支持 IS NULL 场景）；新增权限过滤函数 buildPermissionWhereClause 和 buildWhereClauseWithPermission
- **`types/data.ts`**: AdvancedFilterState/FilterOptions 增加 renewal_mode 字段
- **`config/organizations.ts`**: 新增机构和权限配置模块（12个三级机构、BRANCH_ADMIN/ORG_USER角色、权限判断函数）
- **`contexts/PermissionContext.tsx`**: 新增用户权限认证 Context（PermissionProvider + usePermission/useVisibleOrganizations Hooks）
- **`sql/renewal.ts`**: 续保明细表格查询改为按目标年月生成日期序列，并输出月日/当日/当月/当年续保字段

## UI 组件库（`ui/`）

提供项目通用的基础 UI 组件，确保样式一致性。所有功能模块应优先使用这些组件。

### 组件清单

| 组件 | 文件 | 说明 |
|------|------|------|
| Card | `Card.tsx` | 卡片容器组件（default/interactive/flat/elevated 变体） |
| StatCard | `Card.tsx` | 统计数值卡片（带趋势指示） |
| Button | `Button.tsx` | 按钮组件（primary/secondary/ghost/danger/success/link 变体） |
| IconButton | `Button.tsx` | 图标按钮（仅图标） |
| ButtonGroup | `Button.tsx` | 按钮组 |
| Badge | `Badge.tsx` | 徽章/标签组件（default/primary/success/warning/danger/outline 变体） |
| StatusBadge | `Badge.tsx` | 状态徽章（预设状态样式） |
| CountBadge | `Badge.tsx` | 计数徽章 |
| Input | `Input.tsx` | 输入框组件（支持前缀/后缀/清空按钮） |
| SearchInput | `Input.tsx` | 搜索输入框 |
| PasswordInput | `Input.tsx` | 密码输入框 |
| TextArea | `Input.tsx` | 文本域 |
| FormItem | `Input.tsx` | 表单项包装器 |
| Select | `Select.tsx` | 选择器组件 |
| NativeMultiSelect | `Select.tsx` | 原生多选框 |
| Table | `Table.tsx` | 表格组件（排序/固定表头/斑马纹） |
| NumericCell | `Table.tsx` | 数值单元格（右对齐等宽字体） |
| TrendCell | `Table.tsx` | 趋势单元格（带颜色指示） |
| StatusCell | `Table.tsx` | 状态单元格（带圆点） |
| Icon | `Icon.tsx` | 图标组件（基于 lucide-react） |
| Skeleton | `Skeleton.tsx` | 骨架屏组件 |
| KpiCardSkeleton | `Skeleton.tsx` | KPI 卡片骨架屏 |
| TableSkeleton | `Skeleton.tsx` | 表格骨架屏 |
| DashboardSkeleton | `Skeleton.tsx` | 仪表盘页面骨架屏 |

### 使用示例

```tsx
import { Card, Button, Badge, Input, Table, cn } from '@/shared/ui';

// 基础卡片
<Card title="标题" subtitle="描述" extra={<Button>操作</Button>}>
  内容
</Card>

// 统计卡片
<StatCard title="总保费" value="¥1,234,567" trend="up" trendValue="12.5%" />

// 按钮
<Button variant="primary" leftIcon={<PlusIcon />}>新增</Button>

// 徽章
<Badge variant="success" dot>在线</Badge>

// 表格
<Table
  columns={[
    { key: 'name', title: '姓名', dataIndex: 'name', sortable: true },
    { key: 'premium', title: '保费', dataIndex: 'premium', align: 'right' },
  ]}
  dataSource={data}
  rowKey="id"
/>
```

## 统一设计系统（`styles/`）

基于 `tailwind.config.js` 中定义的设计令牌，提供类型安全的样式常量和工具函数。

### 设计令牌

| 类别 | 说明 |
|------|------|
| `colors` | 颜色系统（primary/success/warning/danger/neutral） |
| `spacing` | 间距系统（xs/sm/md/lg/xl/2xl/3xl） |
| `fontSize` | 字体大小系统（xs/sm/base/lg/xl/2xl/3xl/4xl） |
| `borderRadius` | 圆角系统（sm/md/lg/xl/2xl/full） |
| `boxShadow` | 阴影系统（sm/md/lg/xl/card/dropdown） |

### 组件样式常量

| 常量 | 说明 |
|------|------|
| `cardStyles` | 卡片样式（base/interactive/compact/standard/spacious） |
| `buttonStyles` | 按钮样式（primary/secondary/ghost/danger/success/link） |
| `badgeStyles` | 徽章样式（default/primary/success/warning/danger/outline） |
| `inputStyles` | 输入框样式（default/error/disabled） |
| `tableStyles` | 表格样式（container/header/headerCell/row/cell） |
| `textStyles` | 文本样式（titleLarge/titleMedium/body/caption/label/link） |
| `layoutStyles` | 布局样式（container/flexCenter/flexBetween/grid2/grid3/grid4） |

### 工具函数

| 函数 | 说明 |
|------|------|
| `cn(...classes)` | 合并多个 className |
| `conditionalStyle(condition, trueStyle, falseStyle)` | 条件样式 |
| `getTrendColorClass(value, inverse)` | 获取趋势颜色类（正/负/中性） |
| `getStatusColorClass(status)` | 获取状态颜色类 |
| `getStatusBgClass(status)` | 获取状态背景颜色类 |

### 使用示例

```tsx
import { cn, cardStyles, getTrendColorClass, colors } from '@/shared/styles';

// 合并类名
<div className={cn(cardStyles.base, 'mt-4', isActive && 'ring-2 ring-primary')}>

// 趋势颜色
<span className={getTrendColorClass(growthRate)}>
  {growthRate > 0 ? '+' : ''}{growthRate}%
</span>

// 直接使用颜色值
<div style={{ backgroundColor: colors.primary.bg }}>
```

## 2026-02 API-only 权威说明（新增）

以下内容为当前运行事实，优先级高于本文历史段落：

- 前端不再包含 `src/shared/duckdb/*` 运行链路。
- 数据查询统一入口：`src/shared/api/client.ts` → 后端 `/api/*`。
- 业务类型与上下文以 `src/shared/types/*`、`src/shared/contexts/*` 为准。
- 样式规范以 `src/shared/styles/index.ts` 与 `src/shared/ui/*` 为准。

如历史段落出现 `DuckDB-WASM`、`src/shared/duckdb/*` 等描述，视为历史记录，不代表当前架构。

## 2026-02-27 业务员姓名展示规则补充

- `utils/formatters.ts`：`formatSalesmanName` 升级为全局统一规则（仅保留中文名；移除数字/英文ID；`admin` 统一显示为 `直接个代`）。
