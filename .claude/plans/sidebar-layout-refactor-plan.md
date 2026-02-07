# 车险经营管理系统 - 页面布局与体验流程重构方案

## 📋 项目背景

### 当前状态
- 单页应用，使用 HashRouter
- 所有功能集中在 PremiumDashboard 组件的标签页中
- 没有独立的 Layout 组件
- 数据导入功能集成在 Dashboard 中

### 目标
重构为专业的数据分析平台，提供清晰的信息架构和流畅的用户体验

---

## 🎯 需求分析

### 一级菜单结构
```
┌─────────────────────────────────────────────┐
│  车险经营管理系统                    [设置▼] [文件▼] [数据▼]  │
└─────────────────────────────────────────────┘
```

### 菜单层级
1. **设置**
   - 背景（深色/浅色/随系统）
   - 权限

2. **文件**
   - 导入数据
   - 导出PDF报告
   - 报表模板

3. **数据** - 标签页形式
   - 仪表盘（综合分析）
   - 达成分析（待集成）
   - 增长分析
   - 成本分析
   - 续保分析（续保专项）
   - 系数监控
   - 数据对比

### 首页流程
用户首次进入 → 数据导入页面 → 导入成功 → 跳转到数据标签页

---

## 💡 头脑风暴方案

### ✅ 用户选择：方案B - 现代侧边栏布局

#### 布局结构
```
┌────────────────────────────────────────────────────┐
│  🚗 车险经营管理系统 v2.0              [⚙️ 设置] [📁 文件]  │
├──────┬─────────────────────────────────────────────┤
│  🏠 │                                              │
│  📊 │              主内容区                        │
│  🎯 │             (动态渲染)                        │
│  📈 │                                              │
│  💰 │                                              │
│  🔄 │                                              │
│  🔍 │                                              │
│  ⚖️ │                                              │
│      │                                              │
│ ▼    │                                              │
└──────┴─────────────────────────────────────────────┘
```

#### 侧边栏菜单结构
```
🏠 首页（数据导入）
─────────────
📊 仪表盘（综合分析）
🎯 达成分析
📈 增长分析
💰 成本分析
🔄 续保分析
🔍 系数监控
⚖️ 数据对比
─────────────
[收起侧边栏 ▼]
```

#### 特点
- ✅ 现代化设计，数据类应用常用布局（类似Tableau、PowerBI）
- ✅ 侧边栏可收起，节省屏幕空间
- ✅ 一级菜单（首页+数据模块）视觉分离明显
- ✅ 左侧固定导航，右侧内容滚动，符合数据分析应用习惯
- ✅ 支持快速切换不同分析视图

---

### 方案 A：经典顶部导航（备选）

#### 布局结构
```
┌────────────────────────────────────────────────────┐
│  🚗 车险经营管理系统                         [设置] [文件] [数据] │
├────────────────────────────────────────────────────┤
│                                                      │
│                    主内容区                          │
│                   (动态渲染)                         │
│                                                      │
└────────────────────────────────────────────────────┘
```

**特点**：信息架构清晰，符合传统桌面应用习惯，路由语义化

---

### 方案 C：沉浸式首页（备选）

**特点**：首页沉浸式体验，导入后界面切换明显，强调流程感

---

## 🎨 详细设计方案（基于方案B - 现代侧边栏）

### 核心设计理念
- **侧边栏导航**：固定左侧，展示所有数据分析模块，快速切换
- **查询助理集成**：每个数据标签页内置"查询助理"（NL2SQL），支持自然语言查询
- **报表模板移至文件菜单**：作为「文件」菜单的二级选项
- **首页独立**：专注于数据导入，大卡片设计，流程清晰

### 阶段 1：布局框架重构

#### 1.1 创建侧边栏布局组件
**文件**: `src/components/layout/SidebarLayout.tsx`

```typescript
interface SidebarLayoutProps {
  children: React.ReactNode;
}

// 功能：
// - 左侧固定侧边栏（240px宽，可收起至60px）
// - 顶部导航栏（项目名称 + 设置/文件菜单）
// - 右侧内容区（自适应宽度）
// - 响应式设计（移动端自动收起）
```

#### 1.2 侧边栏导航组件
**文件**: `src/components/layout/SidebarNavigation.tsx`

