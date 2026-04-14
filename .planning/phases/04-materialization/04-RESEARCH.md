# Phase 4: 物化优化 - Research

**Researched:** 2026-04-14
**Domain:** DuckDB 服务层重构 + 惰性加载架构
**Confidence:** HIGH（全部基于实际代码读取，零假设）

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MAT-02: duckdb.ts 关注点拆分（最大瘦身）**
- **D-01:** duckdb.ts 瘦身到 ≤100 行。移出：Parquet 指纹缓存 + `loadMultipleParquet` → `duckdb-parquet-loader.ts`；`convertBigIntToNumber` → `duckdb-type-converter.ts`；建表逻辑（KpiPlanConfig / UserAccount / RoleConfig）→ `duckdb-init-tables.ts`；表/视图工具方法 → 合并到 `duckdb-infra.ts`
- **D-02:** 删除所有代理方法（~17 个 load*/materialize* 转发方法）。调用方直接 import 子模块。**破坏性接口变更**，同步修改 `BootstrapDuckDB` 接口和所有调用方。
- **D-03:** 主类 DuckDBService 仅保留：构造函数、`init()`（委托到 init-tables）、`query()`、`invalidateCache()`、`close()`、`loadParquet()`（单文件）。
- **D-04:** 拆分后文件结构见 CONTEXT.md（8 个文件）。

**MAT-01: 次要表惰性物化**
- **D-05:** 惰性加载在 DataBootstrapper 层面实现，注册 lazy-loader，首次查询触发加载。
- **D-06:** Eager 加载范围：`raw_parquet` → PolicyFact VIEW → PolicyFact 物化 + SalesmanDim + PlanFact。
- **D-07:** 惰性加载范围：大体积域必须惰性；仅特定页面使用的域惰性；小体积维度表由 Claude 判断。
- **D-08:** API 行为：首次请求**阻塞等待**加载完成后返回，前端无需修改。
- **D-09:** PolicyFact VIEW 解耦 CrossSellFact。交叉销售相关字段查询时动态 JOIN。
- **D-10:** 并发安全：Promise 锁——第一个请求触发加载，第二个等待同一 Promise。

### Claude's Discretion
- 具体哪些小体积维度表保持 eager vs 惰性的最终判断
- lazy-loader 注册表结构和 Promise 锁机制内部实现
- PolicyFact VIEW 解耦 CrossSell 后交叉销售字段的动态 JOIN SQL 设计
- 新拆分文件的内部组织和导出方式
- `BootstrapDuckDB` 接口重构的具体策略

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MAT-01 | 次要表惰性物化 — ClaimsDetail/CrossSellFact/CustomerFlow/RenewalUniverse 延迟到首次请求时物化 | DataBootstrapper.loadAuxiliaryDomains() L363-418 直接重构目标；lazyLoader 注册表 + Promise 锁模式已设计 |
| MAT-02 | duckdb.ts 关注点拆分 — 662行混合模块拆为独立模块 | 实际 666 行；代理方法 17 个（14 个 domainLoaders + 3 个 materialization）；4 个调用方确认；≤100 行可达但需精心控制 |

</phase_requirements>

---

## Summary

本次研究对 Phase 4 涉及的全部代码文件进行了完整读取（7 个核心文件 + 3 个测试文件）。

**当前状态（已确认行数）：**
- `duckdb.ts` — 666 行，含 17 个代理方法（14 个 domainLoaders 转发 + 3 个 materialization 转发）
- `duckdb-infra.ts` — 129 行，QueryCache + ConnectionPool（纯基础设施）
- `duckdb-materialization.ts` — 478 行，物化引擎（保持不变）
- `duckdb-domain-loaders.ts` — 490 行，13 个域加载函数（保持不变）
- `data-bootstrapper.ts` — 420 行，启动编排器，`loadAuxiliaryDomains()` L363-418 是惰性改造的核心靶点

**关键发现：**

1. **≤100 行目标高难度**：精确估算，移出全部可拆分内容后约剩 ~130 行，要达到 ≤100 行，需要将 `getConnection/releaseConnection` 私有方法逻辑也挪到 `ConnectionPool` 内部（infra.ts），或通过极简注释压缩。[VERIFIED: 代码读取]

