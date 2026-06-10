# cx CLI 全能力重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cx CLI 全面具备项目全部只读能力（71 个 query 端点 + filters/data/health 域）并落地 CLI 最佳实践契约。

**Architecture:** 三层一次打通——server 端补全能力登记（QUERY_ROUTES 17 条常量 + route-catalog 39 条元数据）、governance 三方对账检查根治再漂移、CLI 混合式重构（query 域动态 catalog 驱动 + 非 query 域静态领域命令）。

**Tech Stack:** TypeScript + commander + cli-table3 + kleur + vitest；server 端 Express + zod。

**Spec:** `开发文档/specs/2026-06-09-cx-cli-full-capability-design.md`

---

## 文件结构

```
server/src/config/api-routes.ts                 # 修改：补 17 条常量
src/shared/api/routes.ts                        # 不动（前端镜像已有，server 对齐它）
server/src/config/query-routes-metadata.ts      # 修改：补 39 条元数据
scripts/check-governance.mjs                    # 修改：新增 QueryCatalog 对账检查
cli/src/exit-codes.ts                           # 新建：退出码契约
cli/src/api.ts                                  # 修改：超时/错误→退出码映射
cli/src/index.ts                                # 修改：全局选项 + 新命令注册 + version 单源
cli/src/output.ts                               # 修改：--limit 截断
cli/src/commands/query.ts                       # 修改：path 直通 + --limit/--timeout
cli/src/commands/routes.ts                      # 修改：--search + tag 分组
cli/src/commands/sql.ts                         # 修改：stdin 支持
cli/src/commands/whoami.ts                      # 修改：dataScope/tokenId/baseUrl
cli/src/commands/filters.ts                     # 新建
cli/src/commands/data.ts                        # 新建
cli/src/commands/health.ts                      # 新建
cli/src/commands/config-cmd.ts                  # 新建
cli/src/commands/completion.ts                  # 新建
cli/src/__tests__/*.test.ts                     # 新增/扩充
cli/README.md + 开发文档/PAT_GUIDE.md            # 文档同步
```

---

### Task 1: server — QUERY_ROUTES 补 17 条常量（对齐前端镜像）

**Files:** Modify `server/src/config/api-routes.ts`

- [ ] **Step 1**: 在 QUERY_ROUTES 对象内（PIVOT/SQL 之前）追加，值 = 前端镜像 `src/shared/api/routes.ts` 对应值加 `/` 前缀：

```typescript
  // 费用率发展
  EXPENSE_DEVELOPMENT: '/expense-development',

  // 客户来源去向
  CUSTOMER_FLOW: {
    SUMMARY: '/customer-flow/summary',
    INFLOW: '/customer-flow/inflow',
    OUTFLOW: '/customer-flow/outflow',
    TREND: '/customer-flow/trend',
    METADATA: '/customer-flow/metadata',
  },

  // 赔案明细
  CLAIMS_DETAIL: {
    PENDING_OVERVIEW: '/claims-detail/pending-overview',
    PENDING_BY_ORG: '/claims-detail/pending-by-org',
    PENDING_AGING: '/claims-detail/pending-aging',
    CAUSE_ANALYSIS: '/claims-detail/cause-analysis',
    GEO_ACCIDENT: '/claims-detail/geo-accident',
    GEO_PLATE: '/claims-detail/geo-plate',
    GEO_COMPARISON: '/claims-detail/geo-comparison',
    CLAIM_CYCLE: '/claims-detail/claim-cycle',
    FREQUENCY_YOY: '/claims-detail/frequency-yoy',
    LOSS_RATIO_DEV: '/claims-detail/loss-ratio-development',
    HEATMAP: '/claims-detail/heatmap',
  },
```

- [ ] **Step 2**: `cd server && bunx tsc --noEmit` 零报错
- [ ] **Step 3**: commit `feat(server): QUERY_ROUTES 补 claims-detail/customer-flow/expense-development 17 条常量（对齐前端镜像）`

### Task 2: server — route-catalog 补 39 条元数据

**Files:** Modify `server/src/config/query-routes-metadata.ts`

- [ ] **Step 1**: 在 COMMON_PARAMS 后追加域级参数常量（从各子路由 zod schema 提炼，提示性）：