```typescript
// 功能：
// - 首页入口（数据导入）
// - 数据模块菜单列表（仪表盘、达成、增长、成本、续保、系数、对比）
// - 当前激活状态高亮
// - 收起/展开切换
// - 图标 + 文字标签
```

#### 1.3 顶部导航栏组件
**文件**: `src/components/layout/TopNavigation.tsx`

```typescript
// 功能：
// - 项目名称展示（左侧）
// - 设置下拉菜单（右侧）
// - 文件下拉菜单（右侧）
```

#### 1.4 首页导入组件
**文件**: `src/features/home/DataImportPage.tsx`

```typescript
// 功能：
// - 大卡片式文件上传区（600x400px）
// - 拖拽上传支持
// - 快捷操作（查看报表模板、系统设置）
// - 最近文件列表（最近5个文件）
// - 导入历史记录
```

### 阶段 2：路由重构

#### 2.1 新路由结构
**文件**: `src/app/App.tsx`

```typescript
<Routes>
  <Route path="/" element={<SidebarLayout />}>
    <Route index element={<DataImportPage />} />
    <Route path="dashboard" element={<DashboardPage />} />
    <Route path="achievement" element={<AchievementPage />} />
    <Route path="growth" element={<GrowthPage />} />
    <Route path="cost" element={<CostPage />} />
    <Route path="renewal" element={<RenewalPage />} />
    <Route path="coefficient" element={<CoefficientPage />} />
    <Route path="compare" element={<ComparePage />} />
  </Route>
</Routes>
```

#### 2.2 数据页面结构
**文件**: `src/features/dashboard/DashboardPage.tsx`（其他类似）

```typescript
// 功能：
// - 顶部筛选器面板（复用 AdvancedFilterPanel）
// - 主内容区（图表、表格、分析结果）
// - 右下角"查询助理"按钮（展开NL2SQL面板）
```

### 阶段 3：组件迁移与重组

#### 3.1 页面组件映射
| 新页面 | 现有组件 | 操作 |
|-------|---------|------|
| 首页 | - | 新建 |
| 仪表盘 | PremiumDashboard - 综合分析 Tab | 迁移 |
| 达成分析 | - | 新建（待集成） |
| 增长分析 | PremiumDashboard - 增长率分析 Tab | 迁移 |
| 成本分析 | PremiumDashboard - 成本分析 Tab | 迁移 |
| 续保分析 | PremiumDashboard - 续保专项 Tab | 迁移 |
| 系数监控 | PremiumDashboard - 系数监控 Tab | 迁移 |
| 数据对比 | PremiumDashboard - 数据对比 Tab | 迁移 |

#### 3.2 SQL查询功能重构：查询助理

**设计理念**：将现有的SQL查询页面拆解，核心功能（NL2SQL、模板库）集成到各个数据页面作为"查询助理"

**实现方式**：
- 每个数据页面右下角固定按钮："💬 查询助理"
- 点击后展开侧边面板（从右侧滑入）
- 面板内容：
  - NL2SQL自然语言输入框
  - 快捷查询模板（该页面相关）
  - SQL预览（只读）
  - 执行结果展示

**新增组件**：
```
src/features/query-assistant/
├── QueryAssistantButton.tsx    # 悬浮按钮
├── QueryAssistantPanel.tsx     # 侧边面板
├── NL2SQLInput.tsx             # 自然语言输入（复用现有NL2SQL）
├── QuickTemplates.tsx          # 快捷模板（按页面分类）
└── SQLPreview.tsx              # SQL预览和执行
```

**迁移逻辑**：
- 现有的 `SqlQueryPage.tsx` 保留作为独立页面（可通过高级设置访问）
- 主要交互迁移到"查询助理"面板
- 模板库按页面分类：
  - 仪表盘：KPI查询、趋势查询
  - 成本分析：费用率查询、赔付率查询
  - 续保分析：续保率查询、续保模式查询

### 阶段 4：功能增强

#### 4.1 设置菜单
**文件**: `src/features/settings/`

```
├── ThemeSettings.tsx      # 主题设置（深色/浅色/随系统）
├── PermissionSettings.tsx # 权限管理
├── SystemSettings.tsx     # 系统设置（缓存、性能）
└── SettingsPanel.tsx      # 设置面板容器
```

