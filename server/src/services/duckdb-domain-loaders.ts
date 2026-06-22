/**
 * DuckDB 域数据加载器 — 维度表 + 独立数据域的 Parquet 加载
 *
 * 从 duckdb.ts 拆出的 13 个 load* 方法。所有函数接收 DuckDBQueryable 接口。
 */

import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';
import { getDeploymentBranchCode } from '../config/sql-federation-policy.js';

// ============================================
// 业务员主数据 + 计划数据
// ============================================

/**
 * SalesmanDim 按人员唯一键 full_name 去重的子查询（机制免疫，BACKLOG 8ee9a0）。
 *
 * business_no 不是人员唯一键：占位工号 000000000 由 13 个「admin×机构直接个代」
 * 虚拟业务员共用、200048259 两人共号（刘亚楼/刘婷）。人员唯一键是 full_name
 * （工号+姓名），与 achievement_cache 对 PolicyFact.salesman_name 的 JOIN 约定一致。
 * 整行重复（如徐小满×2）保留 tenure_months 最大行，business_no 兜底定序保证确定性。
 */
const dedupedSalesmanDimSql = (includeBranchCode: boolean): string => {
  // ADR G3·G4 GATED 多省：multiProvince 时 SalesmanDim 携带 branch_code（buildDimSelectSql 多源
  // UNION ALL BY NAME 注入），去重子查询透传该列供下游 SalesmanTeamMapping/SalesmanPlanFact 分省 RLS。
  // 单省（默认）includeBranchCode=false → 与历史 SQL 逐字节一致（SalesmanDim 无 branch_code，不可选）。
  const bc = includeBranchCode ? ', branch_code' : '';
  return `
      SELECT business_no, salesman_name, full_name, team, organization${bc}
      FROM (
        SELECT business_no, salesman_name, full_name, team, organization${bc},
               ROW_NUMBER() OVER (
                 PARTITION BY full_name
                 ORDER BY tenure_months DESC NULLS LAST, business_no
               ) AS rn
        FROM SalesmanDim
      )
      WHERE rn = 1`;
};

/**
 * 从 Parquet 维度表加载业务员主数据和计划数据
 *
 * 生成的表/视图（向后兼容）：
 *   - SalesmanDim 表：完整业务员主数据
 *   - PlanFact 表：多年多层级计划数据
 *   - SalesmanTeamMapping 表：兼容旧 JOIN
 *   - SalesmanPlanFact 视图：兼容旧查询
 */
export async function loadDimParquet(
  db: DuckDBQueryable,
  salesmanPath: string,
  planPath: string,
  extraSalesmanSources: ReadonlyArray<RawBranchDimSource> = [],
  extraPlanSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  // ADR G3 多省共存：业务员/计划维度按省加载并携带 branch_code。
  // extra* 为空（默认 SC-only）→ buildDimSelectSql 单源短路 = 历史 SQL 逐字节一致（四川零变更）。
  // extra* 非空（GATED 多省）→ UNION ALL BY NAME + 缺列补 branch_code 常量。
  // ⚠️ 降级兜底（临时·GATED 前补齐）：SX 无业务员/计划源时，data-bootstrapper 不传 SX extra 源，
  //    SX 保单的业务员经 buildAchievementView Part B 落「未归属团队/未归属机构」、计划缺省为 0
  //    （= 决策"salesman team='未分配团队'/plan 缺省空"）。SalesmanTeamMapping/achievement_cache
  //    的 branch_code 传播 + typed 路由分省过滤为本任务后续项（配 G4 派生域，见 PR 描述）。
  const branchCode = getDeploymentBranchCode();
  const salesmanSelect = await buildDimSelectSql(db, [
    { branchCode, path: salesmanPath },
    ...extraSalesmanSources,
  ]);
  const planSelect = await buildDimSelectSql(db, [
    { branchCode, path: planPath },
    ...extraPlanSources,
  ]);

  // 1. 创建 SalesmanDim 表（完整业务员主数据）
  await db.query(`
    CREATE OR REPLACE TABLE SalesmanDim AS
    ${salesmanSelect}
  `);
  const smCount = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM SalesmanDim');
  console.log(`[DuckDB] SalesmanDim loaded: ${smCount[0]?.cnt ?? 0} records from Parquet`);

  // multiProvince 判定（零假设·DESCRIBE 实测，复用 G3 信号）：SalesmanDim 含 branch_code 列
  // ⟺ salesmanSelect 是多源 UNION（extraSalesmanSources 非空）⟺ GATED 多省加载已激活。
  // 据此 gated 决定 SalesmanTeamMapping / SalesmanPlanFact / achievement_cache 是否携带 branch_code，
  // 使其与 PolicyFact（ETL 落列）对齐、供 typed 路由分省 RLS 过滤。
  // 单省（默认 SC-only）→ false → 下游三表逐字节等价历史行为（字节安全；achievement_cache CREATE TABLE
  // 加列会破坏单省字节安全，故必须 gated）。
  const salesmanDimCols = await db.query<{ column_name: string }>('DESCRIBE SalesmanDim');
  const multiProvince = salesmanDimCols.some((c) => c.column_name?.toLowerCase() === 'branch_code');

  // 2. 创建 PlanFact 表（多年多级计划）
  await db.query(`
    CREATE OR REPLACE TABLE PlanFact AS
    ${planSelect}
  `);
  const pfCount = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM PlanFact');
  console.log(`[DuckDB] PlanFact loaded: ${pfCount[0]?.cnt ?? 0} records from Parquet`);

  // 3. 创建兼容表 SalesmanTeamMapping（所有下游 SQL 都引用此表）
  //    JOIN 键 full_name（人员唯一键）而非 business_no（共号会笛卡尔放大实际保费，
  //    曾致乐山达成率 272.94%）；左表去重 + 右表先聚合，源表再出重复也不放大。
  await db.query(`
    CREATE OR REPLACE TABLE SalesmanTeamMapping AS
    SELECT
      s.business_no,
      s.salesman_name,
      s.full_name,
      COALESCE(s.team, '未分配') AS team_name,
      COALESCE(s.organization, '未分配机构') AS organization,
      COALESCE(p.plan_vehicle, 0.0) AS car_insurance_plan_2026${multiProvince ? ',\n      s.branch_code' : ''}
    FROM (${dedupedSalesmanDimSql(multiProvince)}
    ) s
    LEFT JOIN (
      -- 计划年动态取 PlanFact 内最新年（原硬编码 2026：跨年后新计划入库时
      -- 本表计划列会停在旧年/归零）。列名 car_insurance_plan_2026 为历史遗留
      -- （8+ 处下游引用），语义＝"最新计划年的年计划"。
      SELECT full_name, SUM(plan_vehicle) AS plan_vehicle
      FROM PlanFact
      WHERE plan_year = (SELECT MAX(plan_year) FROM PlanFact) AND level = 'salesman'
      GROUP BY full_name
    ) p ON s.full_name = p.full_name
  `);
  const tmCount = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM SalesmanTeamMapping');
  console.log(`[DuckDB] SalesmanTeamMapping (compat) built: ${tmCount[0]?.cnt ?? 0} records`);

  // 4. 创建兼容视图 SalesmanPlanFact（多年计划视图）
  //    同样按 full_name 连接 + 计划侧按 (full_name, plan_year) 聚合，免疫源表重复行。
  await db.query(`
    CREATE OR REPLACE VIEW SalesmanPlanFact AS
    SELECT
      p.full_name AS salesman_name,
      COALESCE(s.team, '未分配') AS team_name,
      COALESCE(s.organization, '未分配机构') AS org_name,
      p.plan_year,
      p.plan_vehicle,
      p.plan_total${multiProvince ? ',\n      s.branch_code' : ''}
    FROM (
      SELECT full_name, plan_year,
             SUM(plan_vehicle) AS plan_vehicle,
             SUM(plan_total)   AS plan_total
      FROM PlanFact
      WHERE level = 'salesman'
      GROUP BY full_name, plan_year
    ) p
    LEFT JOIN (${dedupedSalesmanDimSql(multiProvince)}
    ) s ON p.full_name = s.full_name
  `);
  console.log('[DuckDB] SalesmanPlanFact (compat) view created — multi-year support');

  // 5. 预构建达成分析缓存表（multiProvince 时携带 branch_code 供 typed 路由分省 RLS）
  await buildAchievementView(db, 2026, multiProvince);
}

