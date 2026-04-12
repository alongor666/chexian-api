# 性能优化陷阱清单

**项目:** chexian-api — 车险数据分析平台全栈性能重构
**技术栈:** React 19 + Vite + ECharts / Express + DuckDB + @duckdb/node-api / 2核4G VPS
**审计日期:** 2026-04-12
**信心级别:** HIGH（基于代码库直接审计，非推断）

---

## 一、致命陷阱（Critical Pitfalls）

以下错误会导致生产服务中断或数据损坏，重构期间必须零容忍。

---

### C-01: SQL 生成器重构后查询结果静默错误

**症状:** SQL 生成器（如 `trend.ts`、`coefficient.ts`）拆分后，前端数字看起来正常但与拆分前有细微差异。

**根因:** 12+ UNION ALL 的生成逻辑中存在隐式的分组聚合顺序依赖。例如 `coefficient.ts:460-494` 的周期批量查询，成都/全省/机构明细三路 UNION 后通过 ORDER BY CASE 排序，如果拆分时遗漏了任一子查询的 `GROUP BY` 字段或调整了聚合函数的作用范围，结果会错误但不报错。

**后果:** 用户基于错误指标做决策；因为"看起来合理"而难以发现；生产环境数据一致性破坏。

**检测信号:**
- 重构后趋势图折线形状改变（尤其是月初/月末数据点）
- 总计行与分项之和不等
- 成都数字包含了全省数字（双重计数）

**预防策略:**
1. 重构前为每个 SQL 生成器函数建立"黄金快照"：直接用 DuckDB CLI 查询 Parquet 保存基准 JSON
2. 每次拆分后执行 `python3 scripts/verify-cross-sell.py` 等同等价验证
3. 对 `coefficient.ts` / `earned-premium-detail.ts` 特别注意：12 UNION ALL 生成循环（L460-494）不能简化为 CTE 除非同时验证 `GROUP BY` 语义不变
4. 新增参数化测试覆盖 100+ 筛选器组合（CONCERNS.md 已标注此缺口）

**适用阶段:** SQL 生成器拆分阶段（第一优先处理）

---

### C-02: DuckDB 物化视图重建期间连接池耗尽

**症状:** VPS 重启或 ETL 后，前端请求全部返回 503/504，PM2 进程健康但查询挂起。

**根因:** `materializeInBatches()`（`duckdb-materialization.ts:63+`）在重建 PolicyFact 时逐月 INSERT，期间持有独占写连接。连接池（`duckdb-infra.ts:58-60`）ACQUIRE_TIMEOUT_MS=5000，MAX_WAIT_QUEUE=20 — 如果物化耗时超过 5 秒且有 20+ 并发请求，队列满后后续请求直接 reject。

**关键数字:** PolicyFact = 380万行 × 53列，VPS（threads=2）逐月分批物化。每月约 30 万行。估算单次物化 45-90 秒。

**后果:** 生产服务窗口期完全不可用，与"渐进式改造"目标相反。

**检测信号:**
- 启动日志中 `Materializing PolicyFact (batched by month)` 期间请求延迟突增
- ConnectionPool `waitQueue` 长度持续为 20

**预防策略:**
1. 物化期间启用"降级模式"：`materializeInBatches` 失败回退到 VIEW（代码已有此逻辑，需验证触发条件正确）
2. 物化和 API 服务使用**不同连接**：在物化开始时预留 2 个连接给 API 服务，剩余连接给物化
3. 优化路径：lazy-load 非核心视图（ClaimsAgg、CrossSellFact）而非启动时全量物化
4. 健康检查端点在物化期间返回 503 而非 200，让负载均衡器/监控准确感知

**适用阶段:** 数据物化架构优化阶段

---

### C-03: 快照 paramHash 碰撞导致跨用户数据泄漏

**症状:** 用户 A（有机构限权）看到了用户 B（全量权限）的数据快照。

**根因:** `snapshot-serve.ts:82-89` 的 `computeParamHash()` 仅对 `req.query` 参数做哈希，而权限过滤条件 `req.permissionFilter` 通过 `permissionToScope()` 转换为 scope 字符串作为目录层级。快照路径结构是 `{bundle}/{scope}/{paramHash}.json`。