**下拉菜单结构**：
```
⚙️ 设置 ▼
├── 🎨 外观
│   ├── ☀️ 浅色模式
│   ├── 🌙 深色模式
│   └── 💻 随系统
├── 🔐 权限管理
└── ⚙️ 系统设置
```

#### 4.2 文件菜单
**文件**: `src/features/file/`

```
├── DataImportModal.tsx    # 导入数据弹窗（从首页也可触发）
├── ExportPDFModal.tsx     # 导出PDF报告弹窗
├── ReportTemplatesModal.tsx # 报表模板管理（从PremiumDashboard迁移）
└── FileMenuHandler.tsx    # 文件菜单逻辑
```

**下拉菜单结构**：
```
📁 文件 ▼
├── 📥 导入数据
├── 📄 导出PDF报告
└── 📋 报表模板
```

**报表模板管理**：
- 从 PremiumDashboard 的"报表模板"标签页迁移
- 功能：查看、编辑、删除、应用报表模板
- 支持导出模板为JSON，分享给其他用户

#### 4.3 主题系统
**文件**: `src/shared/theme/`

```
├── theme.ts               # 主题配置（Tailwind扩展）
├── ThemeContext.tsx       # 主题上下文
├── useTheme.ts            # 主题 Hook
└── globals.css            # 全局样式（深色/浅色变量）
```

**主题切换实现**：
```typescript
// 主题选项
type ThemeMode = 'light' | 'dark' | 'system';

// 主题配置
const themes = {
  light: {
    background: 'ffffff',
    surface: 'f9fafb',
    text: '111827',
    // ...
  },
  dark: {
    background: '111827',
    surface: '1f2937',
    text: 'f9fafb',
    // ...
  }
};
```

---

## 🛠️ 技术实现要点

### 1. 状态管理
- 复用现有 `StateManager.ts`
- 新增全局状态：
  - `currentTheme`: 'light' | 'dark' | 'system'
  - `hasImportedData`: boolean（控制是否显示数据菜单）
  - `recentFiles`: File[]（最近文件列表）
  - `sidebarCollapsed`: boolean（侧边栏收起状态）
  - `queryAssistantOpen`: boolean（查询助理面板状态）

### 2. 路由守卫
```typescript
// 未导入数据时，访问数据页面重定向到首页
const useDataGuard = () => {
  const { hasImportedData } = useAppState();
  const location = useLocation();

  useEffect(() => {
    if (!hasImportedData && location.pathname !== '/') {
      navigate('/');
    }
  }, [hasImportedData, location]);
};
```

### 3. 数据加载流程优化
```typescript
// 首页导入 → 加载数据 → 跳转到仪表盘
const handleDataImport = async (file: File) => {
  await duckdbClient.loadParquet(file);
  StateManager.setHasImportedData(true);
  StateManager.addRecentFile(file);
  navigate('/dashboard'); // 跳转到仪表盘
};
```

### 4. 组件懒加载
```typescript
// 使用 React.lazy 优化性能
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const CostPage = lazy(() => import('./features/cost/CostPage'));
// ... 其他页面
```

### 5. 侧边栏收起/展开逻辑
```typescript
const useSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);

  const toggle = () => setCollapsed(!collapsed);

  return {
    collapsed,
    toggle,
    width: collapsed ? '60px' : '240px'
  };
};
```

### 6. 查询助理集成逻辑
```typescript
// 每个数据页面嵌入查询助理
const useQueryAssistant = (pageType: 'dashboard' | 'cost' | 'renewal' | ...) => {
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState(null);

  // 根据页面类型加载对应模板
  const templates = getTemplatesByPage(pageType);

  // NL2SQL 转换
  const convertToSQL = async (naturalLang: string) => {
    const sql = await nl2sqlService.convert(naturalLang, pageType);
    setSql(sql);
    return sql;
  };

  return { open, setOpen, templates, convertToSQL, result };
};
```

---

## 📊 UI/UX 细节设计

### 顶部导航栏
```
┌──────────────────────────────────────────────────────┐
│  🚗 车险经营管理系统 v2.0                     ⚙️ 设置  📁 文件  │
└──────────────────────────────────────────────────────┘
```

**设计要点**：
- 项目名称使用图标 + 文字，增强识别度
- 右侧菜单项使用图标，节省空间
- 下拉菜单带图标，提升可读性
- 支持深色/浅色主题切换

