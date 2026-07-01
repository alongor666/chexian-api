# 架构优化方向与计划

> 生成日期：2026-07-01 · 基于全量代码审计（server 88 SQL 生成器 / 前端 306 组件 / 20 feature 模块）

---

## 总体评价

chexian-api 是一个**成熟度较高的生产系统**（⭐⭐⭐⭐ 4/5）：多层缓存（DuckDB QueryCache → RouteCache → ServiceWorker → React Query）、三级限流、RLS 权限注入、治理闸门等基础设施完备。主要优化空间集中在**SQL 层代码复用、前端包体积与大组件拆分、后端连接池弹性**三个方向。

---

## 一、SQL 生成器层：复用与抽象（影响面最大）

### 1.1 热力图生成器合并（P2 · 预估 -600 LOC）

| 现状 | 问题 |
|------|------|
| `claims-heatmap.ts`（574 行）、`performance-heatmap.ts`（498 行）、cross-sell 热力图 | 三者均为"二维聚合 + 行列 pivot + 亮灯"模式，~60% 逻辑重复 |

**方案**：提取 `GenericHeatmapBuilder`，接受维度配置（行维度、列维度、聚合指标、亮灯阈值），三个场景降为配置声明。

### 1.2 CAST/日期模板提取（P3 · 降维护成本）

- `CAST(... AS DATE)` / `CAST(... AS TIMESTAMP)` 出现 **215 次**
- 日期窗口过滤（`>= startDate AND <= endDate`）在多个生成器中重复

**方案**：在 `sql/shared/` 新增 `date-templates.ts`，提供 `castDate(field)`、`dateWindowCondition(field, start, end)` 等模板函数。

### 1.3 趋势生成器统一（P2 · 预估 -400 LOC）

- `trend.ts`、`cross-sell-trend.ts`、`performance-trend.ts` 均包含"按月/周聚合 + 环比计算"逻辑
- 时间序列聚合核心可提取为 `TimeSeriesBuilder`

---

## 二、前端包体积与代码拆分

### 2.1 导出依赖动态加载（P2 · 预估 -40~50KB 首屏）

| 现状 | 问题 |
|------|------|
| `jspdf` + `html2canvas` 在 `vendor-export` chunk 中始终加载 | 仅在 ExportDialog 打开时使用，但占首屏包约 40KB gzip |

**方案**：改为 `const { jsPDF } = await import('jspdf')` 动态导入，仅在用户点击导出时加载。

### 2.2 Dashboard 内部二级代码拆分（P2）

| 现状 | 问题 |
|------|------|
| dashboard 功能模块（78 个文件、~6,770 LOC）作为一个 chunk 加载 | 首次进入仪表盘加载全部子面板（热力图、交叉销售、卡车专项等） |

**方案**：对低频子面板（PerformanceOrgHeatmapV2、CrossSellAnalysisPanel 等）使用 `React.lazy()` 二级拆分，首屏只加载 KPI 卡片 + 核心趋势图。

### 2.3 ECharts 按需引入（P3 · 预估 -100~150KB）

| 现状 | 问题 |
|------|------|
| `vendor-echarts` chunk 包含完整 ECharts（~200KB gzip） | 项目实际只用 line/bar/pie/heatmap/scatter 五种图表类型 |

**方案**：改用 `echarts/core` + 按需注册组件（`BarChart`, `LineChart`, `PieChart`, `HeatmapChart`, `ScatterChart`），可减少 30-40% 体积。需验证 `echarts-for-react` 兼容性。

---

## 三、大组件拆分（可维护性）

以下 6 个组件超过 700 LOC，建议拆分：

| 组件 | 行数 | 拆分方向 |
|------|------|---------|
| `GeoRiskPanel.tsx` | 951 | 地图渲染 + 数据表 + 筛选器三部分 |
| `CrossSellAnalysisPanel.tsx` | 903 | 汇总卡片 + 趋势图 + 明细表 |
| `NewEarnedPremiumTable.tsx` | 891 | 表格逻辑 + 列定义 + 导出逻辑 |
| `PerformanceAnalysisPanel.tsx` | 887 | KPI 区 + 图表区 + 排名表 |
| `AdvancedFilterPanel.tsx` | 730 | 按筛选维度拆为子面板 |
| `LineChart.tsx`（widget） | 720 | 配置构建 + tooltip 渲染 + 事件处理 |

**原则**：每个子组件控制在 300 行以内，通过 props 向下传递数据，hooks 保持在父级。优先级 P3，按修改频率排序执行。

---

## 四、设计令牌覆盖率提升

| 现状 | 问题 |
|------|------|
| 设计系统 `src/shared/styles/index.ts`（697 行）已建立 | 45 个文件中仍有 **167 处**硬编码 Tailwind 色值（`text-red-*`、`bg-green-*` 等） |

**重点文件**：
- `GrowthDetailSection.tsx`（25 处）
- `GrowthComparisonSection.tsx`（20 处）
- `HeatmapSummaryBar.tsx`（多处）
- `OrgTable.tsx`（renewal-tracker）

**方案**：分批替换为 `colorClasses.text.success` / `colorClasses.text.danger` 等设计令牌引用。优先级 P3，可随功能迭代逐步收敛。

---

## 五、后端性能弹性

### 5.1 连接池自适应超时（P2）

| 现状 | 问题 |
|------|------|
| 固定 2s acquire timeout，队列满 32 即拒绝 | 高并发时可能过早拒绝请求；低负载时超时等待浪费 |

