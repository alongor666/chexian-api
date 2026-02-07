# AI 仪表盘：数据流可视化 + SQL 可编辑功能

## 需求背景

用户请求：**"把流程具像化，而且用户还可修改SQL"**

当前 AI 仪表盘的数据流程是隐藏的：
```
用户输入 → AI 生成 UITree(含SQL) → 执行SQL → 渲染UI
```

用户希望：
1. **可视化流程**：展示从输入到渲染的完整数据管道
2. **SQL 可编辑**：允许用户查看和修改生成的 SQL 查询

---

## 设计方案

### 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI 仪表盘页面                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌────────────────────────────────────────┐  │
│  │   侧边栏     │   │              主工作区                    │  │
│  │  (历史/模板) │   │  ┌────────────────────────────────────┐ │  │
│  │              │   │  │         提示词输入区                 │ │  │
│  │              │   │  └────────────────────────────────────┘ │  │
│  │              │   │  ┌────────────────────────────────────┐ │  │
│  │              │   │  │    【新增】数据流面板 (可折叠)       │ │  │
│  │              │   │  │  ┌──────┐ ┌──────┐ ┌──────┐        │ │  │
│  │              │   │  │  │输入  │→│SQL   │→│执行  │→ 渲染  │ │  │
│  │              │   │  │  └──────┘ └──────┘ └──────┘        │ │  │
│  │              │   │  │  [展开查看/编辑 SQL 详情]            │ │  │
│  │              │   │  └────────────────────────────────────┘ │  │
│  │              │   │  ┌────────────────────────────────────┐ │  │
│  │              │   │  │         UI 预览区                   │ │  │
│  │              │   │  │     (渲染后的仪表盘)                 │ │  │
│  │              │   │  └────────────────────────────────────┘ │  │
│  └──────────────┘   └────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

#### 1. DataFlowPanel（数据流面板）

**位置**：`src/features/ai-dashboard/components/DataFlowPanel.tsx`

**功能**：
- 展示 4 个流程步骤的可视化连线图
- 每个步骤显示状态（待处理/进行中/完成）
- 点击 SQL 步骤可展开查看所有 SQL 查询

**Props**：
```typescript
interface DataFlowPanelProps {
  /** 原始输入提示词 */
  prompt: string | null;
  /** 生成的 UITree（含 SQL） */
  uiTree: UITree | null;
  /** 当前阶段 */
  stage: 'idle' | 'generating' | 'executing' | 'rendered';
  /** SQL 编辑回调 */
  onSqlEdit: (elementKey: string, newSql: string) => void;
  /** 是否展开 */
  expanded?: boolean;
  /** 切换展开 */
  onToggleExpand?: () => void;
}
```

#### 2. SqlQueryList（SQL 查询列表）

**位置**：`src/features/ai-dashboard/components/SqlQueryList.tsx`

**功能**：
- 从 UITree 中提取所有包含 `props.sql` 的元素
- 以列表形式展示每个查询的：组件名称、SQL 内容、执行状态
- 支持单个 SQL 的编辑（弹窗模态框）

**Props**：
```typescript
interface SqlQueryListProps {
  /** UITree 数据 */
  uiTree: UITree;
  /** SQL 编辑回调 */
  onEdit: (elementKey: string, newSql: string) => void;
  /** 执行状态映射 */
  executionStatus?: Record<string, 'pending' | 'running' | 'success' | 'error'>;
}
```

#### 3. SqlEditDialog（SQL 编辑弹窗）

**位置**：`src/features/ai-dashboard/components/SqlEditDialog.tsx`

**功能**：
- Monaco 编辑器（复用 `SqlEditor` 组件）
- 实时预览执行结果
- 保存/取消按钮

**Props**：
```typescript
interface SqlEditDialogProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 元素 key */
  elementKey: string;
  /** 当前 SQL */
  sql: string;
  /** 组件类型（用于显示） */
  componentType: string;
  /** 保存回调 */
  onSave: (newSql: string) => void;
  /** 关闭回调 */
  onClose: () => void;
}
```

---

## 实施步骤

### Step 1: 创建数据流面板组件

**文件**：`src/features/ai-dashboard/components/DataFlowPanel.tsx`

```typescript
// 流程步骤可视化
// 1. 输入 → 2. 生成SQL → 3. 执行 → 4. 渲染
// 使用 Lucide 图标 + 连线动画
```