/**
 * 加载车牌归属地映射维度表
 *
 * 数据源：warehouse/dim/plate_region/latest.parquet（411 行）
 * JOIN：SUBSTRING(plate_no, 1, 2) = PlateRegionMap.plate_prefix
 *
 * ADR G3：**保持全局、不省份化**（决策"plate_region 用现有全局表"）。车牌前缀→地区是
 * 全国统一的省份无关查找（如 '川A'→四川成都、'晋A'→山西太原），各省用户都需查全表；
 * 故不加 branch_code、不按省 UNION，federation 中维持 exempt（无机构作用域）。
 */
export async function loadPlateRegionDim(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const pf = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE TABLE PlateRegionMap AS
    SELECT * FROM read_parquet('${pf}')
  `);
  const result = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM PlateRegionMap');
  console.log(`[DuckDB] PlateRegionMap loaded: ${result[0]?.cnt ?? 0} records`);
}

/**
 * 加载团队映射 JSON 到 SalesmanTeamMapping 表（回退方式）
 *
 * 数据源：salesman_organization_mapping.json
 */
export async function loadTeamMapping(db: DuckDBQueryable, jsonFilePath: string): Promise<void> {
  const fs = (await import('fs')).default;

  let data: any;
  try {
    // JSON 中可能有 NaN（Python 生成），替换为 null 后解析
    const raw = fs.readFileSync(jsonFilePath, 'utf-8').replace(/\bNaN\b/g, 'null');
    data = JSON.parse(raw);
  } catch (err: any) {
    console.warn(`[DuckDB] Failed to read team mapping: ${err.message}`);
    return;
  }

  const rawRows: any[] = data.salesman_mapping || [];
  // 机制免疫（BACKLOG 8ee9a0）：按人员唯一键 full_name 去重，防上游 JSON 重复行放大数值
  const seenFullNames = new Set<string>();
  const rows = rawRows.filter(r => {
    const key = String(r.full_name ?? '');
    if (seenFullNames.has(key)) return false;
    seenFullNames.add(key);
    return true;
  });
  if (rows.length < rawRows.length) {
    console.warn(`[DuckDB] Team mapping dedup: dropped ${rawRows.length - rows.length} duplicate full_name rows`);
  }
  if (rows.length === 0) {
    console.warn('[DuckDB] No team mapping data found');
    return;
  }

  // 创建表
  await db.query(`
    CREATE OR REPLACE TABLE SalesmanTeamMapping (
      business_no VARCHAR,
      salesman_name VARCHAR,
      full_name VARCHAR,
      team_name VARCHAR,
      organization VARCHAR,
      car_insurance_plan_2026 DOUBLE
    )
  `);

  // 批量 INSERT（单条 SQL，234 行足够安全）
  const values = rows.map(r => {
    const esc = (s: any) => String(s ?? '').replace(/'/g, "''");
    return `('${esc(r.business_no)}', '${esc(r.salesman_name)}', '${esc(r.full_name)}', '${esc(r.team)}', '${esc(r.organization)}', ${Number(r.car_insurance_plan_2026) || 0})`;
  }).join(',\n      ');

  await db.query(`INSERT INTO SalesmanTeamMapping VALUES\n      ${values}`);

  // 创建 SalesmanPlanFact 视图（供 premiumPlan.ts / renewal-drilldown.ts 使用）
  await db.query(`
    CREATE OR REPLACE VIEW SalesmanPlanFact AS
    SELECT
      full_name AS salesman_name,
      team_name,
      organization AS org_name,
      2026 AS plan_year,
      car_insurance_plan_2026 AS plan_vehicle,
      car_insurance_plan_2026 AS plan_total
    FROM SalesmanTeamMapping
  `);

  console.log(`[DuckDB] Team mapping loaded: ${rows.length} records, from ${jsonFilePath}`);
  console.log(`[DuckDB] SalesmanPlanFact view created`);

  // 预构建达成分析缓存表（数据加载完成后立即计算，后续查询直接读缓存）
  await buildAchievementView(db, 2026);
}

// ============================================
// 保费达成分析缓存
// ============================================

/**
 * 预构建保费达成分析缓存表 achievement_cache（业务员粒度）
 *
 * 规则（用户确认；标准口径见注册表 plan_completion_pct v2.0.0）：
 * - JOIN 键：full_name（含工号前缀，如 "106014762刘刚"）
 * - 时间进度：数据内最新签单日是当年第几天 ÷ 全年天数（闰年感知）。
 *   B-146cce 拍板修正：锚点曾误用服务器当前日期（与本注释不符），现与
 *   保费看板 /api/query/kpi 统一锚定数据内最新签单日
 * - 上年同期：精确日期匹配（max_date - INTERVAL 1 YEAR）
 * - 无计划业务员：出现（mapping 中 plan=0 的 + mapping 外有保单的均出现）
 */
export async function buildAchievementView(
  db: DuckDBQueryable,
  planYear: number = 2026,
  multiProvince: boolean = false,
): Promise<void> {
  const prevYear = planYear - 1;

  // ADR G4 GATED 多省：achievement_cache 携带 branch_code 供 typed 路由（premium-plan/kpi/
  // comprehensive/performance）分省 RLS 过滤。守卫（零假设·DESCRIBE 实测）：
  //   branchAware = multiProvince（SalesmanTeamMapping 已含 branch_code）∧ PolicyFact 实测含 branch_code 列
  // 任一不满足 → 不加列：单省 = 历史 SQL 逐字节一致（字节安全）；防 PolicyFact 缺列时 Part B 的
  // MAX(branch_code) Binder Error。分省码来源：A1/A2 取 SalesmanTeamMapping m.branch_code（业务员归属省）；
  // Part B（有保单无映射业务员）取 PolicyFact 聚合 MAX(branch_code)（1 行/业务员，不 fan-out A1）。
  const policyFactCols = multiProvince
    ? await db.query<{ column_name: string }>('DESCRIBE PolicyFact')
    : [];
  const branchAware =
    multiProvince && policyFactCols.some((c) => c.column_name?.toLowerCase() === 'branch_code');
  const ytdBranchCol = branchAware ? ', MAX(branch_code) AS branch_code' : '';
  const aBranchCol = branchAware
    ? ',\n      m.branch_code                                              AS branch_code'
    : '';
  const bBranchCol = branchAware
    ? ',\n      a.branch_code                                              AS branch_code'
    : '';

  await db.query(`
    CREATE OR REPLACE TABLE achievement_cache AS
    WITH
    -- 1. 时间进度：数据内最新签单日是当年第几天 ÷ 全年天数（闰年感知）。
    --    锚定 MAX(policy_date)（非 CURRENT_DATE）：数据滞后时不冤枉业务员，
    --    与 kpi.ts latest_context 同口径（B-146cce）。当年无保单时回退到 1 月 1 日。
    time_prog AS (
      SELECT
        GREATEST(
          CAST(DATEDIFF('day', DATE '${planYear}-01-01', LEAST(
            COALESCE(CAST(MAX(policy_date) AS DATE), DATE '${planYear}-01-01'),
            DATE '${planYear}-12-31'
          )) + 1 AS DOUBLE) /
          CAST(DATEDIFF('day', DATE '${planYear}-01-01', DATE '${planYear}-12-31') + 1 AS DOUBLE),
          1.0 / CAST(DATEDIFF('day', DATE '${planYear}-01-01', DATE '${planYear}-12-31') + 1 AS DOUBLE)
        ) AS progress,
        MAX(policy_date) AS max_date
      FROM PolicyFact
      WHERE policy_date >= DATE '${planYear}-01-01'
    ),
    -- 2. 今年 YTD 实际（JOIN 键：PolicyFact.salesman_name = SalesmanTeamMapping.full_name）
    --    branchAware（GATED 多省）时附 MAX(branch_code)：1 行/业务员不 fan-out，供 Part B 分省标签。
    ytd_actual AS (
      SELECT salesman_name, SUM(premium) / 10000 AS actual_vehicle${ytdBranchCol}
      FROM PolicyFact
      WHERE policy_date >= DATE '${planYear}-01-01'
      GROUP BY salesman_name
    ),
    -- 3. 上年同期（精确日期：去年 1月1日 到 max_date-1年）
    prev_ytd AS (
      SELECT salesman_name, SUM(premium) / 10000 AS prev_actual
      FROM PolicyFact
      WHERE policy_date >= DATE '${prevYear}-01-01'
        AND policy_date <= (SELECT max_date - INTERVAL 1 YEAR FROM time_prog)
      GROUP BY salesman_name
    ),
    -- 4. 上年全年（用于计划增长率：今年计划 / 上年全年 - 1）
    prev_full AS (
      SELECT salesman_name, SUM(premium) / 10000 AS prev_full_year
      FROM PolicyFact
      WHERE policy_date BETWEEN DATE '${prevYear}-01-01' AND DATE '${prevYear}-12-31'
      GROUP BY salesman_name
    ),
    -- 5-7. 跨机构业务员（organization='未分配'）按 org_level_3 拆分的聚合
    cross_org_names AS (
      SELECT full_name FROM SalesmanTeamMapping WHERE organization = '未分配'
    ),
    ytd_by_org AS (
      SELECT salesman_name, org_level_3, SUM(premium) / 10000 AS actual_vehicle
      FROM PolicyFact
      WHERE policy_date >= DATE '${planYear}-01-01'
        AND salesman_name IN (SELECT full_name FROM cross_org_names)
      GROUP BY salesman_name, org_level_3
    ),
    prev_ytd_by_org AS (
      SELECT salesman_name, org_level_3, SUM(premium) / 10000 AS prev_actual
      FROM PolicyFact
      WHERE policy_date >= DATE '${prevYear}-01-01'
        AND policy_date <= (SELECT max_date - INTERVAL 1 YEAR FROM time_prog)
        AND salesman_name IN (SELECT full_name FROM cross_org_names)
      GROUP BY salesman_name, org_level_3
    ),
    prev_full_by_org AS (
      SELECT salesman_name, org_level_3, SUM(premium) / 10000 AS prev_full_year
      FROM PolicyFact
      WHERE policy_date BETWEEN DATE '${prevYear}-01-01' AND DATE '${prevYear}-12-31'
        AND salesman_name IN (SELECT full_name FROM cross_org_names)
      GROUP BY salesman_name, org_level_3
    )

    -- Part A1：正常映射业务员（organization != '未分配'）
    SELECT
      m.full_name                                                AS full_name,
      m.salesman_name                                            AS salesman_name_short,
      m.team_name,
      m.organization                                             AS org_name,
      ${planYear}                                                AS plan_year,
      COALESCE(m.car_insurance_plan_2026, 0)                     AS plan_vehicle,
      COALESCE(a.actual_vehicle, 0)                              AS actual_vehicle,
      COALESCE(pv.prev_actual, 0)                                AS prev_year_actual,
      COALESCE(pf.prev_full_year, 0)                             AS prev_year_full,
      tp.progress                                                AS time_progress,
      CASE
        WHEN COALESCE(m.car_insurance_plan_2026, 0) > 0 AND tp.progress > 0
        THEN ROUND((COALESCE(a.actual_vehicle, 0) / (m.car_insurance_plan_2026 * tp.progress)) * 100.0, 2)
        ELSE NULL
      END AS achievement_rate,
      CASE
        WHEN COALESCE(pv.prev_actual, 0) > 0
        THEN ROUND(((COALESCE(a.actual_vehicle, 0) - pv.prev_actual) / pv.prev_actual) * 100.0, 2)
        ELSE NULL
      END AS yoy_rate,
      CASE
        WHEN COALESCE(pf.prev_full_year, 0) > 0
        THEN ROUND((COALESCE(m.car_insurance_plan_2026, 0) / pf.prev_full_year - 1) * 100.0, 2)
        ELSE NULL
      END AS plan_growth_rate${aBranchCol}
    FROM SalesmanTeamMapping m
    LEFT JOIN ytd_actual  a  ON m.full_name = a.salesman_name
    LEFT JOIN prev_ytd    pv ON m.full_name = pv.salesman_name
    LEFT JOIN prev_full   pf ON m.full_name = pf.salesman_name
    CROSS JOIN time_prog  tp
    WHERE m.organization != '未分配'

    UNION ALL

    -- Part A2：跨机构业务员（organization='未分配' → 按保单 org_level_3 拆分，每个机构一行）
    SELECT
      m.full_name                                                AS full_name,
      m.salesman_name                                            AS salesman_name_short,
      m.team_name,
      ao.org_level_3                                             AS org_name,
      ${planYear}                                                AS plan_year,
      0.0                                                        AS plan_vehicle,
      COALESCE(ao.actual_vehicle, 0)                             AS actual_vehicle,
      COALESCE(po.prev_actual, 0)                                AS prev_year_actual,
      COALESCE(pfo.prev_full_year, 0)                            AS prev_year_full,
      tp.progress                                                AS time_progress,
      NULL                                                       AS achievement_rate,
      CASE
        WHEN COALESCE(po.prev_actual, 0) > 0
        THEN ROUND(((COALESCE(ao.actual_vehicle, 0) - po.prev_actual) / po.prev_actual) * 100.0, 2)
        ELSE NULL
      END AS yoy_rate,
      NULL                                                       AS plan_growth_rate${aBranchCol}
    FROM SalesmanTeamMapping m
    JOIN ytd_by_org ao ON m.full_name = ao.salesman_name
    LEFT JOIN prev_ytd_by_org  po  ON m.full_name = po.salesman_name  AND ao.org_level_3 = po.org_level_3
    LEFT JOIN prev_full_by_org pfo ON m.full_name = pfo.salesman_name AND ao.org_level_3 = pfo.org_level_3
    CROSS JOIN time_prog tp
    WHERE m.organization = '未分配'

    UNION ALL

    -- Part B：有保单但不在 mapping 中的业务员（无归属、无计划，但必须出现）
    SELECT
      a.salesman_name                                            AS full_name,
      a.salesman_name                                            AS salesman_name_short,
      '未归属团队'                                               AS team_name,
      '未归属机构'                                               AS org_name,
      ${planYear}                                                AS plan_year,
      0.0                                                        AS plan_vehicle,
      COALESCE(a.actual_vehicle, 0)                              AS actual_vehicle,
      COALESCE(pv.prev_actual, 0)                                AS prev_year_actual,
      COALESCE(pf.prev_full_year, 0)                             AS prev_year_full,
      tp.progress                                                AS time_progress,
      NULL                                                       AS achievement_rate,
      CASE
        WHEN COALESCE(pv.prev_actual, 0) > 0
        THEN ROUND(((COALESCE(a.actual_vehicle, 0) - pv.prev_actual) / pv.prev_actual) * 100.0, 2)
        ELSE NULL
      END AS yoy_rate,
      NULL                                                       AS plan_growth_rate${bBranchCol}
    FROM ytd_actual a
    LEFT JOIN prev_ytd  pv ON a.salesman_name = pv.salesman_name
    LEFT JOIN prev_full pf ON a.salesman_name = pf.salesman_name
    CROSS JOIN time_prog tp
    WHERE a.salesman_name NOT IN (SELECT full_name FROM SalesmanTeamMapping)
  `);

  const countResult = await db.query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM achievement_cache'
  );
  const distinctCount = (await db.query<{ cnt: number }>(
    'SELECT COUNT(DISTINCT full_name) AS cnt FROM achievement_cache'
  ))[0]?.cnt ?? 0;
  console.log(`[DuckDB] achievement_cache built: ${countResult[0]?.cnt ?? 0} rows (${distinctCount} unique salespeople), year=${planYear}`);

  // Smoke test: 验证核心聚合查询可执行
  await db.query(`SELECT plan_year, SUM(plan_vehicle) AS total FROM achievement_cache GROUP BY plan_year LIMIT 1`);
  console.log(`[DuckDB] achievement_cache smoke test passed`);
}

// ============================================
// 独立数据域加载
// ============================================

// Legacy renewal loaders removed; use RenewalTrackerFact.

/**
 * 派生域视图的 SELECT 投影：在视图层补 `branch_code` 常量列（P0.5 闭合 federation review M2 +
 * ADR G4 · GATED 多省共存能力预备）。取代原 `selectWithBranchCode`（单源），泛化为多省 UNION。
 *
 * 背景（P0.5）：续保/报价/交叉销售/新能源 4 个派生域 parquet **均不含 branch_code**（DESCRIBE 实测 2026-06-19）；
 * federation RLS 在 BRANCH_RLS_ENABLED 下注入 `branch_code='<省>'` 过滤——视图缺该列则整个分公司用户
 * （含 SC branch_admin）被 fail-closed 拒。故在视图层补 `'<省>' AS branch_code`，使派生视图与 PolicyFact
 * （ETL 落列）对齐。常量值经 paths 层 / getDeploymentBranchCode 白名单校验（`^[A-Z]{2}$`），可安全内插。
 *
 * 与维度表 buildBranchDimSelect 的差异（刻意）：派生域为 federation RLS 视图，**恒含 branch_code**；
 * 维度表单源不补（按构造字节安全优先）。故本函数：
 *   - **单一来源**（SC-only 默认）→ 与 P0.5 历史单源补列行为**逐字节一致**：
 *     parquet 含 branch_code → `SELECT * FROM read_parquet('<p>')`（守卫：避免 `SELECT *, …` 重复列）；
 *     不含 → `SELECT *, '<部署省>' AS branch_code FROM read_parquet('<p>')`。
 *   - **多来源**（GATED 多省）→ 各源同上映射后 `UNION ALL BY NAME` 合并（缺列补对应省份常量、
 *     已含者原样；SX validation 副本由 G1 ETL 注入 branch_code → 携真实 per-row 省份）。
 *
 * 守卫：以 DESCRIBE 实测列集判断是否已含 branch_code，零假设。
 */
export async function selectUnionWithBranchCode(
  db: DuckDBQueryable,
  rawSources: ReadonlyArray<RawBranchDimSource>,
): Promise<string> {
  if (rawSources.length === 0) {
    throw new Error('selectUnionWithBranchCode: 至少需要一个派生域来源');
  }
  const parts: string[] = [];
  for (const s of rawSources) {
    const safePath = escapeSqlValue(s.path.replace(/\\/g, '/'));
    const cols = await db.query<{ column_name: string }>(
      `DESCRIBE SELECT * FROM read_parquet('${safePath}')`,
    );
    const hasBranchCode = cols.some((c) => c.column_name?.toLowerCase() === 'branch_code');
    parts.push(
      hasBranchCode
        ? `SELECT * FROM read_parquet('${safePath}')`
        : `SELECT *, '${s.branchCode}' AS branch_code FROM read_parquet('${safePath}')`,
    );
  }
  return parts.join('\n    UNION ALL BY NAME\n    ');
}

/**
 * loader 入口：把派生域单文件路径 + 可选多省 extra 源拼成 SELECT。
 * extra 为空（默认 SC-only）→ 单源 = selectWithBranchCode 等价（字节安全）。
 * 省份基准码用 getDeploymentBranchCode()。
 */
async function buildFactSelectSql(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource>,
): Promise<string> {
  return selectUnionWithBranchCode(db, [
    { branchCode: getDeploymentBranchCode(), path: parquetPath },
    ...extraSources,
  ]);
}

// ============================================
// 维度表多省共存（ADR G3 · GATED 上线能力预备）
// ============================================

/**
 * 单个省份的维度 parquet 来源（ADR G3）。
 *
 * 多省共存（GATED 上线）时，业务员/计划/维修等省份相关维度表须按省加载并携带
 * branch_code，否则山西用户 JOIN 到这些全局表会拿到混省/全局数据（ADR §5.1 G3）。
 * 本类型描述「一个省一个 parquet 来源」，由 paths.getBranchDimSources 解析、
 * resolveBranchDimSources 实测 hasBranchCode 后交 buildBranchDimSelect 拼 SQL。
 */
export interface BranchDimSource {
  /** 省份码（CHAR(2)，'SC'/'SX'…）；由 paths 层 `^[A-Z]{2}$` 白名单约束，可安全内插 */
  branchCode: string;
  /** 已 escapeSqlValue + 正斜杠规整的 parquet 路径 */
  safePath: string;
  /** 该 parquet 是否已含 branch_code 列（DESCRIBE 实测；resolveBranchDimSources 填充） */
  hasBranchCode: boolean;
}

/**
 * 构造多省维度表的 read_parquet SELECT（纯函数，无 DuckDB → CI 单测）。
 *
 * 🔴 字节安全铁律（按构造证明 —— golden-baseline 当前 BLOCKED on E2E_PASSWORD，
 *    见 ADR §8/计划阶段三，故不能靠 API 层回归证 SC 零差异，必须靠 SQL 形态恒等）：
 *   - **单一来源**（SC-only 默认部署，sources.length===1）→ 返回
 *     `SELECT * FROM read_parquet('<p>')`，与历史 loader 逐字节一致：
 *     **不追加 branch_code、不 UNION**。四川行为零变更。
 *   - **多来源**（GATED 多省共存，sources.length>1）→ 各源 `UNION ALL BY NAME` 合并；
 *     缺 branch_code 列的源补 `'<branchCode>' AS branch_code` 常量列，已含者原样
 *     （避免 `SELECT *, …` 重复列报错）。BY NAME 按列名对齐，免疫各省 parquet 列序/列集差异。
 *
 * 与派生域 selectWithBranchCode 的策略差异（刻意）：派生域单源也补 branch_code 常量
 * （其为 federation RLS 视图，须恒含该列供 sql-permission-injector 注入）；维度表单源
 * **不补**——字节安全按构造优先，多省 branch RLS 由 GATED 期多源 UNION 自然提供。
 */
export function buildBranchDimSelect(sources: ReadonlyArray<BranchDimSource>): string {
  if (sources.length === 0) {
    throw new Error('buildBranchDimSelect: 至少需要一个维度来源');
  }
  if (sources.length === 1) {
    // 单源：逐字节等价历史行为（不加 branch_code、不 UNION）→ SC 默认字节安全
    return `SELECT * FROM read_parquet('${sources[0].safePath}')`;
  }
  // 多源（GATED 多省）：UNION ALL BY NAME，缺列补 branch_code 常量
  return sources
    .map((s) =>
      s.hasBranchCode
        ? `SELECT * FROM read_parquet('${s.safePath}')`
        : `SELECT *, '${s.branchCode}' AS branch_code FROM read_parquet('${s.safePath}')`,
    )
    .join('\n      UNION ALL BY NAME\n      ');
}

/**
 * 实测各省维度 parquet 是否已含 branch_code 列（DESCRIBE），返回可交 buildBranchDimSelect 的来源列表。
 * 与 selectWithBranchCode 同源的「DESCRIBE 实测、零假设」原则：SC current parquet 通常不含
 * branch_code（ETL 未落该列），SX validation 副本含（G1 已注入）→ 各自正确处理。
 */
export async function resolveBranchDimSources(
  db: DuckDBQueryable,
  sources: ReadonlyArray<{ branchCode: string; safePath: string }>,
): Promise<BranchDimSource[]> {
  const resolved: BranchDimSource[] = [];
  for (const s of sources) {
    const cols = await db.query<{ column_name: string }>(
      `DESCRIBE SELECT * FROM read_parquet('${s.safePath}')`,
    );
    resolved.push({
      ...s,
      hasBranchCode: cols.some((c) => c.column_name?.toLowerCase() === 'branch_code'),
    });
  }
  return resolved;
}

/** 维度域多省原始来源（branchCode 由 paths 层 `^[A-Z]{2}$` 约束；path 未转义）。 */
export interface RawBranchDimSource {
  branchCode: string;
  path: string;
}

/**
 * 把「原始多省维度来源」拼成 read_parquet SELECT（loader 内部统一入口）。
 *
 * 单源短路（默认 SC-only / 多数维度域）：**不 DESCRIBE、不 UNION**，直接
 * `SELECT * FROM read_parquet('<escaped>')` —— 与历史 loader 字节一致（按构造证字节安全）。
 * 多源（GATED 多省共存）：DESCRIBE 实测各源 branch_code → buildBranchDimSelect 拼 UNION ALL BY NAME。
 */
export async function buildDimSelectSql(
  db: DuckDBQueryable,
  rawSources: ReadonlyArray<RawBranchDimSource>,
): Promise<string> {
  const escaped = rawSources.map((s) => ({
    branchCode: s.branchCode,
    safePath: escapeSqlValue(s.path.replace(/\\/g, '/')),
  }));
  if (escaped.length <= 1) {
    // 单源：不 DESCRIBE、不 UNION，逐字节等价历史行为
    return buildBranchDimSelect([{ ...escaped[0], hasBranchCode: false }]);
  }
  const resolved = await resolveBranchDimSources(db, escaped);
  return buildBranchDimSelect(resolved);
}

/**
 * 加载报价转化 Parquet → QuoteConversion 视图
 *
 * ADR G4 多省共存：extraSources 为空（默认 SC-only）→ 单源 = 历史 selectWithBranchCode 等价
 * （字节安全）；非空（GATED 多省）→ UNION ALL BY NAME + 缺列补 branch_code（SX validation 副本携真实省份）。
 */
export async function loadQuoteConversion(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  await db.query(`
    CREATE OR REPLACE VIEW QuoteConversion AS
    ${await buildFactSelectSql(db, parquetPath, extraSources)}
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM QuoteConversion');
  console.log(`[DuckDB] QuoteConversion view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载赔案明细 Parquet → ClaimsDetail VIEW
 */
export async function loadClaimsDetail(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW ClaimsDetail AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ClaimsDetail');
  console.log(`[DuckDB] ClaimsDetail view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * ClaimsAgg「已报告赔款金额」的业务口径 CASE 表达式（唯一事实源 · B299/B302）。
 *
 * 剔除以下案件的金额，与 claims-heatmap.ts / claims-detail.ts 的 B302 口径一致：
 *   1) liability_ratio = 0  (无责案件，本保单不构成赔款)
 *   2) case_type ∈ {零结, 注销, 拒赔}  (结案/撤案/拒赔后残留 reserve_amount 不应计入)
 * 金额二选一：已结案（settlement_time 非空）取 settled_amount，否则取 reserve_amount（未决）。
 *
 * 抽成共享常量供静态 ClaimsAgg 与窗口化赔款 CTE（buildWindowedClaimsAggCTE）复用，
 * 防止两处内联复制后金额口径漂移（codex gate-1 P2-3）。
 */