**方案**：根据队列深度梯度超时（队列=1 → 0.5s，队列=16 → 2s，队列=32 → 3s），避免"要么全放、要么全拒"的二值状态。

### 5.2 缓存字节估算精度（P3）

| 现状 | 问题 |
|------|------|
| `estimateBytes()` 用 `JSON.stringify().length × 2` 估算 | 复杂嵌套对象低估、简单字符串高估；每次写缓存触发一次 JSON 序列化开销 |

**方案**：用 `Buffer.byteLength(JSON.stringify(data))` 替代（更精确），或对高频路由缓存实际大小做采样校准。

### 5.3 Bundle Route 扩展（P2 · 减少前端请求数）

| 现状 | 问题 |
|------|------|
| 仅 3 个 bundle route（dashboard / performance / cross-sell） | repair 页面 4-5 个独立请求、renewal-tracker 3 个独立请求 |

**方案**：为 repair 和 renewal-tracker 新增 bundle route，预期减少 40% 请求数，降低前端瀑布效应。

### 5.4 冷启动 502 根治（P1 · 已在 BACKLOG）

生产 reload 时全站 502 持续数分钟（BACKLOG `2026-06-27-claude-294022`），需要实现**蓝绿部署**或**预热完成信号**，在新进程缓存预热完成前保持旧进程服务。

---

## 六、Service Worker 与缓存协同

### 6.1 SW 预取列表动态化（P3）

| 现状 | 问题 |
|------|------|
| `sw.js` 硬编码预取 dashboard-bundle / performance-bundle | 不同角色用户首屏不同（admin 看全局、org_user 看本机构），预取效率低 |

**方案**：SW 注册时从 `/api/auth/route-catalog` 获取用户可访问路由，按权限动态生成预取列表。

### 6.2 React Query 缓存键加入用户标识（P2）

| 现状 | 问题 |
|------|------|
| Query key 不含 userId | 登出切换用户时若 `auth-logout` 事件未正确触发，可能泄露前用户数据 |

**方案**：在 `queryKeyFactory` 的 base key 中注入 `userId`，确保用户切换后缓存自然失效。

---

## 七、已在 BACKLOG 中的相关项（不重复登记）

以下项目与本优化计划有交叉，已有追踪，此处仅建立关联：

| BACKLOG ID | 主题 | 本计划关联 |
|-----------|------|-----------|
| B306 | DuckDB 性能高危三件套 | §五 连接池 |
| B305 / B310 | 指标/成本率硬编码绕过注册表 | §一 SQL 层抽象 |
| `2026-06-11-claude-3093a3` | 重复组件收拢 | §三 大组件拆分 |
| `2026-06-11-claude-7dca99` | StableContext/ExportContext value 未 memoize | §六 缓存协同 |
| `2026-06-11-claude-ed63ec` | SW 5 分钟版本轮询实际不存在 | §六 SW 优化 |
| `2026-06-27-claude-294022` | 生产 reload 冷启动 502 | §五.4 |
| `2026-06-10-claude-807f41` | repair v2 八端点 | §五.3 bundle route |

---

## 八、执行优先级矩阵

```
                    影响面大
                      │
         ┌────────────┼────────────┐
         │  §五.4     │  §一.1     │
         │  冷启动502  │  热力图合并  │
    紧    │  §六.2     │  §一.3     │   缓
    急    │  缓存键安全 │  趋势合并   │   和
         │            │  §五.3     │
         │            │  bundle扩展 │
         ├────────────┼────────────┤
         │  §五.1     │  §二.1     │
         │  连接池弹性 │  导出动态加载│
         │            │  §二.2     │
         │            │  Dashboard拆│
         │            │  §三 组件拆 │
         │            │  §四 设计令牌│
         │            │  §二.3     │
         └────────────┴────────────┘
                    影响面小
```

**建议执行顺序**：

1. **第一批（P1-P2，1-2 周）**：§五.4 冷启动 + §六.2 缓存键安全 + §二.1 导出动态加载
2. **第二批（P2，2-3 周）**：§一.1 热力图合并 + §一.3 趋势合并 + §五.3 bundle route
3. **第三批（P2-P3，持续迭代）**：§二.2 Dashboard 拆分 + §三 大组件拆分 + §四 设计令牌
4. **第四批（P3，按需）**：§一.2 CAST 模板 + §二.3 ECharts 按需 + §五.2 缓存估算 + §六.1 SW 动态化

---

## 架构健康评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **类型安全** | 8/10 | `as any` 仅 24 处，集中在 ECharts tooltip 和测试 mock |
| **代码拆分** | 7/10 | 18 个懒加载路由，但 dashboard 内部未拆分 |
| **设计系统** | 7/10 | 系统已建立，~30% 硬编码色值待迁移 |
| **状态管理** | 9/10 | Context + React Query 模式清晰，无过度状态化 |
| **API 层** | 9/10 | 13 个域子客户端 + 请求去重 + 自动 token 刷新 |
| **缓存架构** | 8/10 | 四层缓存完备，缺用户隔离 |
| **SQL 层** | 6/10 | 88 个生成器，热力图/趋势重复度高 |
| **安全性** | 8/10 | RLS + 三级限流 + 审计日志，4 域 RLS 缺口已追踪 |
| **可观测性** | 7/10 | 慢查询日志 + 审计日志，缺结构化 metrics |
| **部署韧性** | 5/10 | 冷启动 502 问题尚未根治 |
