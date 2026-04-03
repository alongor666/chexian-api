# 旧车商业险报价双版本页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `/quote-conversion` 路由内，把页面重构为“旧车商业险报价转化分析（开发阶段）”，提供 `版本 A` 与 `版本 B` 两种视图，并把旧 HTML 的 6 个分析分区基本完整迁回 `版本 B`。

**Architecture:** 保留现有 `QuoteConversion` 数据域与 `/api/query/quote-conversion/*` 接口体系，不新增路由；前端新增“版本切换 + 共享筛选 + B 版专题分区”的容器层。后端只做最小增补：补齐旧车专题筛选字段与 KPI 派生所需字段，保证 A/B 两个版本都复用同一套查询链路。

**Tech Stack:** React 19 + TypeScript + React Query + ECharts + Tailwind CSS + Express + DuckDB + Vitest

---

## 预先锁定的实现决策

- 路由不变，仍使用 `/quote-conversion`。
- 页面标题改为“旧车商业险报价转化分析”，并在标题区域追加“开发阶段”状态文案。
- 版本命名固定为 `版本 A` / `版本 B`。
- 默认打开 `版本 A`，并把版本状态同步到 URL 查询参数，建议使用 `?version=A|B`。
- A/B 共用同一份筛选状态，不重复造轮子。
- 为避免隐藏状态，若 `版本 B` 专属筛选已生效，则在 `版本 A` 也要以筛选摘要/标签形式可见，并支持一键清空。
- 数据源继续使用现有 `QuoteConversion` 视图；不新增新的 DuckDB 域、不新增新的前端路由。

## 文件边界

### 前端主入口

**Files:**
- Modify: `src/features/quote-conversion/QuoteConversionPage.tsx`
- Modify: `src/features/quote-conversion/types.ts`
- Modify: `src/features/quote-conversion/hooks/useQuoteConversion.ts`
- Create: `src/features/quote-conversion/components/VersionSwitcher.tsx`
- Create: `src/features/quote-conversion/components/VersionAView.tsx`
- Create: `src/features/quote-conversion/components/VersionBView.tsx`

- [ ] **Step 1: 为页面状态补充版本类型与旧车专题筛选字段**

```ts
export type QuotePageVersion = 'A' | 'B';

export interface QuoteFilters {
  dateStart?: string;
  dateEnd?: string;
  renewalType?: '续保' | '转保';
  orgName?: string;
  teamName?: string;
  salesmanNo?: string;
  customerCategory?: string;
  insuranceCombo?: '主全' | '交三';
  isTelemarketing?: '电销' | '非电销';
  isNewEnergy?: '是' | '否';
  isTransferred?: '是' | '否';
  riskGrade?: 'A' | 'B' | 'C' | 'D';
  ncdMin?: number;
  ncdMax?: number;
}
```

- [ ] **Step 2: 先写前端状态测试，锁定默认版本、URL 同步和共享筛选行为**

```ts
it('defaults to version A when query param is absent', () => {
  // render QuoteConversionPage with no search param
  // expect screen.getByRole('button', { name: '版本 A' }) to be active
});

it('preserves filters when switching from version B back to version A', async () => {
  // set version B, choose orgName + riskGrade
  // switch to version A
  // expect org filter summary and old-car filter chips to remain visible
});
```

Run: `bun run test --run src/features/quote-conversion`
Expected: FAIL，提示版本切换或筛选共享逻辑尚未实现

- [ ] **Step 3: 实现页面容器层**

```tsx
const [filters, setFilters] = useState<QuoteFilters>({});
const [searchParams, setSearchParams] = useSearchParams();
const version = searchParams.get('version') === 'B' ? 'B' : 'A';

<VersionSwitcher
  version={version}
  onChange={(next) => setSearchParams((prev) => {
    prev.set('version', next);
    return prev;
  })}
/>

<GlobalFilters filters={filters} onChange={setFilters} version={version} />
{version === 'A' ? <VersionAView filters={filters} /> : <VersionBView filters={filters} />}
```

- [ ] **Step 4: 运行前端测试，确认默认版本和切换状态通过**

