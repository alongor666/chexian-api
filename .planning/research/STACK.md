# Technology Stack: Performance Profiling & Optimization

**Project:** chexian-api 全栈性能优化里程碑
**Researched:** 2026-04-12
**Overall confidence:** HIGH (核心推荐均来自官方文档 + npm 版本验证)

---

## 现有基础设施状态（研究起点）

研究前先审计现有配置，避免重复推荐已有工具：

| 工具 | 当前状态 | 问题 |
|------|---------|------|
| `vite-plugin-compression` ^0.5.1 | 已安装 | **已停止维护（4年未更新）**，应替换为 `vite-plugin-compression2` |
| `build:analyze` npm script | 已存在 | 脚本存在但未接入 visualizer 插件，`--mode analyze` 分支未激活 |
| `scripts/benchmark-key-routes.mjs` | 完整实现 | 自定义基准测试，覆盖 p50/p95/p99、cold/warm、gate 判断，**无需引入 autocannon** |
| `scripts/benchmark-key-routes-soak.mjs` | 完整实现 | 浸泡测试，同上 |
| `@tanstack/react-query-devtools` | 已安装 | 开发调试可用 |

---

## Recommended Stack

### 1. Bundle 分析（前端体积）

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `rollup-plugin-visualizer` | **7.0.1** | Bundle treemap + sunburst 可视化 | Vite 官方兼容，566 个项目使用，`--mode analyze` 时条件激活，不影响生产构建 |
| `vite-plugin-compression2` | **2.4.0** | gzip + brotli 预压缩 | 替换已停维护的 `vite-plugin-compression 0.5.1`，同等 API，活跃维护 |

**安装：**
```bash
bun add -D rollup-plugin-visualizer vite-plugin-compression2
bun remove vite-plugin-compression
```

**接入方式（`vite.config.ts` 改动最小）：**
```typescript
import { visualizer } from 'rollup-plugin-visualizer'
import viteCompression from 'vite-plugin-compression2'

plugins: [
  react(),
  viteCompression({ algorithm: 'gzip', threshold: 1024 }),
  viteCompression({ algorithm: 'brotliCompress', threshold: 1024 }),
  // 仅 analyze 模式激活，不影响生产构建
  process.env.ANALYZE === 'true' && visualizer({
    filename: 'artifacts/bundle-stats.html',
    template: 'treemap',
    open: true,
    gzipSize: true,
    brotliSize: true,
  }),
]
```

**触发：**
```bash
ANALYZE=true bun run build:analyze
```

**置信度：** HIGH — rollup-plugin-visualizer 7.0.1 于 2026-03-16 发布，vite-plugin-compression2 2.4.0 于 2026-03-19 发布，均经 npm 验证。

---

### 2. React 组件渲染分析（前端行为）

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React DevTools Profiler | 内置浏览器扩展 | 火焰图 + commit 耗时 | **零配置，无安装成本**。覆盖 ECharts 组件重渲染、筛选器状态传播问题 |
| `@welldone-software/why-did-you-render` | latest（支持 React 19） | 开发期检测不必要 re-render | **按需临时安装**，定位到具体组件后卸载 |
| React Performance Tracks（Chrome DevTools） | 浏览器内置 | 与网络/JS 执行并排可视化 | React 19 支持自定义 performance 条目，无需额外工具 |

**why-did-you-render 使用模式（只装在需要诊断时）：**
```bash
bun add -D @welldone-software/why-did-you-render
# 诊断完成后
bun remove @welldone-software/why-did-you-render
```

**ECharts 渲染优化目标（无需新工具，只改代码模式）：**
- 图表 `option` 对象用 `useMemo` 包裹，避免每次渲染生成新配置对象触发 ECharts diff
- `echarts-for-react` 组件用 `React.memo` 包裹，外部筛选器状态不变时跳过重渲染
- 多图表面板（如 GrowthAnalysisPanel、FeeAnalysisPanel）优先检查 props 稳定性

**置信度：** HIGH — React DevTools Profiler 官方推荐路径。why-did-you-render 官方文档明确支持 React 19。

---

### 3. DuckDB 查询分析（后端 SQL 层）

**无需安装任何新工具。** DuckDB 内置完整的性能分析能力：