### 侧边栏导航
```
┌────────────┐
│  🏠 首页   │
│ ─────────  │
│  📊 仪表盘 │
│  🎯 达成   │
│  📈 增长   │
│  💰 成本   │
│  🔄 续保   │
│  🔍 系数   │
│  ⚖️ 对比   │
│            │
│  [▼ 收起]  │
└────────────┘
```

**交互细节**：
- 鼠标悬停显示完整文字（收起状态）
- 当前页面高亮显示
- 图标 + 文字设计，直观易懂
- 支持快捷键切换（数字键1-8）

### 首页 - 数据导入
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│           📊 车险经营数据导入                        │
│                                                      │
│   ┌────────────────────────────────────────────┐   │
│   │                                            │   │
│   │         📁 拖拽文件到此处                   │   │
│   │         或点击选择文件                      │   │
│   │                                            │   │
│   │         支持 .parquet 格式                  │   │
│   │                                            │   │
│   └────────────────────────────────────────────┘   │
│                                                      │
│   📂 最近文件：                                      │
│   • 2024年车险数据.parquet (2小时前)                 │
│   • 测试数据.parquet (昨天)                          │
│                                                      │
│   🚀 快捷操作：                                      │
│   [📋 查看报表模板]  [⚙️ 系统设置]                   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 数据页面布局（以仪表盘为例）
```
┌──────────────────────────────────────────────────────┐
│ 筛选器：[2024年▼] [签单日期▼] [2024-01-01 至 2024-12-31]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  KPI卡片区域...                                      │
│                                                      │
│  趋势图表区域...                                     │
│                                                      │
│  明细表格区域...                                     │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                         [💬 查询助理] │
└──────────────────────────────────────────────────────┘
```

**查询助理面板**（点击后从右侧滑入）：
```
┌──────────────────────────────────────────────────────┐
│ 💬 查询助理                                    [✕ 关闭] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📝 自然语言查询：                                   │
│  ┌────────────────────────────────────────────┐     │
│  │ 显示2024年保费 Top 10 机构                   │     │
│  └────────────────────────────────────────────┘     │
│  [🚀 执行查询]                                      │
│                                                      │
│  📋 快捷模板：                                       │
│  • KPI对比查询                                      │
│  • 机构排名查询                                     │
│  • 业务员业绩查询                                   │
│                                                      │
│  🔍 SQL预览：                                       │
│  ┌────────────────────────────────────────────┐     │
│  │ SELECT org_name, SUM(premium) as total     │     │
│  │ FROM policy_fact                           │     │
│  │ WHERE ...                                  │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  📊 执行结果：                                       │
│  [表格或图表展示]                                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## ✅ 验证清单

### 功能验证
- [ ] 首页可以正常导入数据
- [ ] 导入成功后自动跳转到仪表盘
- [ ] 侧边栏导航可以正常切换页面
- [ ] 侧边栏收起/展开功能正常
- [ ] 筛选器在所有页面中正常工作
- [ ] 主题切换功能正常（深色/浅色/随系统）
- [ ] 路由守卫正常工作（未导入数据不能访问数据页）
- [ ] 文件菜单功能正常（导出PDF、报表模板）
- [ ] 查询助理在每个数据页面可正常使用
- [ ] NL2SQL功能正常工作
- [ ] 快捷模板按页面分类显示

### 兼容性验证
- [ ] 现有的数据查询逻辑不受影响
- [ ] 现有的图表组件正常渲染
- [ ] 状态管理器与新布局兼容
- [ ] DuckDB查询功能正常

### 性能验证
- [ ] 组件懒加载正常工作
- [ ] 页面切换流畅，无白屏
- [ ] 大文件上传不阻塞UI
- [ ] 查询助理面板打开/关闭流畅

### 用户体验验证
- [ ] 侧边栏导航符合数据分析应用习惯
- [ ] 查询助理易用性良好
- [ ] 深色模式可读性良好
- [ ] 响应式设计在移动端正常

---

## 📁 关键文件清单

### 新增文件
```
src/components/layout/
├── SidebarLayout.tsx           # 侧边栏布局容器
├── SidebarNavigation.tsx       # 侧边栏导航
├── TopNavigation.tsx           # 顶部导航栏
├── DropdownMenu.tsx            # 下拉菜单组件
└── CollapseButton.tsx          # 侧边栏收起按钮

