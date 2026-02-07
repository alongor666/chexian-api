# AI 仪表盘功能模块规划

> 创建时间：2026-01-21
> 状态：IN_PROGRESS (Phase 1-4 已完成)
> 依赖：@json-render 库已集成 (PR #127)
> 最后更新：2026-01-21

### 已完成
- [x] Phase 1: 功能模块架构
- [x] Phase 2: 核心交互流程（与Phase 1合并实现）
- [x] Phase 3: 预设模板系统（与Phase 1合并实现）
- [x] Phase 4: AI 服务集成（OpenRouter API）

### 待实施
- [ ] Phase 5: 高级功能（可视化编辑、版本管理、导出）

---

## 概述

基于已集成的 `@json-render` 库，创建独立的 AI 仪表盘功能模块，允许用户通过自然语言生成车险数据分析界面。

---

## Phase 1: 功能模块架构 (预计 2h)

### 1.1 目录结构

```
src/features/ai-dashboard/
├── index.ts                    # 模块导出
├── AIDashboardPage.tsx         # 主页面组件
├── components/
│   ├── PromptInput.tsx         # 自然语言输入框
│   ├── UIPreview.tsx           # 生成结果预览
│   ├── HistoryPanel.tsx        # 历史记录面板
│   └── TemplateGallery.tsx     # 预设模板画廊
├── hooks/
│   ├── useAIGeneration.ts      # AI 生成 Hook
│   └── usePromptHistory.ts     # 历史记录管理
├── services/
│   ├── ai-client.ts            # AI API 客户端
│   └── template-service.ts     # 模板服务
├── types/
│   └── index.ts                # 类型定义
└── constants/
    └── templates.ts            # 预设模板
```

### 1.2 路由集成

```typescript
// src/app/routes.tsx
{ path: '/ai-dashboard', element: <AIDashboardPage /> }
```

### 1.3 侧边栏入口

```typescript
// 新增菜单项到 src/widgets/sidebar/
{
  id: 'ai-dashboard',
  label: 'AI 仪表盘',
  icon: Sparkles,
  path: '/ai-dashboard'
}
```

---

## Phase 2: 核心交互流程 (预计 3h)

### 2.1 用户流程

```
用户输入自然语言 → AI 理解意图 → 生成 UITree JSON → 渲染组件
        ↓
   "显示本月各机构保费排名"
        ↓
   AI 分析：需要 DataTable + BarChart
        ↓
   生成 UITree 结构
        ↓
   使用 catalog 组件渲染
```

### 2.2 提示词工程

```typescript
const systemPrompt = `
你是车险数据分析助手，基于以下组件目录生成 UI：

可用组件：
- Card: 容器卡片
- KpiCard: 指标卡片 (title, value, change, trend)
- DataTable: 数据表格 (columns, data)
- BarChart/LineChart/PieChart: 图表组件
- Grid: 网格布局 (cols: 1|2|3|4)
- Stack: 堆叠布局 (direction: row|column, gap)

数据上下文：
- 当前数据集包含 60万+ 保单记录
- 可用维度：机构、业务员、险别、客户类别、时间
- 可用指标：保费、件数、均价、续保率

请根据用户请求生成 JSON UITree 结构。
`;
```

### 2.3 数据绑定策略

| 绑定类型 | 实现方式 | 示例 |
|---------|---------|------|
| **静态数据** | 直接嵌入 UITree | `{ value: 12345 }` |
| **SQL 查询** | $sql 占位符 | `{ data: { $sql: "SELECT ..." } }` |
| **实时聚合** | $kpi 占位符 | `{ value: { $kpi: "totalPremium" } }` |

---

## Phase 3: 预设模板系统 (预计 2h)

### 3.1 模板分类

| 类别 | 模板名称 | 组件组合 |
|------|---------|---------|
| **概览** | 业绩总览 | 4x KpiCard + LineChart |
| **排名** | 机构排名 | DataTable + BarChart |
| **趋势** | 月度趋势 | LineChart + Grid |
| **对比** | 同比分析 | 2x KpiCard + BarChart |
| **明细** | 保单明细 | DataTable + 筛选器 |

### 3.2 模板结构

```typescript
interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  uiTree: UITree;
  requiredData: string[];  // 依赖的数据查询
}
```

---

## Phase 4: AI 服务集成 ✅ (已完成)

> 实现时间：2026-01-21
> 采用 OpenRouter 统一 API 网关，支持多种 AI 模型

### 4.1 实现的文件

```
src/features/ai-dashboard/services/
├── config.ts           # API 配置管理（localStorage 持久化）
└── openrouter.ts       # OpenRouter API 客户端

src/features/ai-dashboard/components/
└── ApiConfigDialog.tsx # API Key 配置弹窗
```

### 4.2 支持的模型（通过 OpenRouter）

| 模型 | ID | 提供商 |
|------|-------|--------|
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | Anthropic |
| Claude 3 Haiku | `anthropic/claude-3-haiku` | Anthropic |
| GPT-4o | `openai/gpt-4o` | OpenAI |
| GPT-4o Mini | `openai/gpt-4o-mini` | OpenAI |
| Gemini Pro 1.5 | `google/gemini-pro-1.5` | Google |
| Llama 3.1 70B | `meta-llama/llama-3.1-70b-instruct` | Meta |
| Qwen 2.5 72B | `qwen/qwen-2.5-72b-instruct` | Alibaba |

### 4.3 功能特性

- **API Key 测试**：配置后可立即验证有效性
- **模式切换**：AI 模式 / 模拟模式自动切换
- **错误处理**：JSON 解析失败、API 错误的友好提示
- **JSON 提取**：自动从 Markdown 代码块中提取 JSON
- **结构修复**：自动修复缺少 root 的 UITree

---

## Phase 5: 高级功能 (预计 4h)

### 5.1 实时编辑

- 可视化编辑生成的 UITree
- 拖拽调整布局
- 双击编辑属性

### 5.2 版本管理

```typescript
interface DashboardVersion {
  id: string;
  createdAt: Date;
  prompt: string;
  uiTree: UITree;
  thumbnail: string;
}
```

### 5.3 分享与导出

- 导出为 PNG/PDF
- 生成分享链接
- 嵌入代码片段

---

## 验收标准

| 阶段 | 验收条件 |
|------|---------|
| Phase 1 | 页面可访问，基础布局完成 |
| Phase 2 | 输入提示词可生成 UI |
| Phase 3 | 5+ 预设模板可用 |
| Phase 4 | 至少支持 1 个 AI 提供商 |
| Phase 5 | 编辑、版本、导出功能可用 |

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| AI 生成不稳定 | 预设模板兜底，多次重试 |
| 组件渲染错误 | 错误边界 + 降级显示 |
| 数据量过大 | 分页 + 虚拟滚动 |
| API 成本 | 本地缓存 + 用量限制 |

---

## 相关文档

- [json-render 集成代码](../../src/shared/json-render/)
- [组件目录定义](../../src/shared/json-render/catalog.ts)
- [技术栈说明](../../开发文档/TECH_STACK.md)