```typescript
// 报价转化域公共参数（quote-conversion.ts quoteFilterSchema）
const QUOTE_PARAMS: QueryRouteParam[] = [
  { name: 'dateStart', type: 'date', description: '起保日期下限 YYYY-MM-DD' },
  { name: 'dateEnd', type: 'date', description: '起保日期上限 YYYY-MM-DD' },
  { name: 'renewalType', type: 'string', description: '续转类型', enum: ['续保', '转保'] },
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'teamName', type: 'string', description: '销售团队名' },
  { name: 'salesmanNo', type: 'string', description: '业务员工号' },
  { name: 'customerCategory', type: 'string', description: '客户类别（11 类）' },
  { name: 'insuranceCombo', type: 'string', description: '险别组合', enum: ['主全', '交三'] },
  { name: 'isTelemarketing', type: 'string', description: '是否电销', enum: ['电销', '非电销'] },
  { name: 'isNewEnergy', type: 'string', description: '是否新能源', enum: ['是', '否'] },
  { name: 'isTransferred', type: 'string', description: '是否过户', enum: ['是', '否'] },
  { name: 'riskGrade', type: 'string', description: '风险等级', enum: ['A', 'B', 'C', 'D'] },
  { name: 'ncdMin', type: 'number', description: 'NCD 系数下限' },
  { name: 'ncdMax', type: 'number', description: 'NCD 系数上限' },
];

// 维修资源域 v1 公共参数（repair.ts filterSchema）
const REPAIR_PARAMS: QueryRouteParam[] = [
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'is4sShop', type: 'string', description: '是否 4S 店', enum: ['true', 'false'] },
  { name: 'cooperationStatus', type: 'string', description: '合作状态' },
  { name: 'city', type: 'string', description: '城市' },
];

// 维修资源域 v2 追加参数（repair.ts filterSchemaV2）
const REPAIR_PARAMS_V2: QueryRouteParam[] = [
  ...REPAIR_PARAMS,
  { name: 'district', type: 'string', description: '区县' },
  { name: 'shopCode', type: 'string', description: '修理厂编码' },
  { name: 'coopTier', type: 'string', description: '合作层级', enum: ['active', 'past', 'none'] },
  { name: 'timeWindow', type: 'string', description: '时间窗', enum: ['ytd', 'rolling12', 'all'] },
];

// 赔案明细域公共参数（claims-detail.ts parseFilters）
const CLAIMS_DETAIL_PARAMS: QueryRouteParam[] = [
  { name: 'dateStart', type: 'date', description: '出险日期下限 YYYY-MM-DD' },
  { name: 'dateEnd', type: 'date', description: '出险日期上限 YYYY-MM-DD' },
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'claimStatus', type: 'string', description: '赔案状态（已结案/未结案）' },
  { name: 'isBodilyInjury', type: 'string', description: '是否人伤案' },
  { name: 'accidentCause', type: 'string', description: '出险原因' },
  { name: 'accidentCity', type: 'string', description: '出险城市' },
  { name: 'customerCategory', type: 'string', description: '客户类别（11 类）' },
  { name: 'isNev', type: 'string', description: '是否新能源', enum: ['是', '否'] },
  { name: 'coverageCombination', type: 'string', description: '险别组合' },
  { name: 'isTransfer', type: 'string', description: '是否过户', enum: ['是', '否'] },
  { name: 'vehicleQuickFilter', type: 'string', description: '车型快捷预设' },
  { name: 'businessNature', type: 'string', description: '业务性质' },
  { name: 'isNewCar', type: 'string', description: '是否新车', enum: ['是', '否'] },
  { name: 'isRenewal', type: 'string', description: '是否续保', enum: ['是', '否'] },
  { name: 'cutoffDate', type: 'date', description: '满期口径截止日（earned 分母计算）' },
];

// 客户来源去向域参数（customer-flow.ts filterSchema）
const CUSTOMER_FLOW_PARAMS: QueryRouteParam[] = [
  { name: 'year', type: 'number', description: '保单年度（2020-2030）' },
];
```