| 技术 | 用法 | 用途 |
|------|------|------|
| `EXPLAIN ANALYZE` | SQL 前缀 | 每个算子的实际行数 + 执行耗时，定位全表扫描/join 顺序 |
| `PRAGMA enable_profiling='json'` | DuckDB pragma | 结构化 JSON 输出，可记录到文件 |
| `GROUPING SETS` | SQL 语法 | **替换 12+ UNION ALL 月度聚合为单次扫描**，官方推荐方法 |

**针对项目的具体优化方向（已被 CONCERNS.md 确认）：**

```sql
-- 当前: 12个 UNION ALL（每个 UNION ALL 可能触发全表扫描）
SELECT '2026-01' as month, SUM(premium) FROM PolicyFact WHERE policy_month = '2026-01'
UNION ALL
SELECT '2026-02' as month, SUM(premium) FROM PolicyFact WHERE policy_month = '2026-02'
-- ... ×12

-- 优化后: GROUPING SETS 单次扫描
SELECT
  DATE_TRUNC('month', policy_date) as month,
  SUM(premium) as total_premium
FROM PolicyFact
WHERE policy_date BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY GROUPING SETS ((DATE_TRUNC('month', policy_date)))
ORDER BY month
```

**涉及文件：** `server/src/sql/coefficient.ts`（494行）、`server/src/sql/cost/earned-premium-detail.ts`

**置信度：** HIGH — DuckDB 官方文档 `/docs/current/sql/query_syntax/grouping_sets` 明确描述此用途。

---

### 4. Node.js/Express 运行时分析

**项目已有** `scripts/benchmark-key-routes.mjs`（完整的 p50/p95/p99 基准工具）**和** `bun run benchmark:key-routes`，**无需引入 autocannon 或 k6**。

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `clinic` (Clinic.js) | 全局安装，按需使用 | CPU flame graph + async bubble profiling | **按需诊断工具，不入 package.json**。`clinic flame -- node server/src/app.ts` 定位热点函数 |
| Node.js 内置 `--prof` | Node.js 内置 | V8 tick profiler | 零依赖，`node --prof` 生成 isolate-*.log，`--prof-process` 转文本 |

**Clinic.js 使用模式（不入 devDependencies，全局按需安装）：**
```bash
# 仅在需要深度诊断时：
npm install -g clinic

# 定位 CPU 热点：
clinic flame -- node --require tsx/cjs server/src/app.ts

# 定位 async 瓶颈（event loop lag）：
clinic doctor -- node --require tsx/cjs server/src/app.ts
```

**置信度：** MEDIUM — Clinic.js 是 NearForm 开源工具，Node.js 生态标准。全局安装模式避免版本锁定风险。

---

### 5. 生产监控（运行时指标采集）

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `prom-client` | **15.1.3** | Prometheus 指标暴露（`/metrics` 端点） | Node.js Prometheus 客户端事实标准（300k+周下载），默认采集 event loop lag、heap、GC、active handles |
| `express-prom-bundle` | **latest** | Express 中间件自动采集 HTTP 请求延迟 | 2行接入，prom-client peer dependency，无侵入 |

**注意：** 当前 2核4G VPS 没有独立 Prometheus + Grafana 实例，引入 prom-client 的价值在于：
1. 暴露 `/metrics` 端点，供未来监控系统接入
2. 在现有 benchmark 脚本外提供实时内存/GC 数据

**是否现在安装：** **仅在 VPS 内存压力缓解（Phase: 数据物化优化）后再引入**。当前优先级低于代码层优化。

**安装（延迟到后续 phase）：**
```bash
bun add prom-client express-prom-bundle
```

**置信度：** HIGH — 官方 GitHub siimon/prom-client 版本 15.1.3 已验证。

---

### 6. Vite 构建进一步优化（代码分割细化）

**现有配置已有** `manualChunks` 策略（5个 vendor chunk）。需要做的是：

| 技术 | 目的 | 方式 |
|------|------|------|
| `React.lazy` + `Suspense` | 按路由懒加载页面组件 | 将分析页面（FeeAnalysisPanel、GrowthAnalysisPanel、RenewalAnalysisPage）改为动态 import |
| `manualChunks` 细化 | ECharts 已单独分片，进一步评估 jspdf/html2canvas 是否值得异步加载 | 用 visualizer 输出数据驱动决策 |