如果 `permissionToScope()` 对不同权限返回相同 scope（例如两个机构用户恰好都匹配 `unknown`），且查询参数相同，则会命中同一快照文件。当前实现：`if (permissionFilter.includes('is_telemarketing')) return 'telemarketing'` — 凡是不匹配 org 也不包含 is_telemarketing 的权限过滤，一律返回 `'unknown'`。

**后果:** 严重安全事故（数据越权访问）；违反分公司数据隔离合规要求。

**检测信号:**
- 机构用户看到全省数据
- `X-Snapshot: hit` 但用户权限受限

**预防策略:**
1. `permissionToScope()` 必须对所有不等价的权限过滤返回不同的 scope；对 `unknown` 情况改为直接返回 `next()`（不服务快照，回退到实时查询）
2. 或者将完整 `permissionFilter` 字符串也纳入哈希（与 paramHash 一起），彻底避免碰撞
3. 增加 E2E 测试：机构限权用户访问同一 URL，验证返回数据仅包含本机构数据

**适用阶段:** 快照缓存精细化阶段（必须优先于扩展快照覆盖范围）

---

### C-04: DuckDB DATE/TIMESTAMP 序列化陷阱——新字段添加静默错误

**症状:** 新添加的日期字段在前端图表显示为 `NaN`、`undefined` 或 `[object Object]`，但 API 不报错。

**根因:** `@duckdb/node-api` Neo API 返回 DATE 类型为 `{days: N}` 对象，TIMESTAMP 为 `{micros: N}` 对象（非字符串）。`duckdb.ts:convertBigIntToNumber()` 做了转换，但没有单元测试覆盖。每次新增日期字段都需要手动确认转换逻辑覆盖了该字段名。

这是已在 MEMORY.md 记录的已知陷阱，但代码层没有防护机制：未被转换的日期字段会穿透到前端，图表代码对 `{days: N}` 对象调用 `.includes()` 或字符串操作时静默失败。

**后果:** 特定功能数据不可用，前端无错误提示（图表空白）；难以复现（取决于具体字段）。

**预防策略:**
1. 为 `convertBigIntToNumber()` 添加单元测试：覆盖 DATE、TIMESTAMP、BigInt、普通数字四种输入
2. 在返回 JSON 前增加序列化断言：如果值是 `typeof 'object' && 'days' in value`，抛出可见错误
3. 或创建 `DuckDBTypeConverter` 类（CONCERNS.md 已建议），集中处理所有类型转换

**适用阶段:** DuckDB 服务层拆分阶段

---

## 二、中等陷阱（Moderate Pitfalls）

以下错误会导致性能退化或局部功能损坏，但不会立即导致生产中断。

---

### M-01: ECharts 实例泄漏导致内存线性增长

**症状:** 页面切换后内存不释放，长时间使用后图表渲染变慢，移动端尤为明显。

**根因:** `echarts-for-react` 封装库默认在组件 unmount 时调用 `echartsInstance.dispose()`，但有两个常见绕过场景：
1. 使用 `ref` 手动持有 ECharts 实例，组件销毁后 ref 未清理
2. React 严格模式 + Suspense 导致组件 mount/unmount 双触发，第一次 mount 创建的实例在第二次 mount 时被覆盖但未 dispose

项目中 `vite.config.ts` 已配置 `vendor-echarts` 为独立 chunk（L51-52），说明 ECharts 体积已被识别，但实例生命周期管理需单独验证。

**预防策略:**
1. 在 React DevTools Memory 面板对比页面切换前后的 ECharts 实例数量
2. 自定义 `useECharts` hook，在 `useEffect` 清理函数中显式 `dispose()`
3. 不要在组件外部持有 ECharts 实例引用

**适用阶段:** 前端组件渲染优化阶段

---

### M-02: React Query staleTime=Infinity 导致 ETL 更新后数据不刷新

**症状:** ETL 完成后用户仍看到旧数据，刷新页面也无效（Service Worker 缓存中）。

**根因:** CLAUDE.md §4 说明 SW 活跃时 React Query staleTime=Infinity。Service Worker 通过轮询 `/api/data/version` 检测 ETL 更新，但这依赖 SW 成功收到新版本信号并主动 postMessage 通知 React 客户端。