- [ ] **Step 2**: 在 QUERY_ROUTE_METADATA 数组尾部（RED LINE：只追加）按下表追加 39 条 entry。**key 一律扁平 SCREAMING_SNAKE（禁止点号，MCP tool 名 `[a-zA-Z0-9_-]` 约束）**，method 均 'GET'，dataScope 均 'any'：

| key | path | summary | parameters | tags |
|---|---|---|---|---|
| QUOTE_CONVERSION_KPI | /quote-conversion/kpi | 报价转化 KPI 汇总 | QUOTE_PARAMS | quote-conversion, kpi |
| QUOTE_CONVERSION_FUNNEL | /quote-conversion/funnel | 报价转化漏斗 | QUOTE_PARAMS | quote-conversion |
| QUOTE_CONVERSION_DRILLDOWN | /quote-conversion/drilldown | 报价转化多维下钻 | QUOTE_PARAMS +（name:'dimension', type:'string', description:'下钻维度'）| quote-conversion |
| QUOTE_CONVERSION_HEATMAP | /quote-conversion/heatmap | 报价转化机构×维度热力图 | QUOTE_PARAMS | quote-conversion |
| QUOTE_CONVERSION_PRICE | /quote-conversion/price | 报价价格带分析 | QUOTE_PARAMS | quote-conversion |
| QUOTE_CONVERSION_RANKING | /quote-conversion/ranking | 报价转化排名 | QUOTE_PARAMS | quote-conversion, ranking |
| QUOTE_CONVERSION_TREND | /quote-conversion/trend | 报价转化时间趋势 | QUOTE_PARAMS | quote-conversion, trend |
| POLICY_GEO_PROVINCE | /policy-geo/province | 承保地理分布（省级，按车牌归属地） | COMMON_PARAMS.year | policy-geo |
| POLICY_GEO_CITY | /policy-geo/city | 承保地理分布（市级，按车牌归属地） | COMMON_PARAMS.year +（name:'province', type:'string', description:'省份名'）| policy-geo |
| REPAIR_OVERVIEW | /repair/overview | 维修资源机构级汇总 | REPAIR_PARAMS | repair |
| REPAIR_DETAIL | /repair/detail | 修理厂明细（分页） | REPAIR_PARAMS +（name:'page', type:'number', description:'页码，默认 1'）（name:'pageSize', type:'number', description:'每页行数，默认 200 上限 500'）| repair |
| REPAIR_STATUS | /repair/status | 维修合作状态分布 | REPAIR_PARAMS | repair |
| REPAIR_METADATA | /repair/metadata | 维修资源维度元数据 | [] | repair, metadata |
| REPAIR_CITY | /repair/city | 维修资源城市下钻 | REPAIR_PARAMS_V2 | repair |
| REPAIR_CHANNEL | /repair/channel | 维修送修渠道分析 | REPAIR_PARAMS_V2 | repair |
| REPAIR_COOP_TIER | /repair/coop-tier | 合作层级分布 | REPAIR_PARAMS_V2 | repair |
| REPAIR_SCATTER | /repair/scatter | 修理厂散点（送修量×产值） | REPAIR_PARAMS_V2 | repair |
| REPAIR_LOCAL_RESOURCE | /repair/local-resource | 本地维修资源占比 | REPAIR_PARAMS_V2 | repair |
| REPAIR_TO_PREMIUM | /repair/to-premium | 送修转保费分析 | REPAIR_PARAMS_V2 | repair |
| REPAIR_DIVERSION_LIST | /repair/diversion-list | 导流清单 | REPAIR_PARAMS_V2 | repair |
| REPAIR_ORPHAN_SHOPS | /repair/orphan-shops | 无合作送修修理厂清单 | REPAIR_PARAMS_V2 | repair |
| CLAIMS_DETAIL_PENDING_OVERVIEW | /claims-detail/pending-overview | 未决赔案概览（已结 vs 未结汇总） | CLAIMS_DETAIL_PARAMS | claims-detail, pending |
| CLAIMS_DETAIL_PENDING_BY_ORG | /claims-detail/pending-by-org | 未决赔案按机构分布 | CLAIMS_DETAIL_PARAMS | claims-detail, pending |
| CLAIMS_DETAIL_PENDING_AGING | /claims-detail/pending-aging | 未决赔案账龄分析 | CLAIMS_DETAIL_PARAMS | claims-detail, pending |
| CLAIMS_DETAIL_CAUSE_ANALYSIS | /claims-detail/cause-analysis | 出险原因分析 | CLAIMS_DETAIL_PARAMS | claims-detail |
| CLAIMS_DETAIL_GEO_ACCIDENT | /claims-detail/geo-accident | 出险地点地理分布 | CLAIMS_DETAIL_PARAMS | claims-detail, geo |
| CLAIMS_DETAIL_GEO_PLATE | /claims-detail/geo-plate | 车牌归属地地理分布 | CLAIMS_DETAIL_PARAMS | claims-detail, geo |
| CLAIMS_DETAIL_GEO_COMPARISON | /claims-detail/geo-comparison | 出险地 vs 归属地对比 | CLAIMS_DETAIL_PARAMS | claims-detail, geo |
| CLAIMS_DETAIL_CLAIM_CYCLE | /claims-detail/claim-cycle | 理赔周期分析 | CLAIMS_DETAIL_PARAMS | claims-detail |
| CLAIMS_DETAIL_FREQUENCY_YOY | /claims-detail/frequency-yoy | 出险频度同比 | CLAIMS_DETAIL_PARAMS | claims-detail, trend |
| CLAIMS_DETAIL_LOSS_RATIO_DEVELOPMENT | /claims-detail/loss-ratio-development | 赔付率发展（多 cutoff） | CLAIMS_DETAIL_PARAMS | claims-detail |
| CLAIMS_DETAIL_HEATMAP | /claims-detail/heatmap | 理赔热力图 | CLAIMS_DETAIL_PARAMS | claims-detail |
| CUSTOMER_FLOW_SUMMARY | /customer-flow/summary | 客户来源去向总览 | CUSTOMER_FLOW_PARAMS | customer-flow |
| CUSTOMER_FLOW_INFLOW | /customer-flow/inflow | 客户流入分析 | CUSTOMER_FLOW_PARAMS | customer-flow |
| CUSTOMER_FLOW_OUTFLOW | /customer-flow/outflow | 客户流出分析 | CUSTOMER_FLOW_PARAMS | customer-flow |
| CUSTOMER_FLOW_TREND | /customer-flow/trend | 客户流动趋势 | CUSTOMER_FLOW_PARAMS | customer-flow, trend |
| CUSTOMER_FLOW_METADATA | /customer-flow/metadata | 客户流动维度元数据 | [] | customer-flow, metadata |
| EXPENSE_DEVELOPMENT | /expense-development | 费用率发展（多年保单 cohort） | COMMON_PARAMS 时间通用集 +（name:'cohortYears', type:'string', description:'保单年度列表，逗号分隔'）| expense |