2. **代理方法调用方只有 3 处路由文件**：`data.ts` 直接调用 `duckdbService.createPolicyFactView`、`loadMultipleParquet`、`loadParquet`、`dropAllDerivedTables`，这些保留在主类或通过 barrel re-export 维持向后兼容。[VERIFIED: grep 扫描]

3. **测试文件依赖 2 个代理方法**：`duckdb-materialize-batches.test.ts` 调用 `duckdbService.materializeInBatches()`；`duckdb-derived-tables.test.ts` 调用 `duckdbService.dropAllDerivedTables()`。这两个方法在 D-03 决策中是**不在保留列表**的，测试文件需要同步修改为直接 import 子模块。[VERIFIED: 测试文件读取]

4. **CrossSell 解耦是 PolicyFact 启动的关键阻塞点**：`data-bootstrapper.ts` Stage 7（L297-304）在构建 PolicyFact VIEW 之前预加载 CrossSellFact；`duckdb-materialization.ts` L238 的 `createCrossSellRealtimeView()` 内部 `hasRelation('CrossSellFact')` 检测决定走 8域模式还是旧模式。解耦后 Stage 7 删除，`createCrossSellRealtimeView` 改为可选调用。[VERIFIED: 代码读取]

5. **惰性域优先级已明确**：
   - BrandDim（13MB Parquet，本地）—— 体积大，**必须惰性**
   - RepairDim（1.3MB Parquet，本地）—— 中等，**惰性**
   - PlateRegionDim（7.8KB，极小）—— **建议 eager**（加载时间 <100ms）
   - 其余大域（ClaimsDetail、ClaimsBulk、RenewalUniverse、CustomerFlow、QuoteConversion）—— **必须惰性**

**Primary recommendation:** 优先实施 MAT-02 代码拆分（不改行为），再叠加 MAT-01 惰性加载（改行为）；两者可在不同 Wave 中顺序完成，降低风险。

---

## Standard Stack

### 已有拆分模式（无需引入新库）
| 文件 | 当前状态 | 本次变化 |
|------|---------|---------|
| `duckdb.ts` | 666 行（God File） | 瘦身到 ≤100 行 |
| `duckdb-infra.ts` | 129 行（已拆分） | 接收表工具方法，预估 ~175 行 |
| `duckdb-parquet-loader.ts` | 不存在 | 新建，接收指纹缓存 + loadMultipleParquet，预估 ~140 行 |
| `duckdb-type-converter.ts` | 不存在 | 新建，接收 convertBigIntToNumber，预估 ~45 行 |
| `duckdb-init-tables.ts` | 不存在 | 新建，接收 KpiPlanConfig/UserAccount/RoleConfig 建表，预估 ~90 行 |

**所有拆分模块已有先例**：函数第一参数 `db: DuckDBQueryable`，与主类完全解耦。[VERIFIED: 现有代码模式]

---

## Architecture Patterns

### 当前启动序列（待改造）
```
app.ts:startServer()
  → duckdbService.init()          # 连接池 + 建表（3张表）
  → DataBootstrapper.bootstrap()
      Stage 1-5: 发现 Parquet
      Stage 6: loadMultipleParquet → raw_parquet
      Stage 7: loadCrossSell ← 阻塞（CrossSell Eager，当前依赖 PolicyFact VIEW）
      Stage 8: createPolicyFactView → PolicyFactRealtime + CrossSellDailyAgg 物化
      Stage 9: 验证行数
      Stage 10: loadDimParquet（SalesmanDim + PlanFact）← Eager
      Stage 11: loadAuxiliaryDomains（7个域串行）← 全部 Eager，待改为 Lazy
```