如果 SW 的 version check 轮询间隔（24小时）与 ETL 更新时间不对齐，用户可能在 ETL 后最长 24 小时内看到旧数据。

**预防策略:**
1. ETL 完成后主动调用 `/api/data/invalidate` 或修改 `/api/data/version` 返回值，触发 SW 立即推送更新信号
2. 在开发/调试场景提供强制刷新机制（如 URL 参数 `?nocache=1` 绕过 SW）
3. 在 UI 中显示数据截止日期（`etlDate`），让用户可以感知数据新鲜度

**适用阶段:** 快照缓存精细化阶段

---

### M-03: UNION ALL N+1 改为 CTE 窗口函数后性能可能不升反降

**症状:** 将 `earned-premium-detail.ts` 的 12 UNION ALL 改为单个 CTE + `PARTITION BY month` 后，查询变慢（2-5s 变为 5-8s）。

**根因:** DuckDB 的 CTE 窗口函数在以下条件下性能反而不如 UNION ALL：
- 每个子查询的 WHERE 条件不同（例如日期范围各异），CTE 必须全量扫描后在内存中过滤，而 UNION ALL 各子查询可以独立做 Parquet 文件裁剪（predicate pushdown）
- `earned-premium-detail.ts` 的 12 月查询每月日期窗口不同（`windowStartDate` / `windowPrevEnd` 各异），这正是 Parquet predicate pushdown 的最佳场景

从代码审计可见（`earned-premium-detail.ts:167-250`），每月查询的 `WHERE` 条件包含不同的日期范围字面量，这是 DuckDB 能做 min/max 统计裁剪的信号。CTE 合并后这个优化消失。

**检测信号:**
- `EXPLAIN ANALYZE` 输出中 UNION ALL 版本显示 `Parquet Files Pruned: N`，而 CTE 版本无此输出

**预防策略:**
1. 改写 CTE 前先用 `EXPLAIN ANALYZE` 对比两个版本的实际扫描行数
2. 如果 Parquet 有日期分区（按 `insurance_start_date` 分片），UNION ALL 优势更大
3. 优先考虑在 Parquet 层面增加分区（月粒度），而非在 SQL 层面做 CTE 合并

**适用阶段:** DuckDB 查询优化阶段（需要基准测试驱动，不能凭直觉判断）

---

### M-04: Vite manualChunks 配置与路由懒加载冲突

**症状:** 代码分割后，某些路由首次加载反而变慢；或 `echarts` chunk 在每个页面都被加载一次。

**根因:** `vite.config.ts:51-57` 已定义 `manualChunks`，将 `echarts` 单独抽出为 `vendor-echarts`。但如果路由组件使用 `React.lazy` + `Suspense` 懒加载，而懒加载的组件内部引用了 ECharts，Vite 的 chunk 图分析可能将 `vendor-echarts` 的加载提升为 eager（因为主 bundle 的某条路径依赖它），导致 ECharts 随主 bundle 同步加载，分割无效。

**检测信号:**
- `bun run build` 输出的 chunk 大小中，`index.js` 仍然很大
- Network 瀑布图显示 `vendor-echarts.js` 在首屏就开始加载（而非页面进入时）

**预防策略:**
1. 用 `rollup-plugin-visualizer` 生成 bundle 树图，确认 ECharts 是否真正被懒加载
2. 页面级路由组件必须用 `React.lazy` 包装，且组件内的 ECharts import 不能在模块顶层（应在组件内）
3. 可考虑在不需要图表的页面（如续保清单纯表格页）完全不引入 ECharts 组件

**适用阶段:** 前端 bundle 体积优化阶段（诊断先于优化）

---

### M-05: PolicyFact 惰性加载导致首次查询超时

**症状:** 将 PolicyFact 从启动时物化改为按需加载后，第一个用户请求耗时 30-90 秒。

**根因:** PolicyFact = 380万行 × 53列，逐月分批物化（VPS threads=2）是 `materializeInBatches` 的核心逻辑。如果改为惰性加载，第一个触发物化的请求必须等待全部物化完成才能返回，而连接池其他连接此时无法访问该表（DuckDB 的 `CREATE TABLE AS SELECT` 持有写锁）。