代表性完整 entry 写法（其余按表同构展开）：

```typescript
  // ── 报价转化 ─────────────────────────────────
  {
    key: 'QUOTE_CONVERSION_KPI', path: '/quote-conversion/kpi', method: 'GET',
    summary: '报价转化 KPI 汇总',
    description: '报价→成交转化漏斗的核心 KPI：报价件数、成交件数、转化率、平均报价/成交价。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion', 'kpi'],
  },
```

- [ ] **Step 3**: description 字段逐条写一句中文业务描述（参考各子路由文件头注释，禁止留空）
- [ ] **Step 4**: `cd server && bunx tsc --noEmit` 零报错
- [ ] **Step 5**: commit `feat(server): route-catalog 补 39 条查询路由元数据（quote-conversion/repair/claims-detail/customer-flow/policy-geo/expense-development）`

### Task 3: governance — QueryCatalog 三方对账检查

**Files:** Modify `scripts/check-governance.mjs`

- [ ] **Step 1**: 新增检查函数（放在其他 check 函数附近），扫描实挂载端点 vs catalog：

```javascript
/**
 * QueryCatalog对账：server/src/routes/query/*.ts 实挂载 GET 端点、
 * QUERY_ROUTE_METADATA path 集 三方一致，根治能力登记漂移。
 * 豁免：/test（仅本地调试路由）。
 */
async function checkQueryCatalogConsistency() {
  const issues = [];
  const queryDir = 'server/src/routes/query';
  const exempt = new Set(['/test']);
  // 1) 实挂载端点：router.get('<path>'，跨行容忍
  const mounted = new Set();
  for (const f of fs.readdirSync(queryDir).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(queryDir, f), 'utf-8');
    for (const m of src.matchAll(/router\.get\(\s*\n?\s*'(\/[^']+)'/g)) {
      if (!exempt.has(m[1])) mounted.add(m[1]);
    }
  }
  // 2) catalog path 集
  const metaSrc = fs.readFileSync('server/src/config/query-routes-metadata.ts', 'utf-8');
  const catalog = new Set([...metaSrc.matchAll(/path:\s*'(\/[^']+)'/g)].map((m) => m[1]));
  const missingInCatalog = [...mounted].filter((p) => !catalog.has(p));
  const ghostInCatalog = [...catalog].filter((p) => !mounted.has(p));
  if (missingInCatalog.length) {
    issues.push(`已挂载但未登记 route-catalog（CLI/MCP 不可发现）: ${missingInCatalog.join(', ')}`);
  }
  if (ghostInCatalog.length) {
    issues.push(`catalog 登记了不存在的端点: ${ghostInCatalog.join(', ')}`);
  }
  return issues;
}
```