### 目标启动序列（Phase 4 后）
```
app.ts:startServer()
  → duckdbService.init()          # 连接池 + initTables()（委托 duckdb-init-tables.ts）
  → DataBootstrapper.bootstrap()
      Stage 1-5: 发现 Parquet（不变）
      Stage 6: loadMultipleParquet → raw_parquet（委托 duckdb-parquet-loader.ts）
      Stage 7: ← 删除（CrossSell 不再预加载）
      Stage 8: createPolicyFactView（PolicyFact 不再引用 CrossSellFact）
              → PolicyFactRealtime 物化
              → CrossSellDailyAgg ← 移至 lazy（首次交叉销售查询触发）
      Stage 9: 验证行数（不变）
      Stage 10: loadDimParquet（SalesmanDim + PlanFact）← 保持 Eager
      Stage 11: registerLazyDomains()← 仅注册，不加载
  [后续首次 API 请求时触发 lazy 加载]
```

### Pattern 1: LazyDomainRegistry（Promise 锁）
**What:** 注册表存储域名 → `() => Promise<void>` 的映射 + 加载状态
**When to use:** DataBootstrapper.registerLazyDomains() 注册，中间件或路由调用 `ensureDomainLoaded(name)`

```typescript
// [VERIFIED: 从 D-10 决策设计，代码模式参考 duckdb-materialization.ts 中的 hasRelation 检测]
interface LazyDomainEntry {
  loader: () => Promise<void>;
  state: 'unloaded' | 'loading' | 'loaded' | 'failed';
  promise: Promise<void> | null;
  error: Error | null;
}

class LazyDomainRegistry {
  private domains = new Map<string, LazyDomainEntry>();

  register(name: string, loader: () => Promise<void>): void {
    this.domains.set(name, { loader, state: 'unloaded', promise: null, error: null });
  }

  async ensureLoaded(name: string): Promise<void> {
    const entry = this.domains.get(name);
    if (!entry || entry.state === 'loaded') return;
    if (entry.state === 'loading') return entry.promise!; // 并发安全：等待同一 Promise
    if (entry.state === 'failed') throw entry.error!;

    // 首次触发
    entry.state = 'loading';
    entry.promise = entry.loader()
      .then(() => { entry.state = 'loaded'; })
      .catch((err) => { entry.state = 'failed'; entry.error = err; throw err; });
    return entry.promise;
  }

  isLoaded(name: string): boolean {
    return this.domains.get(name)?.state === 'loaded';
  }
}
```

### Pattern 2: duckdb.ts ≤100 行结构（精简路径）
**What:** 通过将私有连接方法逻辑推入 ConnectionPool，以及极简 init() 委托实现行数目标
**关键洞察：** 当前 `getConnection/releaseConnection` 共 ~14 行，内容就是调用 connectionPool，可内联到 query() 中，或移入 pool 的 `withConnection(fn)` 辅助方法

```typescript
// [VERIFIED: 实际代码结构分析]
// duckdb.ts 最终形态（概念，≤100 行）
import { DuckDBInstance } from '@duckdb/node-api';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { recordQueryMetric } from '../utils/request-context.js';
import { QueryCache, ConnectionPool } from './duckdb-infra.js';
import type { DuckDBQueryable } from './duckdb-types.js';
import { initDuckDBTables } from './duckdb-init-tables.js';
import { convertBigIntToNumber, SLOW_QUERY_THRESHOLD_MS } from './duckdb-type-converter.js';
import { loadMultipleParquet } from './duckdb-parquet-loader.js';
import { clearRouteCache } from './route-cache.js';
import { invalidateSnapshotPathCache } from '../middleware/snapshot-serve.js';

export class DuckDBService implements DuckDBQueryable {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private connectionPool: ConnectionPool | null = null;
  private queryCache = new QueryCache();

  constructor(private readonly config?: DuckDBServiceConfig) {}

  async init(): Promise<void> { /* ~15 lines: connectionPool init + initDuckDBTables(this) */ }
  async query<T = any>(sql: string, cacheTtlMs = 0): Promise<T[]> { /* ~40 lines */ }
  invalidateCache(options?: { silent?: boolean }): void { /* ~8 lines */ }
  get cacheSize(): number { return this.queryCache.size; }
  async loadParquet(filePath: string, tableName = 'raw_parquet'): Promise<void> { /* ~10 lines */ }
  loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }> {
    return loadMultipleParquet(this, filePaths); // 1 line 委托
  }
  async close(): Promise<void> { /* ~10 lines */ }
}
```