### Step 2: 创建 SQL 查询列表组件

**文件**：`src/features/ai-dashboard/components/SqlQueryList.tsx`

```typescript
// 从 UITree 提取 SQL
// 显示每个查询的组件名、SQL 预览、状态
// 提供编辑按钮
```

### Step 3: 创建 SQL 编辑弹窗组件

**文件**：`src/features/ai-dashboard/components/SqlEditDialog.tsx`

```typescript
// 复用 SqlEditor 组件
// 添加预览执行功能
// 保存时触发回调
```

### Step 4: 扩展 useAIGeneration Hook

**文件**：`src/features/ai-dashboard/hooks/useAIGeneration.ts`

新增方法：
```typescript
/** 更新 UITree 中的 SQL 并重新执行 */
updateSqlAndRefresh: (elementKey: string, newSql: string) => Promise<void>
```

逻辑：
1. 深拷贝 UITree
2. 找到对应元素，更新 `props.sql`
3. 调用 `executeUITreeSql()` 重新执行
4. 更新 state.uiTree

### Step 5: 修改主页面集成

**文件**：`src/features/ai-dashboard/AIDashboardPage.tsx`

变更：
1. 添加 `dataFlowExpanded` 状态
2. 在输入区域和预览区域之间插入 `<DataFlowPanel />`
3. 传递必要的 props

### Step 6: 导出组件索引

**文件**：`src/features/ai-dashboard/components/index.ts`

添加新组件导出。

---

## 关键文件清单

| 操作 | 文件路径 |
|------|----------|
| 新增 | `src/features/ai-dashboard/components/DataFlowPanel.tsx` |
| 新增 | `src/features/ai-dashboard/components/SqlQueryList.tsx` |
| 新增 | `src/features/ai-dashboard/components/SqlEditDialog.tsx` |
| 修改 | `src/features/ai-dashboard/hooks/useAIGeneration.ts` |
| 修改 | `src/features/ai-dashboard/AIDashboardPage.tsx` |
| 修改 | `src/features/ai-dashboard/components/index.ts` |

---

## 验证方案

### 功能验证

1. **数据流可视化**
   - [ ] 页面加载后显示"等待输入"状态
   - [ ] 输入提示词后，流程图更新为"生成中"
   - [ ] SQL 执行时，流程图更新为"执行中"
   - [ ] 渲染完成后，流程图显示"完成"

2. **SQL 查看**
   - [ ] 展开数据流面板可看到所有 SQL 查询列表
   - [ ] 每个 SQL 显示对应的组件名称和 SQL 内容

3. **SQL 编辑**
   - [ ] 点击 SQL 项的编辑按钮打开弹窗
   - [ ] Monaco 编辑器正确显示 SQL
   - [ ] 修改 SQL 后点击"预览"可执行并查看结果
   - [ ] 点击"保存"后，UI 预览区域自动更新

### 测试命令

```bash
# 运行单元测试
bun test

# 启动开发服务器
bun run dev

# 类型检查
bun run build
```

### 浏览器实测检查点

1. 访问 `/ai-dashboard`
2. 选择"业绩总览"模板
3. 观察数据流面板显示 4 个步骤
4. 展开查看 4 个 KPI 的 SQL
5. 编辑"总保费"的 SQL，添加 `WHERE insurance_type = '商业保险'`
6. 保存后确认 KPI 卡片数值更新为商业险保费

---

## 依赖分析

### 可复用组件
- `SqlEditor` - Monaco SQL 编辑器（来自 sql-query 功能模块）
- `useQueryExecutor` - SQL 执行 Hook

### 新增依赖
- 无需新增外部依赖

### 样式依赖
- 使用现有 `@/shared/styles` 中的样式
- 使用 Lucide 图标库

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| SQL 编辑后执行失败 | 保留原始 SQL，支持回滚；显示友好错误提示 |
| 大量 SQL 导致列表过长 | 添加折叠/展开功能；限制初始显示数量 |
| Monaco 编辑器加载慢 | 使用 lazy loading；显示加载占位符 |

---

## 预估工作量

| 步骤 | 描述 |
|------|------|
| Step 1 | DataFlowPanel 组件 |
| Step 2 | SqlQueryList 组件 |
| Step 3 | SqlEditDialog 组件 |
| Step 4 | useAIGeneration 扩展 |
| Step 5 | 主页面集成 |
| Step 6 | 测试验证 |