注意：实际返回结构按 check-governance.mjs 现有检查函数的返回约定适配（实现时参照相邻函数如 checkBundleRoutesGuard 的 pass/fail 形态）。

- [ ] **Step 2**: 注册到 CHECKS 数组：`{ name: 'QueryCatalog对账', fn: checkQueryCatalogConsistency },`
- [ ] **Step 3**: `bun run governance` 全绿（若 Task 2 有遗漏，此检查会抓出——按报错补齐）
- [ ] **Step 4**: commit `feat(governance): QueryCatalog 三方对账检查（实挂载端点 vs route-catalog）`

### Task 4: CLI — 退出码契约 + api.ts 超时 + version 单源

**Files:** Create `cli/src/exit-codes.ts`; Modify `cli/src/api.ts`, `cli/src/index.ts`; Test `cli/src/__tests__/exit-codes.test.ts`

- [ ] **Step 1**: 写失败测试 `cli/src/__tests__/exit-codes.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { exitCodeForError, EXIT } from '../exit-codes.js';
import { CxApiError } from '../api.js';

describe('exit codes', () => {
  it('401 → AUTH(2)', () => {
    expect(exitCodeForError(new CxApiError(401, 'x'))).toBe(EXIT.AUTH);
  });
  it('403 → FORBIDDEN(3)', () => {
    expect(exitCodeForError(new CxApiError(403, 'x'))).toBe(EXIT.FORBIDDEN);
  });
  it('429 → RATE_LIMITED(5)', () => {
    expect(exitCodeForError(new CxApiError(429, 'x'))).toBe(EXIT.RATE_LIMITED);
  });
  it('500 → GENERAL(1)', () => {
    expect(exitCodeForError(new CxApiError(500, 'x'))).toBe(EXIT.GENERAL);
  });
  it('非 CxApiError → GENERAL(1)', () => {
    expect(exitCodeForError(new Error('x'))).toBe(EXIT.GENERAL);
  });
});
```

- [ ] **Step 2**: `cd cli && bunx vitest --run src/__tests__/exit-codes.test.ts` → FAIL（模块不存在）
- [ ] **Step 3**: 实现 `cli/src/exit-codes.ts`：