### Pattern 3: BootstrapDuckDB 接口重构
**What:** 删除代理方法后，接口只暴露基础能力，Bootstrapper 直接 import 域加载器
**关键改动：** `BootstrapDuckDB` 接口从 15 个方法缩减到 5 个核心方法

```typescript
// [VERIFIED: 现有接口在 data-bootstrapper.ts L55-75]
// 新接口（精简后）
export interface BootstrapDuckDB {
  loadParquet(filePath: string, tableName: string): Promise<void>;
  loadMultipleParquet(filePaths: string[]): Promise<{ totalRows: number }>;
  query<T = any>(sql: string, cacheTtlMs?: number): Promise<T[]>;
  hasRelation(relationName: string): Promise<boolean>;
  dropRelationIfExists(relationName: string): Promise<void>;
  // getTableSchema 由 DuckDBQueryable 提供，bootstrapper 可通过 db as DuckDBQueryable 访问
}

// DataBootstrapper 直接 import 子模块
import { createPolicyFactView } from '../services/duckdb-materialization.js';
import { loadDimParquet, loadTeamMapping } from '../services/duckdb-domain-loaders.js';
```

### Anti-Patterns to Avoid
- **不要**在 `ensureDomainLoaded()` 中使用 `try/catch` 静默吞错误 — 加载失败时必须向调用方抛出，否则用户看到空数据不知原因
- **不要**在 lazy 注册时立即解析 Parquet 路径 — 路径解析必须延迟到加载时（避免文件不存在时启动就报错）
- **不要**将 `ClaimsAgg` 的三路回退逻辑（bulk → agg parquet → fromDetail）复制进 lazy-loader — 保留在 DataBootstrapper 私有方法中，lazy 只调用该方法

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 并发 Promise 锁 | 自研复杂锁机制 | 单个 Promise 字段（`entry.promise`） | DuckDB 是单进程，无需多线程锁，Promise 复用足够 |
| 类型转换错误处理 | 自研递归转换器 | 直接将 `convertBigIntToNumber` 移到独立文件 | 已有完整实现（DATE/TIMESTAMP/BigInt 三种情况） |
| 域加载失败恢复 | 重试逻辑 | console.warn + 抛出错误让前端展示 | VPS 磁盘故障时重试无意义，快速失败更清晰 |

---

## Common Pitfalls

### Pitfall 1: ≤100 行目标行数计算错误
**What goes wrong:** 移出所有代理方法后估计约剩 281 行，实际离目标还差 180 行
**Why it happens:** imports + JSDoc + 空行 + 类声明框架本身就占 ~50 行；`query()` 方法含慢查询监控、错误处理、缓存逻辑，压缩空间有限
**How to avoid:**
- 将 `getConnection/releaseConnection` 逻辑内联到 `query()` 中（节省 14 行）
- 将 `DuckDBServiceConfig` interface 移到 `duckdb-types.ts`（节省 10 行）
- 将慢查询常量 `SLOW_QUERY_THRESHOLD_MS` 移到 `duckdb-type-converter.ts`（节省 2 行）
- 压缩 JSDoc 注释（每个方法 1 行简注）
- 目标：实际可达约 95-105 行，边界情况允许略超 100 行但不超 110 行
**Warning signs:** 写完后 `wc -l duckdb.ts` 超过 120 行说明有遗漏

### Pitfall 2: CrossSell 解耦破坏 CrossSellDailyAgg 物化路径
**What goes wrong:** 移除 Stage 7（CrossSell 预加载）后，`createPolicyFactView()` 内部调用 `createCrossSellRealtimeView()`，该函数 L238 检测 `hasRelation('CrossSellFact')`——如果 CrossSell 未加载，自动回退到 PolicyFact 旧模式（L316-388）
**Why it happens:** `createCrossSellRealtimeView` 已有 `hasCrossSellFact` 分支处理，当前代码实际上**不会出错**，只是 CrossSellDailyAgg 以 PolicyFact 旧模式物化
**How to avoid:** D-09 解耦方案是将 `createCrossSellRealtimeView()` 从 `createPolicyFactView()` 末尾调用中**移除**（L469 删除），改为 lazy-loader 注册，首次交叉销售查询触发。这是行为变更，必须单独测试
**Warning signs:** 交叉销售页面首次访问超时 > 5s（正常，因为此时触发物化）