export const CLAIMS_REPORTED_AMOUNT_CASE = `SUM(CASE
                 WHEN COALESCE(liability_ratio, 100) > 0
                  AND (case_type IS NULL OR case_type NOT IN ('零结','注销','拒赔'))
                 THEN (CASE
                         WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                         ELSE COALESCE(reserve_amount, 0)
                       END)
                 ELSE 0
               END) AS reported_claims`;

/**
 * 从 ClaimsDetail VIEW 聚合创建 ClaimsAgg TABLE（唯一来源）
 *
 * 2026-05-20 业务口径修正（与 xlsx 周报对账校准）：
 *   claim_cases  ── COUNT(DISTINCT claim_no) 不过滤，保持件数 cohort 与 xlsx 对齐
 *   reported_claims ── 金额口径见 CLAIMS_REPORTED_AMOUNT_CASE。
 *
 * 实证（YTD 2026 截至 5/16）：
 *   修前总赔款 +2.85% / 赔付率 +7.30% → 修后总赔款 +1.22% / 赔付率 +1.28%
 *
 * ⚠️ B299：本静态表**无出险日期(accident_time)过滤**（全量快照），刻意保持以满足字节安全。
 *    静态单例 ClaimsAgg 被 kpi/comprehensive/forecast/cube/skills 等 8+ 消费方共享 JOIN，
 *    给它加 cutoff 会污染整个连接的共享表（codex gate-1 P0-1）。**多 cutoff / 历史 YTD**
 *    场景的窗口化赔款须用 buildWindowedClaimsAggCTE（局部 CTE，不动静态表），消费侧切换是
 *    绑定时间机器特性的用户决策项（BACKLOG B299）。详见 memory feedback_claims_window_aligned_to_earned。
 */
