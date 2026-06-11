#!/usr/bin/env node
/**
 * 通用可加性立方体（Universal Additive Cube）基准验证原型
 *
 * 目的：用可复现实验回答「不依赖结果快照（route-cache 预热 / 预打包 JSON），
 * 能否让任意参数组合的后端查询从秒级降到毫秒/亚毫秒级」。
 *
 * 对比四种数据形态（同一份合成数据、同一组查询语义、强制数值等值校验）：
 *   L0 baseline   现状形态：宽事实表 + 多 CTE 重复扫描 + EXTRACT(YEAR) + LIKE 细分 + 查询期去重/JOIN
 *   L1 fact-opt   事实表优化：预计算 segment_tag / 首行标记 / 预关联赔款 + DATE BETWEEN（对应 BACKLOG B306）
 *   L2 cube-day   日粒度立方体：按 (日期, 机构, 险种, 客户类别, 细分, 5 个布尔) 预聚合的可加性度量表
 *   L3 cube-week  周粒度立方体（L2 的上卷）+ Node 进程内列式引擎（TypedArray 全内存扫描）
 *
 * 关键设计点（与历史「快照」路线的本质区别）：
 *   - 立方体不是某个参数组合的结果缓存，而是一张能精确回答【任意】筛选×分组组合的小表；
 *   - 赔款在【保单粒度去重后】预关联（规避 B252 批改行虚增坑）；
 *   - 满期类指标把 insurance_start_date 留在粒度里，任意截止日的满期赔付率可精确重算（CubeCostDay）；
 *   - 非可加指标（如跨期去重车架号）显式声明走 L1 事实表回退，不假装立方体全能。
 *
 * 运行（模拟 VPS 2 线程 / 1.5GB 上限）：
 *   node scripts/perf/bench-universal-cube.mjs
 *   node scripts/perf/bench-universal-cube.mjs --rows 2600000 --iters 15
 *
 * 产物：stdout markdown 报告 + artifacts/perf/bench-universal-cube-<ts>.json
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 复用 server 的 DuckDB 原生依赖（与生产同版本 @duckdb/node-api）
const serverRequire = createRequire(
  new URL('../../server/package.json', import.meta.url)
);
const { DuckDBInstance } = serverRequire('@duckdb/node-api');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ---------- 参数 ----------
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROWS = Number(argVal('rows', '2600000'));        // 与生产 PolicyFact 同量级
const ITERS = Number(argVal('iters', '15'));           // 每条查询计时迭代数
const DRILL_COMBOS = Number(argVal('combos', '30'));   // 任意组合下钻的组合数
const THREADS = argVal('threads', '2');                // 模拟 VPS 2 核
const MAX_MEM = argVal('mem', '1536MB');               // 模拟 VPS DUCKDB_MAX_MEMORY

// ---------- 工具 ----------
const fmtMs = (v) => (v < 1 ? `${(v * 1000).toFixed(0)}µs` : v < 100 ? `${v.toFixed(1)}ms` : `${v.toFixed(0)}ms`);
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
async function timed(fn, iters = ITERS, warmup = 2) {
  for (let i = 0; i < warmup; i++) await fn();
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return { p50: pct(samples, 50), p95: pct(samples, 95), min: Math.min(...samples), samples };
}
const near = (a, b, tol = 1e-6) => {
  const x = Number(a), y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  const scale = Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(x - y) / scale < tol;
};

async function main() {
  console.log(`# 通用立方体基准（rows=${ROWS.toLocaleString()}, threads=${THREADS}, max_memory=${MAX_MEM}）\n`);
  const instance = await DuckDBInstance.create(':memory:', {
    threads: THREADS,
    max_memory: MAX_MEM,
  });
  const conn = await instance.connect();
  const q = async (sql) => {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjects();
  };

  // ============================================================
  // 1) 合成数据：贴近真实 schema 的 PolicyFact（含批改重复行）+ ClaimsAgg
  // ============================================================
  console.log('## 1. 数据生成');
  let t0 = performance.now();
  await q(`SELECT setseed(0.42)`);
  // 客户类别（11 类）与细分映射、机构偏斜分布、布尔相关性都做成「有结构的随机」，
  // 避免纯均匀随机虚高立方体压缩比。
  await q(`
    CREATE TABLE PolicyFact AS
    WITH cat AS (
      -- cid 由 power(random, 2.5) 生成 → 低位编号占比高，复刻真实业务结构
      -- （非营业客车占大头，特种车/挂车长尾）
      SELECT * FROM (VALUES
        (0,'非营业客车','non_business_passenger'),
        (1,'非营业客车','non_business_passenger'),
        (2,'非营业客车','non_business_passenger'),
        (3,'非营业客车','non_business_passenger'),
        (4,'营业货车','business_truck'),
        (5,'非营业货车','non_business_truck'),
        (6,'摩托车','motorcycle'),
        (7,'营业客车','business_passenger'),
        (8,'出租租赁','taxi'),
        (9,'特种车','special'),
        (10,'挂车','trailer')
      ) AS t(cid, category, seg)
    ),
    base AS (
      SELECT
        i,
        'P' || lpad(CAST(i AS VARCHAR), 9, '0') AS policy_no,
        'VIN' || lpad(CAST(CAST(floor(i * 0.85) AS BIGINT) AS VARCHAR), 9, '0') AS vehicle_frame_no,
        DATE '2024-01-01' + CAST(floor(random() * 892) AS INTEGER) AS policy_date,
        CAST(floor(power(random(), 1.6) * 30) AS INTEGER) AS org_id,
        CAST(floor(random() * 615) AS INTEGER) AS sales_id,
        CAST(floor(power(random(), 2.5) * 11) AS INTEGER) AS cid,
        CASE WHEN random() < 0.42 THEN '交强险' ELSE '商业险' END AS insurance_type,
        random() AS r1, random() AS r2, random() AS r3, random() AS r4, random() AS r5,
        500 + random() * 6000 AS base_premium
      FROM range(${ROWS}) t(i)
    )
    SELECT
      b.policy_no,
      b.vehicle_frame_no,
      b.policy_date,
      b.policy_date + CAST(floor(b.r5 * 6) AS INTEGER) AS insurance_start_date,
      'org_' || lpad(CAST(b.org_id AS VARCHAR), 2, '0') AS org_level_3,
      'sales_' || lpad(CAST(b.sales_id AS VARCHAR), 3, '0') AS salesman_name,
      c.category AS customer_category,
      -- 真实 ETL 里细分要靠多层 LIKE 从字符串解析（B306 F-03 的坑），这里保留原始字符串列
      c.category || CASE WHEN c.seg LIKE '%truck%' THEN '-载货' ELSE '-载客' END
        || CASE WHEN c.seg LIKE 'business%' OR c.seg = 'taxi' THEN '(营运)' ELSE '(非营运)' END AS use_nature_raw,
      b.insurance_type,
      (b.r1 < 0.55) AS is_renewal,
      (b.r2 < 0.08) AS is_transfer,
      -- 电销集中在部分机构（相关性），新能源集中在客车（相关性），新车仅限非续保
      (b.r3 < CASE WHEN b.org_id % 5 = 0 THEN 0.35 ELSE 0.03 END) AS is_telemarketing,
      (b.r4 < CASE WHEN c.cid <= 3 THEN 0.20 ELSE 0.02 END) AS is_nev,
      (b.r1 >= 0.55 AND b.r5 < 0.28) AS is_new_car,
      CASE WHEN c.seg IN ('business_truck','non_business_truck')
           THEN b.base_premium * 1.8 ELSE b.base_premium END AS premium,
      (CASE WHEN c.seg IN ('business_truck','non_business_truck')
           THEN b.base_premium * 1.8 ELSE b.base_premium END) * (0.08 + b.r2 * 0.1) AS fee_amount
    FROM base b JOIN cat c USING (cid)
  `);
  // 批改行：8% 保单追加一行（保费修正），复刻 B252「原单+批改多行 → JOIN 赔款虚增」的坑源
  await q(`
    INSERT INTO PolicyFact
    SELECT policy_no, vehicle_frame_no, policy_date, insurance_start_date,
           org_level_3, salesman_name, customer_category, use_nature_raw, insurance_type,
           is_renewal, is_transfer, is_telemarketing, is_nev, is_new_car,
           premium * 0.06 AS premium, fee_amount * 0.06 AS fee_amount
    FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 7)
  `);
  // 赔款聚合（约 12% 保单有赔案）
  await q(`
    CREATE TABLE ClaimsAgg AS
    SELECT policy_no,
           SUM(premium) * (0.3 + random() * 2.2) AS reported_claims
    FROM (SELECT * FROM PolicyFact USING SAMPLE 12 PERCENT (bernoulli, 13))
    GROUP BY policy_no
  `);
  const [{ n: factRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM PolicyFact`);
  const [{ n: claimRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM ClaimsAgg`);
  console.log(`- PolicyFact ${Number(factRows).toLocaleString()} 行（含批改重复行）/ ClaimsAgg ${Number(claimRows).toLocaleString()} 行，耗时 ${fmtMs(performance.now() - t0)}\n`);

  // L0 基线还原现状：按签单日期排序的物化表（duckdb-materialization.ts 同款）
  t0 = performance.now();
  await q(`CREATE TABLE PolicyFactRealtime AS SELECT * FROM PolicyFact ORDER BY policy_date`);
  await q(`DROP TABLE PolicyFact`);
  await q(`CREATE VIEW PolicyFact AS SELECT * FROM PolicyFactRealtime`);
  console.log(`- L0 物化（ORDER BY policy_date，复刻现状）耗时 ${fmtMs(performance.now() - t0)}`);

  // ============================================================
  // 2) L1 事实表优化：预计算列（segment_tag / 首行标记 / 预关联赔款）
  // ============================================================
  t0 = performance.now();
  await q(`
    CREATE TABLE FactOpt AS
    SELECT
      f.*,
      -- B306 F-03：把 8 层 LIKE 的细分判定一次性物化为整数 tag
      CASE
        WHEN f.use_nature_raw LIKE '摩托车%' THEN 6
        WHEN f.use_nature_raw LIKE '%载货%' AND f.use_nature_raw LIKE '%(营运)%' THEN 4
        WHEN f.use_nature_raw LIKE '%载货%' THEN 5
        WHEN f.use_nature_raw LIKE '出租租赁%' THEN 3
        WHEN f.use_nature_raw LIKE '%载客%' AND f.use_nature_raw LIKE '%(营运)%' THEN 2
        WHEN f.use_nature_raw LIKE '挂车%' THEN 7
        WHEN f.use_nature_raw LIKE '特种车%' THEN 8
        ELSE 1
      END AS segment_tag,
      -- B252 防虚增：保单首行标记（计数/赔款只在首行计一次）
      (ROW_NUMBER() OVER (PARTITION BY f.policy_no ORDER BY f.policy_date, f.premium DESC) = 1) AS is_first_row,
      -- 赔款预关联到首行（查询期不再 JOIN）
      CASE WHEN ROW_NUMBER() OVER (PARTITION BY f.policy_no ORDER BY f.policy_date, f.premium DESC) = 1
           THEN COALESCE(ca.reported_claims, 0) ELSE 0 END AS reported_claims
    FROM PolicyFactRealtime f
    LEFT JOIN ClaimsAgg ca USING (policy_no)
    ORDER BY f.policy_date
  `);
  console.log(`- L1 FactOpt（segment_tag + 首行标记 + 预关联赔款）构建耗时 ${fmtMs(performance.now() - t0)}`);

  // ============================================================
  // 3) L2/L3 立方体：可加性度量预聚合（这一步随每次数据装载事务性重建）
  // ============================================================
  t0 = performance.now();
  await q(`
    CREATE TABLE CubeSignDay AS
    SELECT
      policy_date,
      org_level_3, insurance_type, customer_category, segment_tag,
      is_renewal, is_transfer, is_telemarketing, is_nev, is_new_car,
      SUM(premium) AS premium_sum,
      SUM(fee_amount) AS fee_sum,
      SUM(CASE WHEN is_first_row THEN 1 ELSE 0 END) AS policy_cnt,
      COUNT(*) AS row_cnt
    FROM FactOpt
    GROUP BY ALL
  `);
  const buildSignDay = performance.now() - t0;
  t0 = performance.now();
  // 满期成本立方体：粒度带起保日，任意截止日的满期保费/赔付率可逐行精确重算
  await q(`
    CREATE TABLE CubeCostDay AS
    SELECT
      insurance_start_date,
      org_level_3, insurance_type, customer_category, segment_tag,
      SUM(premium) AS premium_sum,
      SUM(reported_claims) AS claims_sum,
      SUM(CASE WHEN is_first_row THEN 1 ELSE 0 END) AS policy_cnt
    FROM FactOpt
    WHERE insurance_start_date IS NOT NULL
    GROUP BY ALL
  `);
  const buildCostDay = performance.now() - t0;
  t0 = performance.now();
  await q(`
    CREATE TABLE CubeSignWeek AS
    SELECT
      DATE_TRUNC('week', policy_date) AS week_start,
      org_level_3, insurance_type, customer_category, segment_tag,
      is_renewal, is_transfer, is_telemarketing, is_nev, is_new_car,
      SUM(premium_sum) AS premium_sum,
      SUM(fee_sum) AS fee_sum,
      SUM(policy_cnt) AS policy_cnt,
      SUM(row_cnt) AS row_cnt
    FROM CubeSignDay
    GROUP BY ALL
  `);
  const buildWeek = performance.now() - t0;
  t0 = performance.now();
  await q(`
    CREATE TABLE CubeSignMonth AS
    SELECT
      DATE_TRUNC('month', policy_date) AS month_start,
      org_level_3, insurance_type, customer_category, segment_tag,
      is_renewal, is_transfer, is_telemarketing, is_nev, is_new_car,
      SUM(premium_sum) AS premium_sum,
      SUM(fee_sum) AS fee_sum,
      SUM(policy_cnt) AS policy_cnt,
      SUM(row_cnt) AS row_cnt
    FROM CubeSignDay
    GROUP BY ALL
  `);
  const buildMonth = performance.now() - t0;
  const [{ n: cubeDayRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM CubeSignDay`);
  const [{ n: cubeCostRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM CubeCostDay`);
  const [{ n: cubeWeekRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM CubeSignWeek`);
  const [{ n: cubeMonthRows }] = await q(`SELECT COUNT(*)::BIGINT AS n FROM CubeSignMonth`);
  console.log(`- L2 CubeSignDay ${Number(cubeDayRows).toLocaleString()} 行（压缩 ${(Number(factRows) / Number(cubeDayRows)).toFixed(1)}x），构建 ${fmtMs(buildSignDay)}`);
  console.log(`- L2 CubeCostDay ${Number(cubeCostRows).toLocaleString()} 行，构建 ${fmtMs(buildCostDay)}`);
  console.log(`- L3 CubeSignWeek ${Number(cubeWeekRows).toLocaleString()} 行（压缩 ${(Number(factRows) / Number(cubeWeekRows)).toFixed(0)}x），构建 ${fmtMs(buildWeek)}`);
  console.log(`- L3 CubeSignMonth ${Number(cubeMonthRows).toLocaleString()} 行（压缩 ${(Number(factRows) / Number(cubeMonthRows)).toFixed(0)}x），构建 ${fmtMs(buildMonth)}\n`);

  // ============================================================
  // 4) 查询套件：同一语义，四种形态
  // ============================================================
  const ASOF = `DATE '2026-06-10'`;
  const results = [];   // { name, layer, p50, p95 }
  const checks = [];    // { name, ok, detail }

  // ---------- QA：KPI 总览（年度 + 可选机构筛选）----------
  // L0：复刻 generateKpiQuery 的形态 —— 多 CTE 重复扫描 + EXTRACT(YEAR) + 查询期去重 + JOIN 赔款
  const qaBaselineSql = (orgFilter) => `
    WITH filtered AS (
      SELECT * FROM PolicyFact
      WHERE EXTRACT(YEAR FROM policy_date) = 2026 ${orgFilter}
    ),
    filtered_dedup AS (
      SELECT policy_no, MIN(insurance_start_date) AS insurance_start_date,
             SUM(premium) AS premium, SUM(fee_amount) AS fee_amount
      FROM filtered GROUP BY policy_no HAVING SUM(premium) > 0
    ),
    vc AS (
      SELECT
        SUM(f.premium) AS dedup_premium,
        SUM(COALESCE(ca.reported_claims, 0)) AS claims,
        SUM(f.premium * LEAST(GREATEST(DATEDIFF('day', f.insurance_start_date, ${ASOF}) + 1, 0), 365) / 365.0) AS earned_premium
      FROM filtered_dedup f LEFT JOIN ClaimsAgg ca USING (policy_no)
    )
    SELECT
      (SELECT SUM(premium) FROM filtered) AS total_premium,
      (SELECT COUNT(DISTINCT policy_no) FROM filtered) AS policy_count,
      (SELECT SUM(CASE WHEN is_renewal THEN premium ELSE 0 END) / NULLIF(SUM(premium),0) FROM filtered) AS renewal_rate,
      (SELECT SUM(CASE WHEN is_nev THEN premium ELSE 0 END) / NULLIF(SUM(premium),0) FROM filtered) AS nev_rate,
      vc.claims / NULLIF(vc.earned_premium, 0) AS earned_claim_ratio
    FROM vc
  `;
  // L1：单遍扫描 + DATE BETWEEN + 预计算列
  const qaFactOptSql = (orgFilter) => `
    SELECT
      SUM(premium) AS total_premium,
      SUM(CASE WHEN is_first_row THEN 1 ELSE 0 END) AS policy_count,
      SUM(CASE WHEN is_renewal THEN premium ELSE 0 END) / NULLIF(SUM(premium),0) AS renewal_rate,
      SUM(CASE WHEN is_nev THEN premium ELSE 0 END) / NULLIF(SUM(premium),0) AS nev_rate,
      -- 满期保费分母含批改行保费（与 L0 dedup 后 SUM(premium) 同口径；同保单各行起保日相同）
      SUM(reported_claims)
        / NULLIF(SUM(premium * LEAST(GREATEST(DATEDIFF('day', insurance_start_date, ${ASOF}) + 1, 0), 365) / 365.0), 0)
        AS earned_claim_ratio
    FROM FactOpt
    WHERE policy_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31' ${orgFilter}
  `;
  // L2：签单类指标走 CubeSignDay，满期赔付率走 CubeCostDay（任意截止日逐行重算）
  const qaCubeSql = (orgFilter) => `
    WITH sign AS (
      SELECT SUM(premium_sum) AS total_premium,
             SUM(policy_cnt) AS policy_count,
             SUM(CASE WHEN is_renewal THEN premium_sum ELSE 0 END) / NULLIF(SUM(premium_sum),0) AS renewal_rate,
             SUM(CASE WHEN is_nev THEN premium_sum ELSE 0 END) / NULLIF(SUM(premium_sum),0) AS nev_rate
      FROM CubeSignDay
      WHERE policy_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31' ${orgFilter}
    ),
    cost AS (
      SELECT SUM(claims_sum)
               / NULLIF(SUM(premium_sum * LEAST(GREATEST(DATEDIFF('day', insurance_start_date, ${ASOF}) + 1, 0), 365) / 365.0), 0)
               AS earned_claim_ratio
      FROM CubeCostDay
      WHERE insurance_start_date BETWEEN DATE '2026-01-01' AND DATE '2027-01-06' ${orgFilter}
    )
    SELECT sign.*, cost.earned_claim_ratio FROM sign, cost
  `;

  // 注意：QA 满期口径 — L0 基线按「2026 年签单的保单」算满期赔付率（filtered 范围），
  // 立方体按起保日窗口取（签单 2026 → 起保最晚 2027-01-06，policy_date+5 天内起保），
  // 两者集合相同的前提是签单年筛选 ↔ 起保窗口能换算。本原型中 insurance_start_date ∈ [policy_date, policy_date+5]，
  // 但起保窗口里也会混入 2025 年末签单+2026 年初起保的保单 → 为保证严格等值校验，
  // CubeCostDay 校验使用独立口径（按起保年），与 L0 的独立对照查询比对。见 QA-cost 校验。

  console.log('## 2. 查询基准（p50 / p95，单位 ms）\n');
  console.log('| 查询语义 | L0 现状基线 | L1 事实表优化 | L2 日立方体 | L3 周立方体 |');
  console.log('|---|---|---|---|---|');

  const benchRow = async (name, sqls, extras = {}) => {
    const row = { name };
    const out = {};
    for (const [layer, sql] of Object.entries(sqls)) {
      if (!sql) { out[layer] = null; continue; }
      let last;
      const t = await timed(async () => { last = await q(sql); });
      out[layer] = { ...t, rows: last };
      row[layer] = t;
    }
    results.push({ name, layers: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v ? { p50: v.p50, p95: v.p95 } : null])) });
    const cell = (v) => (v ? `${fmtMs(v.p50)} / ${fmtMs(v.p95)}` : '—');
    console.log(`| ${name} | ${cell(row.L0)} | ${cell(row.L1)} | ${cell(row.L2)} | ${cell(row.L3)} |`);
    return out;
  };

  // QA 全公司
  const qaAll = await benchRow('KPI 总览（全公司，2026 年）', {
    L0: qaBaselineSql(''),
    L1: qaFactOptSql(''),
    L2: qaCubeSql(''),
  });
  // QA 单机构
  const orgF = `AND org_level_3 = 'org_03'`;
  const qaOrg = await benchRow('KPI 总览（单机构下钻）', {
    L0: qaBaselineSql(orgF),
    L1: qaFactOptSql(orgF),
    L2: qaCubeSql(orgF),
  });

  // 等值校验：QA 签单类指标（total/count/rates）L0 vs L1 vs L2
  for (const [tag, set] of [['全公司', qaAll], ['单机构', qaOrg]]) {
    const b = set.L0.rows[0], f = set.L1.rows[0], c = set.L2.rows[0];
    for (const k of ['total_premium', 'policy_count', 'renewal_rate', 'nev_rate']) {
      checks.push({ name: `QA ${tag} ${k}: L0=L1=L2`, ok: near(b[k], f[k]) && near(b[k], c[k]), detail: `${b[k]} | ${f[k]} | ${c[k]}` });
    }
    // 满期赔付率：L0 与 L1 同口径（按签单年），应严格相等
    checks.push({ name: `QA ${tag} earned_claim_ratio: L0=L1`, ok: near(b.earned_claim_ratio, f.earned_claim_ratio), detail: `${b.earned_claim_ratio} | ${f.earned_claim_ratio}` });
  }
  // 满期赔付率 立方体口径独立校验：按起保年 2026，与事实表同口径对照
  {
    const [bc] = await q(`
      SELECT SUM(reported_claims)
               / NULLIF(SUM(premium * LEAST(GREATEST(DATEDIFF('day', insurance_start_date, ${ASOF}) + 1, 0), 365) / 365.0), 0) AS r
      FROM FactOpt WHERE insurance_start_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
    `);
    const [cc] = await q(`
      SELECT SUM(claims_sum)
               / NULLIF(SUM(premium_sum * LEAST(GREATEST(DATEDIFF('day', insurance_start_date, ${ASOF}) + 1, 0), 365) / 365.0), 0) AS r
      FROM CubeCostDay WHERE insurance_start_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
    `);
    checks.push({ name: 'QA-cost 满期赔付率（按起保年，任意截止日重算）: 事实表=立方体', ok: near(bc.r, cc.r, 1e-9), detail: `${bc.r} | ${cc.r}` });
  }

  // ---------- QB：周趋势 × 业务细分（LIKE 解析 vs 预计算 tag）----------
  // 设计规则：周立方体只精确服务「整周对齐」窗口（周一~周日），非对齐窗口自动路由日立方体。
  // 基准用对齐窗口 2026-01-05(周一) ~ 2026-06-07(周日)，保证四层语义严格等值。
  const QB_LO = `DATE '2026-01-05'`, QB_HI = `DATE '2026-06-07'`;
  const qbBaseline = `
    SELECT CAST(DATE_TRUNC('week', policy_date) AS VARCHAR) AS week_start,
      CASE
        WHEN use_nature_raw LIKE '摩托车%' THEN 6
        WHEN use_nature_raw LIKE '%载货%' AND use_nature_raw LIKE '%(营运)%' THEN 4
        WHEN use_nature_raw LIKE '%载货%' THEN 5
        WHEN use_nature_raw LIKE '出租租赁%' THEN 3
        WHEN use_nature_raw LIKE '%载客%' AND use_nature_raw LIKE '%(营运)%' THEN 2
        WHEN use_nature_raw LIKE '挂车%' THEN 7
        WHEN use_nature_raw LIKE '特种车%' THEN 8
        ELSE 1
      END AS segment_tag,
      SUM(premium) AS premium_sum
    FROM PolicyFact
    WHERE policy_date BETWEEN ${QB_LO} AND ${QB_HI}
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const qbFactOpt = `
    SELECT CAST(DATE_TRUNC('week', policy_date) AS VARCHAR) AS week_start, segment_tag, SUM(premium) AS premium_sum
    FROM FactOpt
    WHERE policy_date BETWEEN ${QB_LO} AND ${QB_HI}
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const qbCubeDay = `
    SELECT CAST(DATE_TRUNC('week', policy_date) AS VARCHAR) AS week_start, segment_tag, SUM(premium_sum) AS premium_sum
    FROM CubeSignDay
    WHERE policy_date BETWEEN ${QB_LO} AND ${QB_HI}
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const qbCubeWeek = `
    SELECT CAST(week_start AS VARCHAR) AS week_start, segment_tag, SUM(premium_sum) AS premium_sum
    FROM CubeSignWeek
    WHERE week_start BETWEEN ${QB_LO} AND DATE '2026-06-01'
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  const qb = await benchRow('周趋势 × 业务细分（整周对齐窗口）', {
    L0: qbBaseline, L1: qbFactOpt, L2: qbCubeDay, L3: qbCubeWeek,
  });
  {
    const key = (r) => `${r.week_start}|${r.segment_tag}`;
    const m0 = new Map(qb.L0.rows.map((r) => [key(r), Number(r.premium_sum)]));
    let okAll = true; let bad = '';
    for (const layer of ['L1', 'L2', 'L3']) {
      for (const r of qb[layer].rows) {
        const v0 = m0.get(key(r));
        if (v0 === undefined || !near(v0, r.premium_sum)) { okAll = false; bad = `${layer} ${key(r)}: ${v0} vs ${r.premium_sum}`; break; }
      }
      if (qb[layer].rows.length !== qb.L0.rows.length) { okAll = false; bad = `${layer} 行数 ${qb[layer].rows.length} vs ${qb.L0.rows.length}`; }
    }
    checks.push({ name: 'QB 周趋势×细分 全行等值（L0=L1=L2=L3）', ok: okAll, detail: bad || `${qb.L0.rows.length} 行全部相等` });
  }

  // ---------- QC：同比（双扫 vs 单扫 vs 立方体）----------
  const qcBaseline = `
    WITH cur AS (
      SELECT org_level_3, SUM(premium) AS p FROM PolicyFact
      WHERE EXTRACT(YEAR FROM policy_date) = 2026 GROUP BY 1
    ),
    prev AS (
      SELECT org_level_3, SUM(premium) AS p FROM PolicyFact
      WHERE EXTRACT(YEAR FROM policy_date) = 2025 GROUP BY 1
    )
    SELECT cur.org_level_3, cur.p AS cur_premium, prev.p AS prev_premium,
           (cur.p - prev.p) / NULLIF(prev.p, 0) AS yoy
    FROM cur LEFT JOIN prev USING (org_level_3) ORDER BY 1
  `;
  const qcSingleScan = (table, col) => `
    SELECT org_level_3,
           SUM(CASE WHEN policy_date >= DATE '2026-01-01' THEN ${col} ELSE 0 END) AS cur_premium,
           SUM(CASE WHEN policy_date < DATE '2026-01-01' THEN ${col} ELSE 0 END) AS prev_premium,
           (SUM(CASE WHEN policy_date >= DATE '2026-01-01' THEN ${col} ELSE 0 END)
            - SUM(CASE WHEN policy_date < DATE '2026-01-01' THEN ${col} ELSE 0 END))
             / NULLIF(SUM(CASE WHEN policy_date < DATE '2026-01-01' THEN ${col} ELSE 0 END), 0) AS yoy
    FROM ${table}
    WHERE policy_date BETWEEN DATE '2025-01-01' AND DATE '2026-12-31'
    GROUP BY 1 ORDER BY 1
  `;
  const qc = await benchRow('机构同比（2026 vs 2025）', {
    L0: qcBaseline,
    L1: qcSingleScan('FactOpt', 'premium'),
    L2: qcSingleScan('CubeSignDay', 'premium_sum'),
  });
  {
    const m0 = new Map(qc.L0.rows.map((r) => [r.org_level_3, r]));
    let okAll = true; let bad = '';
    for (const layer of ['L1', 'L2']) {
      for (const r of qc[layer].rows) {
        const v0 = m0.get(r.org_level_3);
        if (!v0 || !near(v0.cur_premium, r.cur_premium) || !near(v0.prev_premium ?? 0, r.prev_premium)) {
          okAll = false; bad = `${layer} ${r.org_level_3}`; break;
        }
      }
    }
    checks.push({ name: 'QC 同比 全行等值（L0=L1=L2）', ok: okAll, detail: bad || `${qc.L0.rows.length} 机构全部相等` });
  }

  // ---------- QD：任意组合下钻（快照路线的死穴：参数组合无法穷举预热）----------
  const cats = ['非营业客车', '营业客车', '营业货车', '非营业货车', '摩托车', '特种车', '挂车', '出租租赁'];
  const rng = (() => { let s = 42; return () => (s = (s * 48271) % 2147483647) / 2147483647; })();
  const combos = Array.from({ length: DRILL_COMBOS }, () => {
    const parts = [];
    parts.push(`org_level_3 = 'org_${String(Math.floor(rng() * 30)).padStart(2, '0')}'`);
    if (rng() < 0.7) parts.push(`customer_category = '${cats[Math.floor(rng() * cats.length)]}'`);
    if (rng() < 0.5) parts.push(`is_renewal = ${rng() < 0.5}`);
    if (rng() < 0.4) parts.push(`insurance_type = '${rng() < 0.5 ? '交强险' : '商业险'}'`);
    const m = Math.floor(rng() * 5) + 1;
    parts.push(`policy_date BETWEEN DATE '2026-0${m}-01' AND DATE '2026-06-10'`);
    return parts.join(' AND ');
  });
  const drill = async (table, premiumCol, cntExpr) => {
    const t0 = performance.now();
    const out = [];
    for (const w of combos) {
      const [r] = await q(`SELECT SUM(${premiumCol}) AS p, ${cntExpr} AS c FROM ${table} WHERE ${w}`);
      out.push(r);
    }
    return { totalMs: performance.now() - t0, out };
  };
  // L0 用 EXTRACT 风格日期没法直接套（combos 已是 BETWEEN），保持现状语义：宽表 + 查询期 distinct 计数
  const d0 = await drill('PolicyFact', 'premium', 'COUNT(DISTINCT policy_no)');
  const d1 = await drill('FactOpt', 'premium', 'SUM(CASE WHEN is_first_row THEN 1 ELSE 0 END)');
  const d2 = await drill('CubeSignDay', 'premium_sum', 'SUM(policy_cnt)');
  results.push({
    name: `任意组合下钻 ×${DRILL_COMBOS}`,
    layers: {
      L0: { p50: d0.totalMs / DRILL_COMBOS, p95: null },
      L1: { p50: d1.totalMs / DRILL_COMBOS, p95: null },
      L2: { p50: d2.totalMs / DRILL_COMBOS, p95: null },
    },
  });
  console.log(`| 任意组合下钻（均值/次，共 ${DRILL_COMBOS} 组合） | ${fmtMs(d0.totalMs / DRILL_COMBOS)} | ${fmtMs(d1.totalMs / DRILL_COMBOS)} | ${fmtMs(d2.totalMs / DRILL_COMBOS)} | — |`);
  {
    let okAll = true; let bad = '';
    for (let i = 0; i < combos.length; i++) {
      if (!near(d0.out[i].p ?? 0, d1.out[i].p ?? 0) || !near(d0.out[i].p ?? 0, d2.out[i].p ?? 0)
        || !near(d0.out[i].c ?? 0, d1.out[i].c ?? 0) || !near(d0.out[i].c ?? 0, d2.out[i].c ?? 0)) {
        okAll = false; bad = `combo#${i}: p=${d0.out[i].p},c=${d0.out[i].c} vs p=${d2.out[i].p},c=${d2.out[i].c}`; break;
      }
    }
    checks.push({ name: `QD 任意组合下钻 ×${DRILL_COMBOS} 等值（L0=L1=L2，保费+件数）`, ok: okAll, detail: bad || '全部组合相等' });
  }

  // ============================================================
  // 5) L3+：Node 进程内列式引擎（TypedArray），验证亚毫秒可行性
  // ============================================================
  console.log('\n## 3. Node 进程内列式引擎（旁路 SQL/连接池，验证亚毫秒下限）\n');
  const loadCols = async (table, dateCol) => {
    const rows = await q(`
      SELECT DATEDIFF('day', DATE '2024-01-01', ${dateCol}) AS d,
             CAST(SUBSTR(org_level_3, 5) AS INTEGER) AS org,
             CASE insurance_type WHEN '交强险' THEN 0 ELSE 1 END AS ityp,
             segment_tag AS seg,
             (is_renewal::INT * 1 + is_transfer::INT * 2 + is_telemarketing::INT * 4 + is_nev::INT * 8 + is_new_car::INT * 16) AS flags,
             premium_sum, policy_cnt
      FROM ${table}
    `);
    const n = rows.length;
    const c = {
      n,
      d: new Int32Array(n), org: new Uint8Array(n), ityp: new Uint8Array(n),
      seg: new Uint8Array(n), flags: new Uint8Array(n),
      premium: new Float64Array(n), cnt: new Float64Array(n),
    };
    rows.forEach((r, i) => {
      c.d[i] = Number(r.d); c.org[i] = Number(r.org); c.ityp[i] = Number(r.ityp);
      c.seg[i] = Number(r.seg); c.flags[i] = Number(r.flags);
      c.premium[i] = Number(r.premium_sum); c.cnt[i] = Number(r.policy_cnt);
    });
    return c;
  };
  const dayOf = (iso) => Math.round((Date.parse(iso) - Date.parse('2024-01-01')) / 86400000);
  const engineQuery = (c, f) => {
    let p = 0, cnt = 0, renewalP = 0;
    const { d0: lo, d1: hi, org, renewal } = f;
    for (let i = 0; i < c.n; i++) {
      if (c.d[i] < lo || c.d[i] > hi) continue;
      if (org >= 0 && c.org[i] !== org) continue;
      if (renewal >= 0 && ((c.flags[i] & 1) !== renewal)) continue;
      p += c.premium[i]; cnt += c.cnt[i];
      if (c.flags[i] & 1) renewalP += c.premium[i];
    }
    return { total_premium: p, policy_count: cnt, renewal_rate: renewalP / (p || 1) };
  };

  const colsDay = await loadCols('CubeSignDay', 'policy_date');
  const colsWeek = await loadCols('CubeSignWeek', 'week_start');
  const colsMonth = await loadCols('CubeSignMonth', 'month_start');
  const heapMB = (process.memoryUsage().heapUsed / 1048576).toFixed(0);
  const engFilter = { d0: dayOf('2026-01-01'), d1: dayOf('2026-12-31'), org: -1, renewal: -1 };
  const engDay = await timed(() => engineQuery(colsDay, engFilter), 200, 20);
  const engWeek = await timed(() => engineQuery(colsWeek, engFilter), 200, 20);
  // 月对齐窗口（标准 OLAP 上卷路由：YTD/整月查询走月立方体，日边角走日立方体补差）
  const engMonth = await timed(() => engineQuery(colsMonth, engFilter), 500, 50);
  // 等值校验：引擎 vs 立方体 SQL
  const engRes = engineQuery(colsDay, engFilter);
  const [cubeRes] = await q(`
    SELECT SUM(premium_sum) AS p, SUM(policy_cnt) AS c FROM CubeSignDay
    WHERE policy_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
  `);
  checks.push({ name: '引擎 vs 立方体 SQL（2026 全年保费+件数）', ok: near(engRes.total_premium, cubeRes.p) && near(engRes.policy_count, cubeRes.c), detail: `${engRes.total_premium} | ${cubeRes.p}` });

  // 月立方体引擎结果与 SQL 等值校验（2026 YTD 为月对齐窗口：数据止于 2026-06-10，
  // 此处用 1-5 月整月窗口验证）
  const engMonthFilter = { d0: dayOf('2026-01-01'), d1: dayOf('2026-05-31'), org: -1, renewal: -1 };
  const engMonthRes = engineQuery(colsMonth, engMonthFilter);
  const [cubeMonthRes] = await q(`
    SELECT SUM(premium_sum) AS p, SUM(policy_cnt) AS c FROM CubeSignDay
    WHERE policy_date BETWEEN DATE '2026-01-01' AND DATE '2026-05-31'
  `);
  checks.push({ name: '引擎·月立方体 vs 日立方体 SQL（2026 年 1-5 月整月窗口）', ok: near(engMonthRes.total_premium, cubeMonthRes.p) && near(engMonthRes.policy_count, cubeMonthRes.c), detail: `${engMonthRes.total_premium} | ${cubeMonthRes.p}` });

  console.log(`| 引擎数据集 | 行数 | KPI 聚合 p50 | p95 |`);
  console.log(`|---|---|---|---|`);
  console.log(`| 日立方体（TypedArray 全扫） | ${colsDay.n.toLocaleString()} | ${fmtMs(engDay.p50)} | ${fmtMs(engDay.p95)} |`);
  console.log(`| 周立方体（TypedArray 全扫） | ${colsWeek.n.toLocaleString()} | ${fmtMs(engWeek.p50)} | ${fmtMs(engWeek.p95)} |`);
  console.log(`| 月立方体（TypedArray 全扫） | ${colsMonth.n.toLocaleString()} | ${fmtMs(engMonth.p50)} | ${fmtMs(engMonth.p95)} |`);
  console.log(`\n（Node 堆内存占用 ≈ ${heapMB}MB，含三份列式数据集）`);

  // ============================================================
  // 6) 校验汇总 + 倍数结论 + 产物落盘
  // ============================================================
  console.log('\n## 4. 数值等值校验（立方体结果必须与基线完全一致才算数）\n');
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`- ${c.ok ? '✅' : '❌'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
  }

  const qaL0 = results[0].layers.L0.p50, qaL2 = results[0].layers.L2.p50;
  const qdL0 = d0.totalMs / DRILL_COMBOS, qdL2 = d2.totalMs / DRILL_COMBOS;
  console.log('\n## 5. 加速倍数（同语义、等值校验通过的前提下）\n');
  console.log(`- KPI 总览：L0 ${fmtMs(qaL0)} → L2 ${fmtMs(qaL2)} = **${(qaL0 / qaL2).toFixed(0)}x**`);
  console.log(`- 任意组合下钻：L0 ${fmtMs(qdL0)} → L2 ${fmtMs(qdL2)} = **${(qdL0 / qdL2).toFixed(0)}x**`);
  console.log(`- KPI 聚合（进程内引擎·周立方体）：L0 ${fmtMs(qaL0)} → ${fmtMs(engWeek.p50)} = **${(qaL0 / engWeek.p50).toFixed(0)}x**`);
  console.log(`- KPI 聚合（进程内引擎·月立方体，月对齐窗口）：L0 ${fmtMs(qaL0)} → ${fmtMs(engMonth.p50)} = **${(qaL0 / engMonth.p50).toFixed(0)}x**`);
  console.log(`- 历史最坏冷路径参照（实测生产 miss + 排队 3-10s）：10000ms → ${fmtMs(engMonth.p50)} ≈ **${(10000 / engMonth.p50).toFixed(0)}x**`);

  const artifact = {
    generatedAt: new Date().toISOString(),
    config: { rows: ROWS, threads: THREADS, maxMemory: MAX_MEM, iters: ITERS, drillCombos: DRILL_COMBOS },
    dataset: { factRows: Number(factRows), claimRows: Number(claimRows), cubeDayRows: Number(cubeDayRows), cubeCostRows: Number(cubeCostRows), cubeWeekRows: Number(cubeWeekRows), cubeMonthRows: Number(cubeMonthRows) },
    cubeBuildMs: { signDay: buildSignDay, costDay: buildCostDay, signWeek: buildWeek, signMonth: buildMonth },
    queries: results,
    engine: { heapMB: Number(heapMB), dayRows: colsDay.n, weekRows: colsWeek.n, monthRows: colsMonth.n, kpiDay: { p50: engDay.p50, p95: engDay.p95 }, kpiWeek: { p50: engWeek.p50, p95: engWeek.p95 }, kpiMonth: { p50: engMonth.p50, p95: engMonth.p95 } },
    checks: checks.map(({ name, ok }) => ({ name, ok })),
    allChecksPassed: allOk,
  };
  const outDir = path.join(REPO_ROOT, 'artifacts', 'perf');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `bench-universal-cube-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(`\n产物：${path.relative(REPO_ROOT, outFile)}`);
  console.log(allOk ? '\n✅ 全部等值校验通过' : '\n❌ 存在等值校验失败 — 上方倍数无效，先修正口径');
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err) => {
  console.error('基准运行失败:', err);
  process.exit(1);
});