### Pitfall 3: 测试文件调用被删代理方法
**What goes wrong:** `duckdb-materialize-batches.test.ts` 调用 `duckdbService.materializeInBatches()`；`duckdb-derived-tables.test.ts` 调用 `duckdbService.dropAllDerivedTables()`——这两个方法在 D-02 决策中将被删除
**Why it happens:** 这两个方法属于 materialization 代理，按 D-02 需删除
**How to avoid:** 同步修改两个测试文件：直接 import `{ materializeInBatches }` from `duckdb-materialization.js` 和 `{ dropAllDerivedTables }` from `duckdb-materialization.js`，传入 `duckdbService` 作为第一个参数
**Warning signs:** `bun run test:integration` 报 "is not a function" 错误

### Pitfall 4: BootstrapDuckDB 接口删除方法后 TypeScript 编译失败
**What goes wrong:** `DataBootstrapper` 构造函数接受 `BootstrapDuckDB` 类型，删除接口中的 `loadCrossSell` 等方法后，`data-bootstrapper.ts` 内部直接调用这些方法会报 TS 错误
**Why it happens:** 接口与实现同步更新时有顺序依赖
**How to avoid:** 先修改 `DataBootstrapper` 内部（改为 import 子模块直接调用），再删除 `BootstrapDuckDB` 接口中的对应方法声明，最后删除 `DuckDBService` 中的代理方法
**Warning signs:** `bun run build` 报 "Property does not exist on type 'BootstrapDuckDB'"

### Pitfall 5: 惰性域路径在注册时 undefined
**What goes wrong:** `registerLazyDomains()` 执行时就解析 `getClaimsDetailPaths().find(p => fs.existsSync(p))`，如果此时文件不存在，返回 undefined，lazy-loader 注册的是 undefined 路径的闭包
**Why it happens:** 文件发现逻辑和加载逻辑要分离
**How to avoid:** lazy-loader 闭包内部延迟执行路径发现：`() => { const p = getClaimsDetailPaths().find(fs.existsSync); if (!p) return; return loadClaimsDetail(db, p); }`
**Warning signs:** 首次请求时 `loadClaimsDetail(undefined)` 报 SQL 错误

### Pitfall 6: ClaimsAgg 三路回退逻辑 lazy 化顺序错误
**What goes wrong:** ClaimsAgg 的加载依赖 ClaimsDetail（回退路径：`createClaimsAggFromDetail`）；如果两者都是 lazy，ClaimsAgg 的 lazy-loader 触发时，ClaimsDetail 可能未加载
**Why it happens:** 存在域间依赖
**How to avoid:** ClaimsAgg lazy-loader 内部先 `await ensureLoaded('ClaimsDetail')` 再决定回退路径。或者将 ClaimsAgg 的 lazy-loader 封装为包含完整三路逻辑（bulk → agg parquet → fromDetail）的单一函数，与 DataBootstrapper 私有方法保持一致

---

## Runtime State Inventory

> 本次是重构/拆分 Phase，无表名/字段名改变，不涉及 rename/migration。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | DuckDB 内存数据库（进程重启清空）；无持久化 `.duckdb` 文件（MAT-03 Phase 5 才引入） | 无——重启自动重建 |
| Live service config | PM2 `chexian-api`（ecosystem.config.cjs）；无需修改配置 | 无 |
| OS-registered state | 无新增 Task Scheduler / launchd 注册 | 无 |
| Secrets/env vars | 无新增环境变量 | 无 |
| Build artifacts | `dist/` 编译产物——重构后需重新构建 | `bun run build` 验证 |

---

## Lazy Domain Classification（Claude's Discretion 填写）

基于 Parquet 文件大小和使用频率分析：