export async function createClaimsAggFromDetail(db: DuckDBQueryable): Promise<void> {
  await db.query(`
    CREATE OR REPLACE TABLE ClaimsAgg AS
    SELECT policy_no,
           COUNT(DISTINCT claim_no) AS claim_cases,
           ${CLAIMS_REPORTED_AMOUNT_CASE}
    FROM ClaimsDetail
    WHERE policy_no IS NOT NULL
    GROUP BY policy_no
  `);
  const cnt = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ClaimsAgg');
  console.log(`[DuckDB] ClaimsAgg created from ClaimsDetail: ${cnt[0]?.cnt ?? 0} rows`);
}

/**
 * 构造「按出险日期窗口化」的赔款聚合 CTE 主体（B299）。
 *
 * 与静态 ClaimsAgg 同口径（claim_cases 不过滤件数 + reported_claims 金额口径复用
 * CLAIMS_REPORTED_AMOUNT_CASE），**额外**追加 `accident_time <= cutoff` 出险日期过滤，
 * 使满期类率值（满期赔付率/出险率/变动成本率）的赔款分子与满期保费分母**同窗口**。
 *
 * 解决的隐患（已 duckdb 直查 Parquet 实证，见 PR 描述）：
 *   早期 cutoff 时静态 ClaimsAgg 含"未来出险"赔款 → 分子虚高（cutoff=2026-03-31：
 *   满期赔付率 176.5%(全快照) → 61.5%(窗口)）；cutoff=最新数据日时窗口=全快照（逐分钱一致）。
 *
 * 设计要点（codex gate-1 对齐）：
 *   - **不写静态单例表**：返回的是 CTE 主体（SELECT ... FROM ClaimsDetail ...），由调用方包成
 *     `WITH claims_w AS (...)` 局部使用，绝不 CREATE OR REPLACE TABLE ClaimsAgg，避免污染共享表（P0-1）。
 *   - cutoff 经 `accident_time < cutoff + INTERVAL 1 DAY` 半开区间过滤（含 cutoff 当天的全部出险，
 *     且列侧不加 CAST，利于扫描优化；P2-4）。
 *   - cutoff 仅接受真实合法日期，由调用方先 isValidDateFormat 校验后传入（P2-2）。
 *
 * ⚠️ 口径边界（codex gate-1 P1-3）：本过滤只截"未来出险"泄漏；金额仍取**当前快照**的
 *    settled/reserve 状态，非历史 as-of 精算赔款。正确表述为"按出险发生日窗口 + 当前估损/结算状态"。
 *
 * @param cutoffDate YYYY-MM-DD（调用方须已校验合法）
 * @returns CTE 主体 SQL（不含 `WITH name AS`，由调用方包裹）
 */