**后果:** 用户认为系统挂起，触发多次刷新，导致多个并发物化请求叠加，VPS OOM。

**预防策略:**
1. 惰性加载策略必须配合"物化状态标志"：物化进行中时，所有对该表的查询回退到 VIEW（慢但不挂）
2. 或采用"预热请求"方案：服务启动后，后台异步触发一次无害的小查询（如 `SELECT COUNT(*) FROM PolicyFact LIMIT 1`）强制物化，用户请求到达时物化已完成
3. 优先拆分 ClaimsAgg/CrossSellFact 为独立视图（改动更小，风险更低），而非对核心 PolicyFact 做惰性加载

**适用阶段:** 数据物化架构优化阶段

---

### M-06: 指纹重算的 statSync 在 VPS 高并发下成为阻塞点

**症状:** 多个并发查询时，所有请求延迟同时升高约 50-200ms，无法用慢 SQL 解释。

**根因:** `duckdb.ts:computeParquetFingerprint()` 对文件列表逐个调用 `statSync(p)` — 这是同步阻塞调用。在 Node.js 单线程事件循环中，`statSync` 会阻塞整个进程直到文件系统返回。项目有 4 个 parquet 分片文件，每次指纹计算需要 4 次 `statSync`。当多个请求并发触发时，这些 `statSync` 串行执行，总延迟叠加。

**检测信号:**
- 慢查询日志中无 DuckDB 执行时间异常，但整体 API 响应时间偏高
- `strace` 或 Node.js profiler 显示大量 `stat` 系统调用集中在同一时间点

**预防策略:**
1. 将 `statSync` 替换为 `stat`（异步版本），并用 `Promise.all()` 并发执行
2. 指纹缓存 TTL 从当前"Parquet 重载时清空"改为"5 分钟 TTL"（`snapshotPathCache` 已有此逻辑作为参考）
3. 对静态分片文件（2021-2023 年历史数据，几乎不变）设置更长 TTL 或跳过 stat 检查

**适用阶段:** 快照缓存精细化阶段

---

## 三、轻量陷阱（Minor Pitfalls）

发现即修，不需要专项阶段。

---

### L-01: useEffect 依赖数组中的 fetchXxx 函数引发无限循环

**症状:** API 请求在不操作任何筛选器的情况下持续发送（Network 标签持续新增请求）。

**根因:** `FeeAnalysisPanel.tsx:39-41` 的 `useEffect` 依赖 `[fetchFeeAnalysis, normalizedParams]`。如果 `fetchFeeAnalysis` 是在 hook 内部每次渲染时新建的函数（未用 `useCallback` 稳定），每次 panel 重渲染都会触发新的 fetch。`normalizedParams` 用 `useMemo` 计算，但如果 `filters` 对象引用每次都是新建的，`useMemo` 失效。

**检测信号:**
- 打开页面后 Network 标签持续增加同路径请求
- React DevTools Profiler 中 `FeeAnalysisPanel` 反复出现在渲染列表

**预防策略:**
- `fetchFeeAnalysis` 在 hook 内必须用 `useCallback` 包装（依赖为空数组或稳定引用）
- `filters` 对象从父组件传入时，父组件应用 `useMemo` 稳定其引用
- 这类问题用 eslint-plugin-react-hooks 的 `exhaustive-deps` 规则可自动检测

---

### L-02: DuckDB VIEW 内使用 f-string 插值的 SQL 注入风险

**症状:** 非预期数据出现在查询结果，或查询报 DuckDB 语法错误。

**根因:** MEMORY.md 已记录"DuckDB VIEW 不支持参数化"，需用 f-string 生成 SQL。项目代码（`renewal-universe.ts:59` `esc()` 函数）已有转义，但并非所有生成器都使用。

**预防策略:**
- 所有用于 SQL 拼接的用户输入字符串必须经过 `escapeSqlValue()`（`server/src/utils/security.ts`）
- 不能依赖前端传入的值在 SQL 中安全，即使有 Zod schema 验证

---

### L-03: 分片 Parquet 文件数量超 14 个导致 DuckDB 扫描退化

**症状:** 趋势查询在数据积累一段时间后从 500ms 退化到 2s+，与 SQL 优化无关。