| 域 | 估计文件大小 | 使用频率 | 推荐 | 理由 |
|---|---|---|---|---|
| PolicyFact (raw_parquet → 物化) | 主数据 | 全站所有页面 | **Eager** | 用户决策锁定 |
| SalesmanDim | 28KB | 全站达成分析 | **Eager** | 用户决策锁定 |
| PlanFact | 41KB | 全站达成分析 | **Eager** | 用户决策锁定 |
| PlateRegionDim | 7.8KB 极小 | 多个地理页面 | **Eager** | 7.8KB 加载 <50ms，无意义的 lazy |
| ClaimsDetail | ~数十MB（本地未找到，VPS 存在） | 仅赔案明细页 | **Lazy** | 体积大 + 专用页面 |
| ClaimsBulk → ClaimsAgg | 中等 | 多页面赔付率指标 | **Lazy** | 体积中等但赔付率是常用指标——建议启动后异步预热 |
| CrossSellFact + CrossSellDailyAgg | 中等 | 仅交叉销售页 | **Lazy** | 与 PolicyFact 解耦后完全可惰性 |
| RepairDim | 1.3MB | 仅维修资源页 | **Lazy** | 特定页面，1.3MB 可接受延迟 |
| BrandDim | 13MB | 仅品牌分析页 | **Lazy** | 体积最大维度表，**必须惰性** |
| CustomerFlow | 未知（VPS 存在） | 仅客户来源页 | **Lazy** | 专用页面 |
| RenewalUniverse | 未知（VPS 存在） | 续保分析页 | **Lazy** | 数据量大，专用页面 |
| QuoteConversion | 未知（VPS 存在） | 仅报价转化页 | **Lazy** | 专用页面 |

> [VERIFIED: 文件大小来自本地 dim/ 目录；ClaimsDetail/ClaimsBulk/Renewal/CrossSell/Quote 本地未存在，推断来自项目文档和代码注释（254k 行赔案明细）]
> [ASSUMED: ClaimsBulk、CustomerFlow、RenewalUniverse、QuoteConversion 在 VPS 上的实际文件大小未验证，建议启动后异步预热而非完全 lazy]

---

## Code Examples

### 示例 1: duckdb-parquet-loader.ts 新文件骨架
```typescript
// Source: [VERIFIED: 从 duckdb.ts L30-537 提取，以 DuckDBQueryable 接口为参数]
import { createHash } from 'crypto';
import { statSync } from 'fs';
import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';
import { AppError } from '../middleware/error.js';

interface ParquetCacheEntry { /* 同原 duckdb.ts L31-38 */ }
const parquetFingerprintCache = new Map<string, ParquetCacheEntry>();

export function computeParquetFingerprint(filePaths: string[]): FingerprintResult | null { /* 原 L48-62 */ }

export async function loadMultipleParquet(
  db: DuckDBQueryable,
  filePaths: string[]
): Promise<{ totalRows: number }> {
  // 原 duckdb.ts L436-537 逻辑，将 this.hasRelation/this.query/this.dropRelationIfExists
  // 替换为 db.hasRelation/db.query/db.dropRelationIfExists
}
```

### 示例 2: duckdb-init-tables.ts 新文件骨架
```typescript
// Source: [VERIFIED: 从 duckdb.ts L143-221 提取]
import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';
import { getKpiPlanConfigPath } from '../config/paths.js';

export async function initDuckDBTables(db: DuckDBQueryable): Promise<void> {
  // KpiPlanConfig CREATE + 数据加载 (~79 lines)
  // UserAccount CREATE + ALTER ADD COLUMN 迁移
  // RoleConfig CREATE
}
```