src/features/home/
├── DataImportPage.tsx          # 首页数据导入页面
├── RecentFilesList.tsx         # 最近文件列表
└── ImportHistory.tsx           # 导入历史记录

src/features/query-assistant/
├── QueryAssistantButton.tsx    # 悬浮按钮
├── QueryAssistantPanel.tsx     # 侧边面板
├── NL2SQLInput.tsx             # 自然语言输入
├── QuickTemplates.tsx          # 快捷模板（按页面分类）
├── SQLPreview.tsx              # SQL预览和执行
└── templates/                  # 模板配置
    ├── dashboard.ts            # 仪表盘模板
    ├── cost.ts                 # 成本分析模板
    ├── renewal.ts              # 续保分析模板
    └── index.ts                # 模板导出

src/features/settings/
├── ThemeSettings.tsx           # 主题设置
├── PermissionSettings.tsx      # 权限管理
├── SystemSettings.tsx          # 系统设置
└── SettingsPanel.tsx           # 设置面板容器

src/features/file/
├── DataImportModal.tsx         # 导入数据弹窗
├── ExportPDFModal.tsx          # 导出PDF报告弹窗
├── ReportTemplatesModal.tsx    # 报表模板管理（迁移）
└── FileMenuHandler.tsx         # 文件菜单逻辑

src/shared/theme/
├── theme.ts                    # 主题配置（Tailwind扩展）
├── ThemeContext.tsx            # 主题上下文
└── useTheme.ts                 # 主题 Hook

src/features/dashboard/
├── DashboardPage.tsx           # 仪表盘页面（迁移）
├── tabs/                       # 标签页内容拆分
│   ├── ComprehensiveTab.tsx   # 综合分析
│   └── ...
└── ...

src/features/cost/
├── CostPage.tsx                # 成本分析页面（迁移）
└── ...

src/features/renewal/
├── RenewalPage.tsx             # 续保分析页面（迁移）
└── ...

src/features/growth/
├── GrowthPage.tsx              # 增长分析页面（迁移）
└── ...

src/features/coefficient/
├── CoefficientPage.tsx         # 系数监控页面（迁移）
└── ...

src/features/compare/
├── ComparePage.tsx             # 数据对比页面（迁移）
└── ...