**根因:** DuckDB 对 `read_parquet(glob)` 扫描多文件时，文件数量越多，文件打开 + row group 统计的开销越大。CONCERNS.md 已标注：`daily.mjs` 的增量分片如果不定期合并，会积累 100+ 小文件。

**预防策略:**
- `daily.mjs` 增加分片数量检查：超过 14 个时触发合并（CONCERNS.md 已建议）
- 在 health check 端点暴露当前分片文件数量

---

### L-04: ECharts 的 `'unsafe-eval'` CSP 指令不能轻易移除

**症状:** 移除 `'unsafe-eval'` 后，ECharts 图表全部空白，控制台报 CSP 违规。

**根因:** ECharts 内部使用 `Function()` 构造器动态编译渲染函数（用于性能优化）。这需要 `'unsafe-eval'` 才能执行。CONCERNS.md 已标注此安全风险，但将其作为"可直接移除"的建议是错误的。

**预防策略:**
- 如要移除 `'unsafe-eval'`，必须先确认 ECharts 版本是否支持 CSP 安全模式（ECharts 5.3+ 有 `csp nonce` 配置）
- 配合 nonce-based CSP 而非直接移除 `unsafe-eval`

---

## 四、阶段-陷阱映射

| 阶段主题 | 必须防范的陷阱 | 建议的验证手段 |
|---------|--------------|----------------|
| 前端 bundle 体积优化 | M-04（chunk 分割失效） | rollup-plugin-visualizer 分析；Network 瀑布图 |
| 前端组件渲染优化 | M-01（ECharts 泄漏）、L-01（无限循环） | React DevTools Memory；Network 请求计数 |
| SQL 生成器拆分 | **C-01（结果静默错误）** | 黄金快照 + Parquet 直查对比；必须在此阶段建立 |
| DuckDB 查询优化 | M-03（CTE 不升反降）、C-04（类型转换） | EXPLAIN ANALYZE 对比；单元测试覆盖转换逻辑 |
| 数据物化架构优化 | C-02（连接池耗尽）、M-05（惰性加载超时） | 压测：PM2 重启期间持续发送 API 请求观察失败率 |
| 快照缓存精细化 | **C-03（跨用户数据泄漏）**、M-02（ETL 不刷新）、M-06（statSync 阻塞） | 安全测试：两个不同权限用户同参数请求比对结果 |
| VPS 内存压力缓解 | M-05（惰性加载超时）、C-02（连接池耗尽） | `free -h` 监控物化前后内存峰值 |

---

## 五、通用验证规程

以下规程在每个阶段完成后执行，防止引入回归：

```bash
# 1. 构建验证（零 TS 报错）
bun run build

# 2. 治理检查（17+ 项自动校验）
bun run governance

# 3. 单元测试
bun run test

# 4. 核心 API 冒烟测试
curl -s localhost:3000/api/query/kpi | jq '.data | length'
curl -s localhost:3000/api/query/dashboard-bundle | jq '.data.kpi | length'

# 5. 快照命中率验证（重构后不应降低）
curl -s localhost:3000/api/data/snapshot-health | jq '.stats'

# 6. SQL 生成器黄金快照对比（SQL 重构阶段专用）
# 重构前：保存基准
# 重构后：diff 对比
```

---

## 六、特别警告：不要在此次重构中做的事

基于代码库现状和项目约束，以下操作风险超过收益：

| 禁止操作 | 原因 |
|---------|------|
| 将 PolicyFact 切换为纯 VIEW（不物化） | 380万行每次查询全扫描，2核VPS无法支撑并发 |
| 一次性重构所有 27 个 SQL 生成器 | 无法同时验证所有生成器的结果一致性；应分批进行 |
| 删除现有快照文件重建 | 快照 miss 期间所有请求回退 DuckDB，VPS 内存压力急剧上升 |
| 在 DuckDB VIEW 定义中引入 JOIN | DuckDB 对 VIEW 内 JOIN 的优化有限，可能比 TABLE 物化慢 10x |
| 移除 Service Worker 后重新部署 | SW 注销需要用户手动清除缓存；如果同时修改 API schema 会引发版本错位 |

---

*审计基础：代码库直接读取（非推断）。信心级别 HIGH。*