export function buildWindowedClaimsAggCTE(cutoffDate: string): string {
  const safeCutoff = escapeSqlValue(cutoffDate);
  return `SELECT policy_no,
           COUNT(DISTINCT claim_no) AS claim_cases,
           ${CLAIMS_REPORTED_AMOUNT_CASE}
    FROM ClaimsDetail
    WHERE policy_no IS NOT NULL
      AND accident_time < DATE '${safeCutoff}' + INTERVAL 1 DAY
    GROUP BY policy_no`;
}

/**
 * 加载交叉销售 Parquet → CrossSellFact VIEW
 *
 * ADR G4 多省共存：同 loadQuoteConversion。extraSources 默认空 = 单源字节安全。
 */
export async function loadCrossSell(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  await db.query(`
    CREATE OR REPLACE VIEW CrossSellFact AS
    ${await buildFactSelectSql(db, parquetPath, extraSources)}
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM CrossSellFact');
  console.log(`[DuckDB] CrossSellFact view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载维修资源 Parquet → RepairDim TABLE
 *
 * ADR G3 多省共存：维修资源含 org_level_3（机构级敏感），多省须携带 branch_code。
 * extraSources 为空（默认 SC-only）→ 单源短路 = 历史 SQL 逐字节一致；非空（GATED 多省）
 * → UNION ALL BY NAME + 缺列补 branch_code（SX validation 副本由 G1 ETL 已注入 branch_code）。
 *
 * ⚠️ RepairDim 仍**不纳入** cx sql 联邦白名单（sql-federation-policy.ts）：其 org_level_3 为编码
 *    格式（如 '011019乐山中心支公司'）与标准 org RLS 过滤不匹配，对抗评审已论证（见该文件注释 +
 *    sql-federation.test.ts 越权回归用例）。本增量仅在 loader 层补 branch_code 数据列，
 *    typed 路由（routes/query/repair.ts）的分省过滤为后续项，不动联邦排除决策。
 */
export async function loadRepairDim(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  const repairSelect = await buildDimSelectSql(db, [
    { branchCode: getDeploymentBranchCode(), path: parquetPath },
    ...extraSources,
  ]);
  await db.query(`
    CREATE OR REPLACE TABLE RepairDim AS
    ${repairSelect}
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM RepairDim');
  console.log(`[DuckDB] RepairDim loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载品牌维度 Parquet → BrandDim TABLE
 *
 * ADR G3：**保持全局、不省份化**。BrandDim 是车型库（厂牌/车型代码→品牌/吨位/座位等），
 * 属全国统一的省份无关参照数据——一个车型代码在四川/山西映射到同一品牌；各省用户都需查全表。
 * 故不加 branch_code、不按省 UNION，federation 中维持 exempt（无机构作用域）。
 * （G1 曾产 validation/SX/brand 隔离副本用于 ETL 完整性校验，非运行期分省隔离所需。）
 */
export async function loadBrandDim(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE TABLE BrandDim AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM BrandDim');
  console.log(`[DuckDB] BrandDim loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载客户来源去向 VIEW（派生自 PolicyFact，BACKLOG 86d10f）
 *
 * 历史：2026-06-10 之前从独立 customer_flow.parquet（08/09 xlsx 合成）加载，
 * 该域 VIEW 无 org_level_3/branch_code/is_telemarketing 字段→无法注入 RLS。
 * 2026-06-10 起上游签单清单新增 previous_insurer/next_insurer 两列，
 * 客户流向数据合并到 PolicyFact。本 loader 改从 PolicyFact 派生：
 * - 业务上「2025 保单含 next_insurer」+「2026 保单含 previous_insurer」即全集（中国车险一年一续保）
 * - 历史年份 (2020-2024) NULL = 业务上不存在，非数据丢失
 * - VIEW 不去重；批改副本影响 < 2%（业务方可接受）
 * - 自动获得 RLS 字段，支持 parseFiltersAndBuildWhere 注入
 */
export async function loadCustomerFlow(db: DuckDBQueryable): Promise<void> {
  await db.query(`
    CREATE OR REPLACE VIEW CustomerFlow AS
    SELECT
      policy_no,
      insurance_start_date,
      previous_insurer,
      next_insurer,
      org_level_3,
      branch_code,
      is_telemarketing,
      customer_category,
      insurance_type,
      coverage_combination
    FROM PolicyFact
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM CustomerFlow');
  console.log(`[DuckDB] CustomerFlow view loaded: ${countResult[0]?.cnt ?? 0} rows (derived from PolicyFact)`);
}

/**
 * 加载新能源出险信息 Parquet → NewEnergyClaims VIEW
 *
 * ADR G4 多省共存：同 loadQuoteConversion。extraSources 默认空 = 单源字节安全。
 */
export async function loadNewEnergyClaims(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  await db.query(`
    CREATE OR REPLACE VIEW NewEnergyClaims AS
    ${await buildFactSelectSql(db, parquetPath, extraSources)}
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM NewEnergyClaims');
  console.log(`[DuckDB] NewEnergyClaims view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载续保追踪派生域 Parquet → RenewalTrackerFact VIEW
 *
 * 数据源：warehouse/fact/renewal_tracker/latest.parquet（ETL 预计算产物）
 * 口径：2025 起保 + 2026 到期商业险 universe，dual-key 续保匹配，VIN 粒度
 */
export async function loadRenewalTracker(
  db: DuckDBQueryable,
  parquetPath: string,
  extraSources: ReadonlyArray<RawBranchDimSource> = [],
): Promise<void> {
  await db.query(`
    CREATE OR REPLACE VIEW RenewalTrackerFact AS
    ${await buildFactSelectSql(db, parquetPath, extraSources)}
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM RenewalTrackerFact');
  console.log(`[DuckDB] RenewalTrackerFact view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}