Run: `bun run test --run src/features/quote-conversion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/quote-conversion/QuoteConversionPage.tsx \
  src/features/quote-conversion/types.ts \
  src/features/quote-conversion/hooks/useQuoteConversion.ts \
  src/features/quote-conversion/components/VersionSwitcher.tsx \
  src/features/quote-conversion/components/VersionAView.tsx \
  src/features/quote-conversion/components/VersionBView.tsx
git commit -m "feat: add old-car quote conversion version switcher"
```

## 版本 A 与共享筛选

**Files:**
- Modify: `src/features/quote-conversion/components/GlobalFilters.tsx`
- Modify: `src/features/quote-conversion/components/KpiCards.tsx`
- Modify: `src/features/quote-conversion/components/ConversionFunnel.tsx`
- Modify: `src/features/quote-conversion/components/TimeTrend.tsx`

- [ ] **Step 1: 先写测试，锁定筛选器按版本展示**

```ts
it('shows shared filters in both versions and old-car advanced filters only in version B', () => {
  // render GlobalFilters twice with version A / B
  // expect date/org/customer/insurance controls in both
  // expect telemarketing/new-energy/transfer/risk-grade/NCD only in version B
});
```

Run: `bun run test --run src/features/quote-conversion/components`
Expected: FAIL，提示旧车专题筛选入口不存在

- [ ] **Step 2: 实现共享基础筛选 + B 版增量筛选**

```tsx
{version === 'B' && (
  <>
    <select value={filters.isTelemarketing ?? ''}>...</select>
    <select value={filters.isNewEnergy ?? ''}>...</select>
    <select value={filters.isTransferred ?? ''}>...</select>
    <select value={filters.riskGrade ?? ''}>...</select>
    <input type="number" value={filters.ncdMin ?? ''} />
    <input type="number" value={filters.ncdMax ?? ''} />
  </>
)}
```

- [ ] **Step 3: 把版本 A 页面改造成旧车数据适配版**

```tsx
<div>
  <h1>旧车商业险报价转化分析</h1>
  <p>开发阶段 · 版本 A</p>
</div>
<KpiCards data={kpi.data} isLoading={kpi.isLoading} mode="old-car-a" />
<ConversionFunnel data={funnel.data} isLoading={funnel.isLoading} mode="old-car-a" />
```

实现要求：
- 沿用当前 A 版布局，不新增新的深度 tab 结构。
- 标题、副标题、KPI 文案改成旧车语境。
- `TimeTrend` 默认粒度改为 `month`，但仍允许切换。
- `KpiCards` 使用后端补充字段算出“续/转承保率比”“续保件均保费”等旧车语义指标。

- [ ] **Step 4: 运行组件测试**

Run: `bun run test --run src/features/quote-conversion/components`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/quote-conversion/components/GlobalFilters.tsx \
  src/features/quote-conversion/components/KpiCards.tsx \
  src/features/quote-conversion/components/ConversionFunnel.tsx \
  src/features/quote-conversion/components/TimeTrend.tsx
git commit -m "feat: adapt version A to old-car quote conversion"
```

## 版本 B 六分区迁移

**Files:**
- Create: `src/features/quote-conversion/components/VersionBTabs.tsx`
- Create: `src/features/quote-conversion/components/VersionBOverview.tsx`
- Create: `src/features/quote-conversion/components/VersionBRenewalCompare.tsx`
- Create: `src/features/quote-conversion/components/VersionBOrgAnalysis.tsx`
- Create: `src/features/quote-conversion/components/VersionBPortfolioAnalysis.tsx`
- Create: `src/features/quote-conversion/components/VersionBTrendAnalysis.tsx`
- Create: `src/features/quote-conversion/components/VersionBDiscountNcd.tsx`
- Modify: `src/features/quote-conversion/components/RankingTable.tsx`
- Modify: `src/features/quote-conversion/components/DimensionMatrix.tsx`

- [ ] **Step 1: 先写版本 B 导航测试，锁定 6 个分区**

```ts
it('renders six tabs for version B', () => {
  const labels = ['总览', '续/转保', '三级机构', '险别/客户/等级', '月度趋势', '折扣/NCD'];
  // expect each tab label to exist
});
```

Run: `bun run test --run src/features/quote-conversion`
Expected: FAIL，提示 Version B 分区组件不存在

- [ ] **Step 2: 实现 B 版总览**

```tsx
<VersionBOverview filters={filters}>
  <ConversionFunnel ... />
  <section>{/* 综合概览卡片：总报价、承保、续保率、转保率、续/转比、件均保费 */}</section>