```typescript
/**
 * cx 退出码契约（文档见 cli/README.md）
 * 0 成功 · 1 通用/服务端错误 · 2 鉴权失败 · 3 权限不足 · 4 用法错误 · 5 限流
 */
import { CxApiError } from './api.js';

export const EXIT = {
  OK: 0,
  GENERAL: 1,
  AUTH: 2,
  FORBIDDEN: 3,
  USAGE: 4,
  RATE_LIMITED: 5,
} as const;

export function exitCodeForError(err: unknown): number {
  if (err instanceof CxApiError) {
    if (err.status === 401) return EXIT.AUTH;
    if (err.status === 403) return EXIT.FORBIDDEN;
    if (err.status === 429) return EXIT.RATE_LIMITED;
  }
  return EXIT.GENERAL;
}

/** 统一错误出口：stderr 打印 + 按契约退出 */
export function failWith(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✘ ${msg}\n`);
  process.exit(exitCodeForError(err));
}
```

- [ ] **Step 4**: `cli/src/api.ts` 增加超时支持：`RequestOpts` 加 `timeoutMs?: number`，`doRequest` 内用 `AbortSignal.timeout(timeoutMs)` 与外部 signal 合并（`AbortSignal.any`）；各 commands 的 catch 块改用 `failWith(err)`（替换手写 `process.exit(...)`）
- [ ] **Step 5**: `cli/src/index.ts` version 单源：

```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
// program.version(pkg.version)
```

- [ ] **Step 6**: `cd cli && bunx vitest --run` 全过 → commit `feat(cli): 退出码契约 + 请求超时 + version 单源`

### Task 5: CLI — query path 直通 + --limit/--timeout；routes --search

**Files:** Modify `cli/src/commands/query.ts`, `cli/src/commands/routes.ts`, `cli/src/output.ts`, `cli/src/index.ts`; Test `cli/src/__tests__/query.test.ts`（扩充）

- [ ] **Step 1**: 扩充 query.test.ts——path 直通解析与 limit 截断的失败测试：

```typescript
import { resolveTarget } from '../commands/query.js';

describe('resolveTarget', () => {
  const routes = [{ key: 'KPI', path: '/kpi', fullPath: '/api/query/kpi' }];
  it('key 宽容匹配（小写/中划线）', () => {
    expect(resolveTarget('kpi', routes)?.fullPath).toBe('/api/query/kpi');
  });
  it('catalog path 命中', () => {
    expect(resolveTarget('/kpi', routes)?.fullPath).toBe('/api/query/kpi');
  });
  it('catalog 未登记的 / 开头 path 直通拼接', () => {
    expect(resolveTarget('/repair/overview', routes)?.fullPath).toBe('/api/query/repair/overview');
  });
  it('非 path 且 catalog 无 → null', () => {
    expect(resolveTarget('nonexistent', routes)).toBeNull();
  });
});
```

- [ ] **Step 2**: 跑测确认 FAIL（resolveTarget 未导出）
- [ ] **Step 3**: query.ts 把 `resolveRoute` 重构为导出的 `resolveTarget`（保持原 1)key 2)path 匹配，新增 3)`/` 开头时返回 `{ key: input, path: input, fullPath: '/api/query' + input }` 直通）；action 增加 `--limit <n>`（渲染前 `rows.slice(0, n)`，截断时 stderr 提示 `(truncated to N rows, total M)`）与 `--timeout <ms>` 透传 `cxGet`
- [ ] **Step 4**: routes.ts 加 `--search <kw>`：对 key/summary/description 做小写包含过滤；默认输出按首个 tag 分组（组名行 + 表格）
- [ ] **Step 5**: index.ts 注册新 option；`bunx vitest --run` 全过 → commit `feat(cli): query path 直通与 --limit/--timeout；routes --search 与 tag 分组`

### Task 6: CLI — sql stdin 管道

**Files:** Modify `cli/src/commands/sql.ts`, `cli/src/index.ts`; Test `cli/src/__tests__/sql.test.ts`

- [ ] **Step 1**: 失败测试（提取可测纯函数 readSqlInput）：

```typescript
import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { readSqlInput } from '../commands/sql.js';