src/features/achievement/
├── AchievementPage.tsx         # 达成分析页面（新建）
└── ...
```

### 修改文件
```
src/app/App.tsx                 # 路由重构（使用侧边栏布局）
src/app/main.tsx                # 主题Provider包裹
src/core/StateManager.ts        # 新增主题、侧边栏状态、查询助理状态
src/features/dashboard/PremiumDashboard.tsx  # 拆分为独立页面组件
src/features/sql-query/SqlQueryPage.tsx  # 保留为高级功能入口
src/shared/utils/nl2sql.ts      # 扩展NL2SQL，支持页面类型参数
tailwind.config.js              # 添加主题配置
index.css                       # 添加深色/浅色样式变量
```

---

## 🚀 实施步骤

### Step 1: 布局框架（3天）
1. 创建 SidebarLayout 组件（侧边栏 + 主内容区）
2. 实现 SidebarNavigation 组件（菜单项、高亮、收起）
3. 实现 TopNavigation 组件（项目名称、设置/文件菜单）
4. 实现 DropdownMenu 组件（通用下拉菜单）
5. 更新 App.tsx 使用新布局
6. 测试响应式设计

### Step 2: 首页导入（2天）
1. 创建 DataImportPage 组件
2. 实现大卡片式文件上传（拖拽支持）
3. 实现最近文件列表（从LocalStorage读取）
4. 添加导入历史记录功能
5. 添加导入后自动跳转逻辑
6. 美化UI（图标、动画）

### Step 3: 路由重构（2天）
1. 设计新路由结构（/dashboard, /cost, /renewal等）
2. 实现路由守卫（未导入数据重定向到首页）
3. 迁移现有组件到新路由
4. 测试路由跳转和守卫逻辑

### Step 4: 页面拆分（3天）
1. 从 PremiumDashboard 提取各标签页为独立页面组件
   - DashboardPage（综合分析）
   - GrowthPage（增长分析）
   - CostPage（成本分析）
   - RenewalPage（续保分析）
   - CoefficientPage（系数监控）
   - ComparePage（数据对比）
2. 确保筛选器在所有页面正常工作
3. 测试数据共享和状态管理
4. 创建 AchievementPage（达成分析，待集成）

### Step 5: 查询助理集成（3天）
1. 创建 QueryAssistantButton 组件（悬浮按钮）
2. 创建 QueryAssistantPanel 组件（侧边面板）
3. 从 SqlQueryPage 提取NL2SQL逻辑，适配页面类型
4. 实现快捷模板分类（按页面）
5. 集成到每个数据页面
6. 测试自然语言转SQL功能

### Step 6: 功能菜单（2天）
1. 实现设置菜单
   - ThemeSettings（主题切换）
   - PermissionSettings（权限管理）
   - SystemSettings（系统设置）
2. 实现文件菜单
   - DataImportModal（导入弹窗）
   - ExportPDFModal（导出PDF）
   - ReportTemplatesModal（报表模板管理，从PremiumDashboard迁移）
3. 集成到顶部导航栏

### Step 7: 主题系统（2天）
1. 实现主题配置（Tailwind扩展）
2. 实现ThemeContext和useTheme Hook
3. 应用深色模式样式到所有组件
4. 实现主题切换逻辑
5. 测试主题切换效果

### Step 8: 测试与优化（2天）
1. 功能测试（所有菜单、页面、交互）
2. 性能优化（懒加载、代码分割）
3. 兼容性测试（Chrome、Firefox、Safari、Edge）
4. 响应式测试（桌面、平板、手机）
5. 文档更新（README、开发文档）

**总计**: 19 天（约4周）

### 里程碑
- **Week 1**: 完成Step 1-2（布局框架 + 首页导入）
- **Week 2**: 完成Step 3-4（路由重构 + 页面拆分）
- **Week 3**: 完成Step 5-6（查询助理 + 功能菜单）
- **Week 4**: 完成Step 7-8（主题系统 + 测试优化）

---

## 🎯 推荐方案总结

**最终选择：方案B - 现代侧边栏布局**

### 核心特性
1. ✅ 现代化侧边栏导航（类似Tableau、PowerBI）
2. ✅ 查询助理集成到每个数据页面（NL2SQL + 快捷模板）
3. ✅ 报表模板移至文件菜单（逻辑分类更清晰）
4. ✅ 首页独立，专注数据导入流程
5. ✅ 完整主题系统（深色/浅色/随系统）
6. ✅ 侧边栏可收起，节省屏幕空间

### 优势
1. ✅ 符合数据分析应用的用户习惯（左侧导航，右侧内容）
2. ✅ 信息架构清晰，模块划分明确
3. ✅ 查询助理降低SQL使用门槛（自然语言查询）
4. ✅ 路由语义化，支持深度链接
5. ✅ 与现有架构兼容性好（复用StateManager、筛选器等）
6. ✅ 完整功能重构，用户体验全面提升

### 风险与缓解
| 风险 | 缓解措施 |
|-----|---------|
| 组件拆分导致状态丢失 | 提升状态到StateManager，确保全局共享 |
| 路由变更影响现有功能 | 保留旧路由重定向，逐步迁移 |
| 查询助理集成复杂度高 | 分阶段实施，先实现基础功能，再优化NL2SQL |
| 侧边栏布局响应式挑战 | 移动端自动收起，提供汉堡菜单 |
| 开发周期较长（19天） | 分4个里程碑，每周可发布可用版本 |

### 关键创新点
1. **查询助理**：将专业SQL能力转化为自然语言交互，降低使用门槛
2. **侧边栏设计**：现代化布局，符合数据分析应用主流趋势
3. **主题系统**：完整的深色/浅色模式，支持长时间使用
4. **首页独立**：强化数据导入流程，提升首次使用体验

---

## 🔮 未来扩展

### Phase 2 功能
- [ ] 用户权限管理
- [ ] 数据导出多格式支持（Excel、CSV）
- [ ] 自定义报表模板
- [ ] 数据缓存和离线支持
- [ ] 协作功能（分享、评论）

### Phase 3 功能
- [ ] 多数据库支持
- [ ] 实时数据同步
- [ ] AI辅助分析
- [ ] 移动端适配

---

**方案制定时间**: 2026-01-16
**预估工作量**: 10-15 人天
**推荐优先级**: 高（影响用户体验和系统架构）