**无需新插件，纯代码模式：**
```typescript
// 现在
import FeeAnalysisPanel from '@/features/fee-analysis/components/FeeAnalysisPanel'

// 优化后
const FeeAnalysisPanel = React.lazy(() =>
  import('@/features/fee-analysis/components/FeeAnalysisPanel')
)
```

**置信度：** HIGH — Vite 官方文档 + React 官方文档推荐模式。

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bundle 分析 | `rollup-plugin-visualizer` | `vite-bundle-analyzer` | vite-bundle-analyzer 也活跃，但 rollup-plugin-visualizer 更成熟（566 vs 更少使用者），API 更稳定 |
| HTTP 基准 | 项目自定义脚本 | `autocannon` 8.0.0 | 项目已有功能完整的自定义基准工具，引入 autocannon 是重复建设 |
| HTTP 基准 | 项目自定义脚本 | `k6` | k6 需要独立进程和 Go 运行时，2核4G VPS 上额外内存压力不值得 |
| 压缩插件 | `vite-plugin-compression2` 2.4.0 | `vite-plugin-compression` 0.5.1（现有） | 现有包 4年未更新，停止维护 |
| 监控 | `prom-client` | AppSignal / Datadog | 外部 APM 需要月费且引入额外延迟，当前 VPS 规格不适合 agent 常驻 |
| 渲染分析 | React DevTools Profiler | Profiler API（代码埋点） | DevTools 已覆盖所有场景，代码埋点增加维护负担 |
| Node.js 分析 | `clinic` 全局安装 | `node --prof` 内置 | 两者互补：`--prof` 零成本、clinic 可视化更好；均推荐，不是选择关系 |

---

## 完整安装命令

```bash
# 必装（本里程碑）
bun add -D rollup-plugin-visualizer vite-plugin-compression2
bun remove vite-plugin-compression  # 替换旧压缩插件

# 按需临时安装（不入 package.json）
npm install -g clinic               # 需要深度 CPU/async 分析时

# 按需临时安装（诊断完成后卸载）
bun add -D @welldone-software/why-did-you-render

# 延迟到后续 phase（监控）
# bun add prom-client express-prom-bundle
```

---

## 置信度汇总

| Area | Confidence | Notes |
|------|------------|-------|
| Bundle 分析工具 | HIGH | rollup-plugin-visualizer 7.0.1 npm 已验证；vite-plugin-compression2 2.4.0 npm 已验证 |
| React 渲染分析 | HIGH | React DevTools 官方路径；why-did-you-render 官方声明支持 React 19 |
| DuckDB GROUPING SETS | HIGH | DuckDB 官方文档明确推荐替换 UNION ALL |
| Node.js 分析工具 | MEDIUM | Clinic.js 是 NearForm 标准工具，但项目已有自定义基准；两者定位不同 |
| Prometheus 监控 | HIGH | prom-client 15.1.3 npm 已验证；推迟安装是因为优先级，不是不适合 |
| Lazy loading 策略 | HIGH | React + Vite 官方文档推荐模式，无版本依赖 |

---

## Sources

- [rollup-plugin-visualizer npm](https://www.npmjs.com/package/rollup-plugin-visualizer) — 7.0.1，2026-03-16 发布
- [vite-plugin-compression2 GitHub](https://github.com/nonzzz/vite-plugin-compression) — 2.4.0，活跃维护
- [DuckDB GROUPING SETS 官方文档](https://duckdb.org/docs/current/sql/query_syntax/grouping_sets)
- [DuckDB EXPLAIN ANALYZE 官方文档](https://duckdb.org/docs/current/guides/meta/explain_analyze)
- [React Profiler 官方文档](https://react.dev/reference/react/Profiler)
- [prom-client GitHub](https://github.com/siimon/prom-client) — 15.1.3
- [why-did-you-render GitHub](https://github.com/welldone-software/why-did-you-render) — React 19 支持确认
- [Clinic.js GitHub](https://github.com/clinicjs/node-clinic)

---

*研究日期: 2026-04-12*