</VersionBOverview>
```

- [ ] **Step 3: 实现 B 版续/转保分析**

```tsx
const renewalFilters = { ...filters, renewalType: '续保' };
const switchFilters = { ...filters, renewalType: '转保' };

// 使用两组 useQuoteRanking / useQuoteHeatmap 并排渲染
```

实现要求：
- 上半区突出“续保 vs 转保”差异。
- 不新增新接口，优先通过 `renewalType` 分别查询后在前端并排展示。

- [ ] **Step 4: 实现 B 版三级机构**

```tsx
<div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
  <DrilldownTable filters={filters} />
  <DimensionHeatmap filters={filters} />
</div>
```

- [ ] **Step 5: 实现 B 版险别/客户/等级**

```tsx
<RankingTable filters={{ ...filters, dimensionPreset: '险别组合' }} />
<RankingTable filters={{ ...filters, dimensionPreset: '客户类别' }} />
<RankingTable filters={{ ...filters, dimensionPreset: '车险分等级' }} />
<RankingTable filters={{ ...filters, dimensionPreset: '是否新能源车|是否过户车|是否电销' }} />
```

实现要求：
- 页面视觉上保留 4 个分块：险别组合、客户类别、车险分等级、特殊车辆。
- `RankingTable` 支持通过 `initialDimension` 传入默认维度，而不是写死内部默认值。

- [ ] **Step 6: 实现 B 版月度趋势**

```tsx
<VersionBTrendAnalysis>
  <TimeTrend filters={filters} defaultGranularity="month" />
  <div>{/* 月均报价、月均承保率、峰值月份、低谷月份 */}</div>
</VersionBTrendAnalysis>
```

- [ ] **Step 7: 实现 B 版折扣 / NCD**

```tsx
<div className="space-y-5">
  <PriceSensitivity filters={filters} />
  <RankingTable filters={filters} initialDimension="NCD系数" sortMode="numeric-asc" />
</div>
```

实现要求：
- 折扣部分复用现有 `PriceSensitivity`。
- NCD 分布要求按数值排序，不允许字符串排序导致 `1.0`、`0.5` 混乱。

- [ ] **Step 8: 运行版本 B 组件测试**

Run: `bun run test --run src/features/quote-conversion`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/features/quote-conversion/components/VersionBTabs.tsx \
  src/features/quote-conversion/components/VersionBOverview.tsx \
  src/features/quote-conversion/components/VersionBRenewalCompare.tsx \
  src/features/quote-conversion/components/VersionBOrgAnalysis.tsx \
  src/features/quote-conversion/components/VersionBPortfolioAnalysis.tsx \
  src/features/quote-conversion/components/VersionBTrendAnalysis.tsx \
  src/features/quote-conversion/components/VersionBDiscountNcd.tsx \
  src/features/quote-conversion/components/RankingTable.tsx \
  src/features/quote-conversion/components/DimensionMatrix.tsx
git commit -m "feat: add old-car quote conversion version B layout"
```

## 后端最小增补

**Files:**
- Modify: `server/src/routes/query/quote-conversion.ts`
- Modify: `server/src/sql/quote-conversion.ts`
- Test: `server/src/sql/__tests__/quote-conversion.test.ts`

- [ ] **Step 1: 先写 SQL 生成器测试，锁定新筛选和 KPI 字段**

```ts
it('includes telemarketing, new-energy, transfer, risk-grade and NCD range filters', () => {
  const sql = generateQuoteKpiQuery({
    isTelemarketing: '电销',
    isNewEnergy: '是',
    isTransferred: '否',
    riskGrade: 'A',
    ncdMin: 0.5,
    ncdMax: 1.0,
  });
  expect(sql).toContain("是否电销 = '电销'");
  expect(sql).toContain("是否新能源车 = '是'");
  expect(sql).toContain("是否过户车 = '否'");
  expect(sql).toContain("车险分等级 = 'A'");
  expect(sql).toContain('NCD系数 >=');
  expect(sql).toContain('NCD系数 <=');
});

it('returns renewal and switch premium fields in KPI query', () => {
  const sql = generateQuoteKpiQuery();
  expect(sql).toContain('AS renewal_insured_premium');
  expect(sql).toContain('AS switch_insured_premium');
});
```

