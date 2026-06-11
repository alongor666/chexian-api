/**
 * DuckDB 域数据加载器 — 维度表 + 独立数据域的 Parquet 加载
 *
 * 从 duckdb.ts 拆出的 13 个 load* 方法。所有函数接收 DuckDBQueryable 接口。
 */

import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';

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
const DEDUPED_SALESMAN_DIM_SQL = `
      SELECT business_no, salesman_name, full_name, team, organization
      FROM (
        SELECT business_no, salesman_name, full_name, team, organization,
               ROW_NUMBER() OVER (
                 PARTITION BY full_name
                 ORDER BY tenure_months DESC NULLS LAST, business_no
               ) AS rn
        FROM SalesmanDim
      )
      WHERE rn = 1`;

/**
 * 从 Parquet 维度表加载业务员主数据和计划数据
 *
 * 生成的表/视图（向后兼容）：
 *   - SalesmanDim 表：完整业务员主数据
 *   - PlanFact 表：多年多层级计划数据
 *   - SalesmanTeamMapping 表：兼容旧 JOIN
 *   - SalesmanPlanFact 视图：兼容旧查询
 */
export async function loadDimParquet(db: DuckDBQueryable, salesmanPath: string, planPath: string): Promise<void> {
  const sf = escapeSqlValue(salesmanPath.replace(/\\/g, '/'));
  const pf = escapeSqlValue(planPath.replace(/\\/g, '/'));

  // 1. 创建 SalesmanDim 表（完整业务员主数据）
  await db.query(`
    CREATE OR REPLACE TABLE SalesmanDim AS
    SELECT * FROM read_parquet('${sf}')
  `);
  const smCount = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM SalesmanDim');
  console.log(`[DuckDB] SalesmanDim loaded: ${smCount[0]?.cnt ?? 0} records from Parquet`);

  // 2. 创建 PlanFact 表（多年多级计划）
  await db.query(`
    CREATE OR REPLACE TABLE PlanFact AS
    SELECT * FROM read_parquet('${pf}')
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
      COALESCE(p.plan_vehicle, 0.0) AS car_insurance_plan_2026
    FROM (${DEDUPED_SALESMAN_DIM_SQL}
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
      p.plan_total
    FROM (
      SELECT full_name, plan_year,
             SUM(plan_vehicle) AS plan_vehicle,
             SUM(plan_total)   AS plan_total
      FROM PlanFact
      WHERE level = 'salesman'
      GROUP BY full_name, plan_year
    ) p
    LEFT JOIN (${DEDUPED_SALESMAN_DIM_SQL}
    ) s ON p.full_name = s.full_name
  `);
  console.log('[DuckDB] SalesmanPlanFact (compat) view created — multi-year support');

  // 5. 预构建达成分析缓存表
  await buildAchievementView(db, 2026);
}

/**
 * 加载车牌归属地映射维度表
 *
 * 数据源：warehouse/dim/plate_region/latest.parquet（411 行）
 * JOIN：SUBSTRING(plate_no, 1, 2) = PlateRegionMap.plate_prefix
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
export async function buildAchievementView(db: DuckDBQueryable, planYear: number = 2026): Promise<void> {
  const prevYear = planYear - 1;

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
    ytd_actual AS (
      SELECT salesman_name, SUM(premium) / 10000 AS actual_vehicle
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
      END AS plan_growth_rate
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
      NULL                                                       AS plan_growth_rate
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
      NULL                                                       AS plan_growth_rate
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
 * 加载报价转化 Parquet → QuoteConversion 视图
 */
export async function loadQuoteConversion(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW QuoteConversion AS
    SELECT * FROM read_parquet('${safePath}')
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
 * 从 ClaimsDetail VIEW 聚合创建 ClaimsAgg TABLE（唯一来源）
 *
 * 2026-05-20 业务口径修正（与 xlsx 周报对账校准）：
 *   claim_cases  ── COUNT(DISTINCT claim_no) 不过滤，保持件数 cohort 与 xlsx 对齐
 *   reported_claims ── 在 SUM 内做 CASE 过滤，剔除以下案件的金额：
 *     1) liability_ratio = 0  (无责案件，本保单不构成赔款)
 *     2) case_type ∈ {零结, 注销, 拒赔}  (结案/撤案/拒赔后残留 reserve_amount 不应计入)
 *
 * 实证（YTD 2026 截至 5/16）：
 *   修前总赔款 +2.85% / 赔付率 +7.30% → 修后总赔款 +1.22% / 赔付率 +1.28%
 */
export async function createClaimsAggFromDetail(db: DuckDBQueryable): Promise<void> {
  await db.query(`
    CREATE OR REPLACE TABLE ClaimsAgg AS
    SELECT policy_no,
           COUNT(DISTINCT claim_no) AS claim_cases,
           SUM(CASE
                 WHEN COALESCE(liability_ratio, 100) > 0
                  AND (case_type IS NULL OR case_type NOT IN ('零结','注销','拒赔'))
                 THEN (CASE
                         WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                         ELSE COALESCE(reserve_amount, 0)
                       END)
                 ELSE 0
               END) AS reported_claims
    FROM ClaimsDetail
    WHERE policy_no IS NOT NULL
    GROUP BY policy_no
  `);
  const cnt = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ClaimsAgg');
  console.log(`[DuckDB] ClaimsAgg created from ClaimsDetail: ${cnt[0]?.cnt ?? 0} rows`);
}

/**
 * 加载交叉销售 Parquet → CrossSellFact VIEW
 */
export async function loadCrossSell(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW CrossSellFact AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM CrossSellFact');
  console.log(`[DuckDB] CrossSellFact view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载维修资源 Parquet → RepairDim TABLE
 */
export async function loadRepairDim(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE TABLE RepairDim AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM RepairDim');
  console.log(`[DuckDB] RepairDim loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载品牌维度 Parquet → BrandDim TABLE
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
 * 加载客户来源去向 Parquet → CustomerFlow VIEW
 */
export async function loadCustomerFlow(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW CustomerFlow AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM CustomerFlow');
  console.log(`[DuckDB] CustomerFlow view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}

/**
 * 加载新能源出险信息 Parquet → NewEnergyClaims VIEW
 */
export async function loadNewEnergyClaims(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW NewEnergyClaims AS
    SELECT * FROM read_parquet('${safePath}')
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
export async function loadRenewalTracker(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW RenewalTrackerFact AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM RenewalTrackerFact');
  console.log(`[DuckDB] RenewalTrackerFact view loaded: ${countResult[0]?.cnt ?? 0} rows from ${parquetPath}`);
}