describe('readSqlInput', () => {
  it('参数为普通 SQL 时原样返回', async () => {
    expect(await readSqlInput('SELECT 1', null)).toBe('SELECT 1');
  });
  it('参数为 - 时从 stdin 读', async () => {
    const stdin = Readable.from(['SELECT ', '2']);
    expect(await readSqlInput('-', stdin)).toBe('SELECT 2');
  });
});
```

- [ ] **Step 2**: FAIL 确认 → 实现：

```typescript
export async function readSqlInput(arg: string, stdin: NodeJS.ReadableStream | null): Promise<string> {
  if (arg !== '-') return arg;
  if (!stdin) throw new Error('SQL 参数为 - 但 stdin 不可用');
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c));
  const sql = Buffer.concat(chunks).toString('utf-8').trim();
  if (!sql) throw new Error('stdin 为空，请输入 SELECT/WITH 查询');
  return sql;
}
```

sqlCommand 内调用 `readSqlInput(query, query === '-' ? process.stdin : null)`；index.ts 的 sql 命令 description 补 `cx sql -`（stdin）示例
- [ ] **Step 3**: 测试过 → commit `feat(cli): sql 支持 stdin 管道（cx sql -）`

### Task 7: CLI — 新命令 filters / data / health

**Files:** Create `cli/src/commands/filters.ts`, `cli/src/commands/data.ts`, `cli/src/commands/health.ts`; Modify `cli/src/index.ts`

filters.ts（模式与现有 fields.ts 一致：cxGet + renderOutput + failWith）：

```typescript
/** cx filters [--dimension <name>] — GET /api/filters/options 维度可选值 */
import { cxGet } from '../api.js';
import { renderOutput, type OutputFormat } from '../output.js';
import { failWith } from '../exit-codes.js';

export async function filtersCommand(opts: { dimension?: string; format?: OutputFormat }): Promise<void> {
  try {
    const res = await cxGet<{ data: Record<string, unknown[]> }>('/api/filters/options');
    const all = (res as any)?.data ?? res;
    const picked = opts.dimension ? { [opts.dimension]: all[opts.dimension] ?? [] } : all;
    const rows = Object.entries(picked).map(([dimension, values]) => ({
      dimension,
      count: Array.isArray(values) ? values.length : '',
      values: Array.isArray(values) ? values.join(' | ') : String(values),
    }));
    const fmt: OutputFormat = opts.format ?? (process.stdout.isTTY ? 'table' : 'json');
    console.log(renderOutput(rows, fmt));
  } catch (err) { failWith(err); }
}
```

data.ts：子命令 version → GET `/api/data/version`；files → GET `/api/data/files`；metadata → GET `/api/data/metadata`，各自 renderOutput。health.ts：依次测 `GET {baseUrl}/health`（无鉴权，直接 fetch 计耗时）、有 PAT 时再测 `/api/data/version`，输出 `endpoint / status / latency_ms / detail` 行；任一失败 exit 1。

- [ ] **Step 1**: 按上述实现三命令 + index.ts 注册（data 用 commander 子命令：`cx data version|files|metadata`）
- [ ] **Step 2**: `bunx tsc --noEmit`（cli/）零报错 → commit `feat(cli): 新增 filters/data/health 命令`

### Task 8: CLI — config 命令

**Files:** Create `cli/src/commands/config-cmd.ts`; Modify `cli/src/index.ts`; Test `cli/src/__tests__/config-cmd.test.ts`

- [ ] **Step 1**: 失败测试（白名单校验逻辑）：

```typescript
import { describe, it, expect } from 'vitest';
import { validateConfigKey } from '../commands/config-cmd.js';

describe('validateConfigKey', () => {
  it('baseUrl 合法', () => expect(() => validateConfigKey('baseUrl')).not.toThrow());
  it('token 拒绝（只能经 login 写入）', () => expect(() => validateConfigKey('token')).toThrow());
  it('未知 key 拒绝', () => expect(() => validateConfigKey('foo')).toThrow());
});
```

- [ ] **Step 2**: FAIL → 实现 config-cmd.ts：`EDITABLE_KEYS = ['baseUrl']`；`validateConfigKey` 导出；子命令 `get <key>` / `set <key> <value>`（set baseUrl 时校验 URL 格式）/ `unset <key>` / `list`（token 脱敏为 `cx_pat_***`）/ `path`（打印配置文件路径）；读写复用 config.ts 的 loadConfig/saveConfig
- [ ] **Step 3**: 测试过 → commit `feat(cli): config 子命令（baseUrl 本地配置管理）`

### Task 9: CLI — completion 命令

**Files:** Create `cli/src/commands/completion.ts`; Modify `cli/src/index.ts`

- [ ] **Step 1**: 实现静态补全脚本生成（bash/zsh 两个模板字符串，覆盖 14 个命令名 + 全局选项 `--format --no-color --quiet --verbose --help --version`；query 的 key 不做动态补全——YAGNI）。bash 用 `complete -W`，zsh 用 `compdef + _arguments` 最简形态。使用说明打到 stderr（`# 安装: cx completion bash >> ~/.bashrc`），脚本本体打到 stdout
- [ ] **Step 2**: 人工验证 `bunx tsx src/index.ts completion bash | head` 输出合法脚本 → commit `feat(cli): completion 命令（bash/zsh 补全脚本）`