Run: `bun run test --run server/src/sql/__tests__/quote-conversion.test.ts`
Expected: FAIL，提示 schema 或 SQL 片段尚不存在

- [ ] **Step 2: 扩展筛选 schema 与 SQL where 生成器**

```ts
const quoteFilterSchema = z.object({
  // existing fields...
  isTelemarketing: z.enum(['电销', '非电销']).optional(),
  isNewEnergy: z.enum(['是', '否']).optional(),
  isTransferred: z.enum(['是', '否']).optional(),
  riskGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
  ncdMin: z.coerce.number().optional(),
  ncdMax: z.coerce.number().optional(),
});
```

```ts
if (filters.isTelemarketing) conds.push(`是否电销 = '${esc(filters.isTelemarketing)}'`);
if (filters.isNewEnergy) conds.push(`是否新能源车 = '${esc(filters.isNewEnergy)}'`);
if (filters.isTransferred) conds.push(`是否过户车 = '${esc(filters.isTransferred)}'`);
if (filters.riskGrade) conds.push(`车险分等级 = '${esc(filters.riskGrade)}'`);
if (filters.ncdMin != null) conds.push(`NCD系数 >= ${filters.ncdMin}`);
if (filters.ncdMax != null) conds.push(`NCD系数 <= ${filters.ncdMax}`);
```

- [ ] **Step 3: 扩展 KPI 查询，补足旧车语义字段**

```sql
ROUND(SUM(CASE WHEN 续保情况 = '续保' AND 是否承保 = '承保' THEN 折后保费 ELSE 0 END), 0) AS renewal_insured_premium,
ROUND(SUM(CASE WHEN 续保情况 = '转保' AND 是否承保 = '承保' THEN 折后保费 ELSE 0 END), 0) AS switch_insured_premium
```

- [ ] **Step 4: 运行 SQL 测试**

Run: `bun run test --run server/src/sql/__tests__/quote-conversion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/query/quote-conversion.ts \
  server/src/sql/quote-conversion.ts \
  server/src/sql/__tests__/quote-conversion.test.ts
git commit -m "feat: extend old-car quote conversion filters and KPI fields"
```

## 最终验证

**Files:**
- Test: `src/features/quote-conversion/**/*`
- Test: `server/src/sql/__tests__/quote-conversion.test.ts`

- [ ] **Step 1: 跑前端定向测试**

Run: `bun run test --run src/features/quote-conversion`
Expected: PASS

- [ ] **Step 2: 跑后端定向测试**

Run: `bun run test --run server/src/sql/__tests__/quote-conversion.test.ts`
Expected: PASS

- [ ] **Step 3: 跑类型检查**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: 跑构建**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: 关键人工验收**

```text
1. 打开 /quote-conversion，默认进入版本 A
2. 顶部显示“旧车商业险报价转化分析”与“开发阶段”
3. 切到版本 B，看到 6 个分区 tab
4. 在版本 B 选中机构 + 风险等级 + NCD 区间后切回版本 A，筛选状态仍保留且可见
5. 月度趋势默认按月展示
6. 折扣/NCD 分区中 NCD 排序按数值升序
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: ship old-car quote conversion dual-version page"
```

## 测试场景

- 默认访问 `/quote-conversion` 时进入 `版本 A`。
- URL 指定 `?version=B` 时直接进入 `版本 B`。
- 版本切换后，基础筛选和旧车专题筛选都不丢失。
- `版本 A` 不出现 6 分区 tab，但能显示旧车语境 KPI。
- `版本 B` 六分区完整可用，且与旧 HTML 一一对应。
- 新增筛选全部能透传到后端 SQL。
- NCD 区间无值时不加 SQL 条件，有值时正确加上下界/上界。
- `renewal_insured_premium` / `switch_insured_premium` 能支持件均保费计算，且除零场景返回安全值。

## 假设与默认值

- `QuoteConversion` 当前就是旧车商业险报价数据，ETL 不在本次范围内。
- 侧边栏路由名和路径保持不变，只改页面内部标题与结构。
- `版本 A` 作为默认视图；`版本 B` 是旧 HTML 六分区迁移版。
- `版本 B` 专属筛选不单独建新 store，继续挂在现有 `QuoteFilters` 上。
- 若实现阶段发现 `RankingTable` 复用成本过高，允许拆出更小的只读排行子组件，但不得改变最终信息架构。