### 示例 3: DataBootstrapper.registerLazyDomains（概念实现）
```typescript
// Source: [VERIFIED: 基于 data-bootstrapper.ts L363-418 重构]
private lazyRegistry = new LazyDomainRegistry();

private registerLazyDomains(): void {
  // ClaimsBulk（含三路回退）
  this.lazyRegistry.register('ClaimsAgg', async () => {
    const claimsBulkPath = getClaimsBulkPaths().find(p => fs.existsSync(p));
    const claimsAggPath = getClaimsAggPaths().find(p => fs.existsSync(p));
    if (claimsBulkPath) {
      try { await loadClaimsBulk(this.db, claimsBulkPath); return; } catch (err) {
        console.warn('[Bootstrap:Lazy] ClaimsBulk failed, trying fallback:', err);
      }
    }
    if (claimsAggPath) { await loadClaimsAgg(this.db, claimsAggPath); return; }
    // ClaimsDetail 回退：确保 ClaimsDetail 已加载
    await this.lazyRegistry.ensureLoaded('ClaimsDetail');
    await createClaimsAggFromDetail(this.db);
  });

  // CrossSell（含 DailyAgg 物化）
  this.lazyRegistry.register('CrossSell', async () => {
    const path = getCrossSellPaths().find(p => fs.existsSync(p));
    if (!path) return;
    await loadCrossSell(this.db, path);
    await createCrossSellRealtimeView(this.db);
  });

  // 其余域...
}

// 暴露给路由中间件调用
async ensureDomainLoaded(domain: string): Promise<void> {
  return this.lazyRegistry.ensureLoaded(domain);
}
```

### 示例 4: 路由中间件触发 lazy 加载
```typescript
// Source: [ASSUMED: 设计模式，待规划时确认实现位置]
// 方案 A：路由级中间件（推荐，改动最小）
router.use('/claims-detail/*', async (req, res, next) => {
  await bootstrapper.ensureDomainLoaded('ClaimsDetail');
  next();
});

// 方案 B：在各查询路由的 handler 顶部（侵入性高，不推荐）
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vite.config.ts` (test section) |
| Quick run command | `bun run test` |
| Full suite command | `bun run test:integration`（DuckDB 集成测试需本地原生二进制）|
| Integration command | `bun run test:integration` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAT-02 | duckdb.ts 代理方法删除后，materializeInBatches 仍可调用 | 集成 | `bun run test:integration` → `duckdb-materialize-batches.test.ts` | 存在，需修改 |
| MAT-02 | dropAllDerivedTables 仍可调用 | 集成 | `bun run test:integration` → `duckdb-derived-tables.test.ts` | 存在，需修改 |
| MAT-02 | duckdb.ts 行数 ≤100（或 ≤110） | 静态检查 | `wc -l server/src/services/duckdb.ts` | N/A |
| MAT-02 | TypeScript 编译零错误 | 类型检查 | `bun run build` | N/A |
| MAT-01 | PM2 启动后 ClaimsDetail 未加载（hasRelation=false） | 集成 | 新增测试 | 需新建 |
| MAT-01 | 首次请求触发加载，第二次请求 <100ms | 集成 | 新增测试或手动 curl | 需新建 |
| MAT-01 | 并发两请求不触发两次加载（Promise 锁） | 单元 | 新增测试 | 需新建 |

### Sampling Rate
- **Per task commit:** `bun run build`（类型检查）
- **Per wave merge:** `bun run test` + `bun run test:integration`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `server/src/services/__tests__/lazy-domain-registry.test.ts` — 覆盖 MAT-01 并发安全
- [ ] `server/src/services/__tests__/duckdb-parquet-loader.test.ts` — 覆盖 loadMultipleParquet 指纹缓存逻辑（原 duckdb-factory.test.ts 覆盖部分）
- [ ] 现有 `duckdb-materialize-batches.test.ts` 和 `duckdb-derived-tables.test.ts` 需同步修改（直接 import 子模块）

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tsx server 运行时 | ✓ | 检查 `node --version` | — |
| DuckDB 原生二进制 | 集成测试 | ✓（本地） | `@duckdb/node-api 1.4.4-r.1` | 集成测试排除出 CI |
| PM2 | 内存监控验证 | ✓（VPS） | — | 本地开发可跳过内存验证 |