### Task 10: CLI — 全局选项 + whoami 增强 + help 中文化

**Files:** Modify `cli/src/index.ts`, `cli/src/commands/whoami.ts`, `cli/src/output.ts`

- [ ] **Step 1**: index.ts 全局选项：`--no-color`（`process.env.NO_COLOR='1'` 须在 kleur 使用前设置，kleur 原生尊重 NO_COLOR）、`--quiet`、`--verbose`（hook 在 preAction 设置全局 state，api.ts verbose 时 stderr 打印 `→ GET <url> (<ms>ms)`）
- [ ] **Step 2**: whoami.ts 输出补 dataScope / tokenType / tokenId（来自 /api/auth/me + 本地 config）/ baseUrl
- [ ] **Step 3**: 所有命令 description 中文化复查 + 每命令 `addHelpText('after', '\n示例:\n  $ cx ...')`
- [ ] **Step 4**: `bunx vitest --run` + `bunx tsc --noEmit` 全绿 → commit `feat(cli): 全局选项（--no-color/--quiet/--verbose）+ whoami 增强 + 中文 help`

### Task 11: 文档同步

**Files:** Modify `cli/README.md`, `开发文档/PAT_GUIDE.md`

- [ ] **Step 1**: README 重写：命令总览表（14 命令）、退出码契约表、全局选项、管道示例（`cx query KPI --format=csv | ...`、`echo "SELECT 1" | cx sql -`）、配置优先级（env > config.json）
- [ ] **Step 2**: PAT_GUIDE.md CLI 章节同步新命令清单 → commit `docs: cx CLI 全能力重构文档同步`

### Task 12: 收尾校验

- [ ] **Step 1**: BACKLOG 登记：`bun scripts/backlog.mjs add "cx CLI 全能力重构（catalog 补全 39 条 + governance 对账 + CLI 14 命令）" --status DOING`（参数形态以 backlog.mjs --help 为准）
- [ ] **Step 2**: 根目录 `bun run build` 零 TS 报错
- [ ] **Step 3**: `bun run test` 全过（CI 同款单测层）
- [ ] **Step 4**: `bun run governance` 全绿（含新 QueryCatalog对账）

### Task 13: 真实 API 验证（RED LINE：结果必须贴出）

- [ ] **Step 1**: `bun run dev:full` 起本地服务（后台）
- [ ] **Step 2**: admin 登录拿 JWT → POST /api/auth/tokens 生成临时 PAT
- [ ] **Step 3**: 逐项打通并记录输出：
  - `CX_BASE_URL=http://localhost:3000 CX_PAT=<pat> cx health`
  - `cx routes --search 维修`（应列出 13 条 repair）
  - `cx query KPI --year=2026 --format=json | head`
  - `cx query REPAIR_OVERVIEW`（新 catalog 条目）
  - `cx query /claims-detail/pending-overview`（path 直通）
  - `cx filters --dimension org_level_3`
  - `cx data version`
  - `echo "SELECT 1 AS ok" | cx sql -`
  - `CX_PAT=invalid cx whoami; echo "exit=$?"`（期望 exit=2）
- [ ] **Step 4**: 验证后吊销临时 PAT；记录全部输出到 PR body 验证章节

### Task 14: 交付

- [ ] **Step 1**: 走 `/chexian-commit-push-pr` 流程（rebase origin/main → governance → push → PR）；体量超门禁用 `GOVERNANCE_LARGE_PR_OK=1` 并在 PR body 写例外章节
- [ ] **Step 2**: PR body 含：设计文档链接、能力缺口对照表（33→72 条 catalog）、验证证据、MCP 自动受益说明