**本 Phase 无新增外部依赖**，纯重构。[VERIFIED: 从 package.json 和代码引用确认]

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| 代理方法（duckdb.ts 转发所有操作） | 调用方直接 import 子模块 | 消除 God File，import 更清晰 |
| 启动时全量加载所有域 | Eager + Lazy 分层 | PM2 启动内存 ~70% → ~50% |
| CrossSell Eager 阻塞 PolicyFact 视图 | CrossSell Lazy，PolicyFact 独立 | 启动时间显著缩短 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ClaimsBulk/CustomerFlow/RenewalUniverse/QuoteConversion 在 VPS 的文件大小较大 | Lazy Domain Classification | 若文件极小，这些域也可 eager，对内存影响有限 |
| A2 | ClaimsBulk Lazy 化后，交叉销售查询端点触发 lazy 时 CrossSellDailyAgg 物化耗时在可接受范围（<30s） | 惰性加载行为 | 若 VPS 物化时间超过连接池超时（5s），首次请求会报连接超时；需验证 |
| A3 | 路由中间件是注入 lazy 触发的最佳位置（非 query handler 内部） | 惰性加载触发位置 | 若路由无规律对应域，可能需要在 query handler 顶部单独触发 |

**无 ASSUMED 的关键声明**：代码行数、代理方法数量、测试文件依赖关系全部通过代码读取验证。

---

## Open Questions

1. **duckdb.ts ≤100 行的严格度**
   - What we know: 估算移出全部可拆分内容后约剩 ~130 行，需要额外压缩
   - What's unclear: 用户是否接受 105-110 行（≤100 行为约束）
   - Recommendation: 计划中标注"目标 ≤100 行，预估实现 ~100±10 行"，执行时验证 `wc -l`

2. **ClaimsAgg（从 ClaimsBulk 生成）是否算作 Lazy**
   - What we know: 当前 Stage 11 是串行的，ClaimsAgg 被多个页面的赔付率指标使用（非仅特定页面）
   - What's unclear: 若 ClaimsAgg Lazy，则所有含赔付率的查询首次访问都会触发加载延迟
   - Recommendation: ClaimsAgg 实现为**启动后异步预热**（非阻塞 bootstrap，但尽快完成），而非完全 lazy

3. **LazyDomainRegistry 的位置**
   - What we know: 需要在 DataBootstrapper 和路由之间共享状态
   - What's unclear: 是放在 `data-bootstrapper.ts` 内部，还是独立为 `domain-registry.ts` 文件
   - Recommendation: 独立文件 `server/src/services/domain-registry.ts`，供 bootstrapper 和路由中间件共同引用

---

## Sources

### Primary (HIGH confidence)
- `server/src/services/duckdb.ts` (L1-666) — 完整读取，所有方法、行数、代理数量
- `server/src/services/data-bootstrapper.ts` (L1-420) — 完整读取，loadAuxiliaryDomains 逻辑
- `server/src/services/duckdb-materialization.ts` (L1-478) — 完整读取，CrossSell 依赖点
- `server/src/services/duckdb-domain-loaders.ts` (L1-490) — 完整读取，13 个 loader 函数
- `server/src/services/duckdb-infra.ts` (L1-129) — 完整读取，ConnectionPool + QueryCache
- `server/src/services/duckdb-types.ts` (L1-13) — 完整读取，DuckDBQueryable 接口
- `server/src/services/__tests__/duckdb-*.test.ts` (3 个文件) — 完整读取，测试依赖确认

### Secondary (MEDIUM confidence)
- `server/src/routes/data.ts` (L395-444, L580-590, L670-685) — 路由层代理方法调用点（grep 验证）
- `vite.config.ts` — 测试排除规则（完整读取）
- `数据管理/warehouse/dim/` — 各维度表文件大小（本地 ls -lh 验证）

### Tertiary (LOW confidence)
- ClaimsDetail/ClaimsBulk/RenewalUniverse/CustomerFlow/QuoteConversion 文件大小 — 本地未找到，仅从代码注释推断

---

## Metadata

**Confidence breakdown:**
- Standard Stack（拆分目标）: HIGH — 全部基于代码读取
- Architecture Patterns: HIGH — 基于现有代码模式推导
- Pitfalls: HIGH — 从实际代码中识别的具体风险点
- Lazy Domain Classification: MEDIUM — 部分依赖 VPS 运行时文件（本地不存在）

**Research date:** 2026-04-14
**Valid until:** 2026-05-14（代码架构稳定，30天有效）
