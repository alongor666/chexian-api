#!/usr/bin/env bun
/**
 * T1 — 生产立方体构建成本 / OOM 实测探针
 *
 * 架构复核 R2 的闭环工具：容器基准 ≠ 生产事实。本脚本在【真实 Parquet】+【模拟
 * 生产配置（2 线程 / 1.5GB 内存上限）】下，用【生产同一套 build SQL】测量：
 *   - 三立方体（趋势 / 业务员 / 成本）各自构建耗时、行数、压缩比
 *   - 成本立方体跨格保单探针结论（exact=true 才可服务，false=本数据版本降级）
 *   - 成本立方体是否 OOM（捕获 Out of Memory，与生产 cost-cube.ts:200 同正则判定）
 *   - 构建后 DuckDB 内存占用（瞬时，非峰值，仅供量级参考）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §3.4 / §4 阶段 0/1
 *
 * 「不漂移」保证（红线：复用不手抄）：
 *   - PolicyFact 视图经生产 column-normalizer.generateColumnMappingSQL 规范化
 *     （派生 is_renewal、缺失布尔列补 false、其余补 NULL —— 维度列与生产逐列一致）
 *   - 三立方体均 import 生产 buildTrendCubeSql / buildSalesmanCubeSql /
 *     buildCostCubeSql(+Probe)，构建口径与切流路径同源
 *   - 仅 raw_parquet 装载与 ClaimsAgg 两条稳定 SQL 手抄（标注 SSOT 来源行号，
 *     该处变更需同步本脚本）；它们不是构建成本/OOM 的主因（主因是 PolicyFact 去重）
 *
 * 用法（在【有真实数据】的位置跑 —— 主仓库本地或 VPS，worktree 无数据）：
 *   bun scripts/perf/cube-build-prod-probe.ts
 *   bun scripts/perf/cube-build-prod-probe.ts --threads 2 --mem 1536MB --iters 3
 *   # VPS 运行时数据目录：
 *   bun scripts/perf/cube-build-prod-probe.ts \
 *     --policy 'server/data/fact/policy/current/*.parquet' \
 *     --claims 'server/data/fact/claims_detail/claims_*.parquet'
 *
 * 退出码：0 = 全部立方体可服务且无 OOM（R2 前置通过）；
 *         1 = 成本立方体 OOM 或探针降级（exact=false）→ 切流阻塞信号；
 *         2 = 数据加载 / 环境错误。
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { generateColumnMappingSQL } from '../../server/src/services/column-normalizer.js';
import { buildTrendCubeSql, TREND_CUBE_TABLE } from '../../server/src/sql/cube/trend-cube.js';
import { buildSalesmanCubeSql, SALESMAN_CUBE_TABLE } from '../../server/src/sql/cube/salesman-cube.js';
import {
  buildCostCubeSql,
  buildCostCubeProbeSql,
  COST_CUBE_TABLE,
  COST_CUBE_DIMENSIONS,
  COST_CUBE_OPTIONAL_DIMENSIONS,
} from '../../server/src/sql/cube/cost-cube.js';

// 复用 server 的 DuckDB 原生依赖（与生产同版本 @duckdb/node-api）
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { DuckDBInstance } = serverRequire('@duckdb/node-api');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── 参数解析 ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`T1 立方体构建成本 / OOM 实测探针

用法: bun scripts/perf/cube-build-prod-probe.ts [选项]

选项:
  --policy <glob>   保单 Parquet glob（默认 数据管理/warehouse/fact/policy/current/*.parquet）
  --claims <glob>   赔案 Parquet glob（默认 数据管理/warehouse/fact/claims_detail/claims_*.parquet）
  --threads <n>     DuckDB 线程数（默认 2，模拟 VPS 2 核）
  --mem <size>      DuckDB 内存上限（默认 1536MB，模拟 VPS DUCKDB_MAX_MEMORY）
  --iters <n>       每立方体构建计时迭代数（默认 3，取 min/median）
  --isolate         隔离模式：每张立方体构建测量后即 DROP 释放内存（判断单张 vs 累积内存需求）；
                    默认累积模式（三表常驻，复刻生产 reload 后内存形态）
  --diagnose-impure 只跑成本立方体「跨格保单」根因分解（按维度列归因），跳过立方体构建；
                    11 列 COUNT(DISTINCT) 内存重，建议配 --mem 4096MB
  --out <dir>       JSON 产物目录（默认 artifacts/perf）
  -h, --help        显示本帮助

退出码: 0=可服务且无 OOM / 1=OOM 或探针降级 / 2=数据或环境错误`);
  process.exit(0);
}
const argVal = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const POLICY_GLOB = argVal('policy', path.resolve(REPO_ROOT, '数据管理/warehouse/fact/policy/current/*.parquet'));
const CLAIMS_GLOB = argVal('claims', path.resolve(REPO_ROOT, '数据管理/warehouse/fact/claims_detail/claims_*.parquet'));
const THREADS = argVal('threads', '2');
const MAX_MEM = argVal('mem', '1536MB');
const ITERS = Math.max(1, Number(argVal('iters', '3')));
const ISOLATE = argv.includes('--isolate');
const DIAGNOSE_IMPURE = argv.includes('--diagnose-impure');
const OUT_DIR = path.resolve(REPO_ROOT, argVal('out', 'artifacts/perf'));

// ── 工具 ─────────────────────────────────────────────────────────────────────
/** DuckDB 单引号转义（domain_duckdb_string_escaping：只转义单引号） */
const sqlStr = (s: string): string => s.replace(/'/g, "''");
const num = (v: unknown): number => Number(v); // BIGINT → number
const fmtMs = (v: number): string => (v < 100 ? `${v.toFixed(1)}ms` : `${(v / 1000).toFixed(2)}s`);
const fmtInt = (v: number): string => v.toLocaleString();
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** 与生产 cost-cube.ts:200 / duckdb-cube.ts 同正则 */
const isOomError = (msg: string): boolean => /Out of Memory|OOM|memory_limit/i.test(msg);
/** DuckDB Neo 错误对象的 message 不一定在 .message 上，逐层兜底提取 */
const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message || e.stack || String(e);
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (m) return String(m);
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
};

interface CubeBuildResult {
  table: string;
  label: string;
  buildMinMs: number | null;
  buildMedianMs: number | null;
  rows: number | null;
  oom: boolean;
  error: string | null;
  memBytes?: number | null; // 构建后 DuckDB 内存占用（累积模式含前序表，隔离模式为单张）
  // 成本立方体专属
  exact?: boolean;
  probeMs?: number;
  impurePolicies?: number;
  dedupRows?: number;
}

async function main(): Promise<number> {
  console.log(`# 立方体构建成本 / OOM 实测（生产口径）\n`);
  console.log(`- 配置：threads=${THREADS} · max_memory=${MAX_MEM} · iters=${ITERS}`);
  console.log(`- 保单：\`${POLICY_GLOB}\``);
  console.log(`- 赔案：\`${CLAIMS_GLOB}\`\n`);

  const instance = await DuckDBInstance.create(':memory:', { threads: THREADS, max_memory: MAX_MEM });
  const conn = await instance.connect();
  const q = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjects() as T[];
  };
  /** DuckDB 当前内存占用（瞬时；不同版本列名差异容错，失败返回 null） */
  const memNow = async (): Promise<number | null> => {
    try {
      const [{ mem }] = await q<{ mem: number }>(`SELECT COALESCE(SUM(memory_usage_bytes), 0) AS mem FROM duckdb_memory()`);
      return num(mem);
    } catch { return null; }
  };

  // ── 1. 装载真实 Parquet → raw_parquet → PolicyFact（生产规范化）──────────────
  console.log(`## 1. 数据装载`);
  let t0 = performance.now();
  try {
    // raw_parquet：手抄自 duckdb-parquet-loader.ts:141（read_parquet + union_by_name）
    await q(`CREATE OR REPLACE VIEW raw_parquet AS SELECT * FROM read_parquet('${sqlStr(POLICY_GLOB)}', union_by_name=true)`);
  } catch (e) {
    console.error(`\n❌ 保单 Parquet 加载失败：${(e as Error).message}`);
    console.error(`   worktree 无数据，请在主仓库或 VPS 跑，或用 --policy 指向真实数据目录。`);
    return 2;
  }
  const rawCols = (await q<{ column_name: string }>(`DESCRIBE raw_parquet`)).map((r) => r.column_name);
  // PolicyFact：生产 column-normalizer 规范化视图（维度列派生逻辑与切流路径一致）
  await q(generateColumnMappingSQL('raw_parquet', rawCols));
  const [{ n: policyRows }] = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM PolicyFact`);

  // ClaimsDetail VIEW + ClaimsAgg（手抄自 duckdb-domain-loaders.ts:445-484，口径稳定；该处变更需同步）
  try {
    await q(`CREATE OR REPLACE VIEW ClaimsDetail AS SELECT * FROM read_parquet('${sqlStr(CLAIMS_GLOB)}', union_by_name=true)`);
    await q(`
      CREATE OR REPLACE TABLE ClaimsAgg AS
      SELECT policy_no,
             COUNT(DISTINCT claim_no) AS claim_cases,
             SUM(CASE
                   WHEN COALESCE(liability_ratio, 100) > 0
                    AND (case_type IS NULL OR case_type NOT IN ('零结','注销','拒赔'))
                   THEN (CASE WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                              ELSE COALESCE(reserve_amount, 0) END)
                   ELSE 0
                 END) AS reported_claims
      FROM ClaimsDetail
      WHERE policy_no IS NOT NULL
      GROUP BY policy_no
    `);
  } catch (e) {
    console.error(`\n❌ 赔案 Parquet 加载失败：${(e as Error).message}`);
    console.error(`   用 --claims 指向真实赔案目录。`);
    return 2;
  }
  const [{ n: claimsAggRows }] = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ClaimsAgg`);

  // schema 探测（镜像 duckdb-cube.ts:22-25 detectPolicyDateIsTimestamp + :74 hasBranchCode）
  const pfSchema = await q<{ column_name: string; column_type: string }>(`DESCRIBE PolicyFact`);
  const hasBranchCode = pfSchema.some((c) => c.column_name === 'branch_code');
  const policyDateCol = pfSchema.find((c) => c.column_name === 'policy_date');
  const policyDateIsTimestamp =
    typeof policyDateCol?.column_type === 'string' && policyDateCol.column_type.toUpperCase().startsWith('TIMESTAMP');
  console.log(
    `- PolicyFact: ${fmtInt(num(policyRows))} 行 · ClaimsAgg: ${fmtInt(num(claimsAggRows))} 行 ` +
      `· branch_code=${hasBranchCode} · policy_date_ts=${policyDateIsTimestamp} · 装载 ${fmtMs(performance.now() - t0)}\n`
  );

  // ── 跨格保单根因分解（--diagnose-impure，跳过立方体构建）──────────────────────
  if (DIAGNOSE_IMPURE) {
    const impureDims = [...COST_CUBE_DIMENSIONS, ...(hasBranchCode ? COST_CUBE_OPTIONAL_DIMENSIONS : [])];
    const allDims = ['insurance_start_date', ...impureDims]; // 探针归因的全部列
    const perCols = allDims.map((d) =>
      d === 'insurance_start_date'
        ? `COUNT(DISTINCT CAST(insurance_start_date AS DATE)) AS d__${d}`
        : `COUNT(DISTINCT COALESCE(CAST(${d} AS VARCHAR), '__NULL__')) AS d__${d}`
    );
    const impureCond = allDims.map((d) => `d__${d} > 1`).join(' OR ');
    const byCols = allDims.map((d) => `SUM(CASE WHEN d__${d} > 1 THEN 1 ELSE 0 END) AS by__${d}`);
    const sql = `
      WITH per_policy AS (
        SELECT policy_no, ${perCols.join(', ')}
        FROM PolicyFact
        WHERE insurance_start_date IS NOT NULL
        GROUP BY policy_no
      )
      SELECT COUNT(*) AS total_policies,
             SUM(CASE WHEN ${impureCond} THEN 1 ELSE 0 END) AS impure_total,
             ${byCols.join(', ')}
      FROM per_policy
    `;
    console.log(`## 跨格保单根因分解（按维度列归因，--mem ${MAX_MEM}）\n`);
    let rows: Record<string, unknown>[];
    try {
      rows = await q(sql);
    } catch (e) {
      const msg = errMsg(e);
      console.error(`❌ 诊断查询失败：${msg}`);
      if (isOomError(msg)) console.error(`   11 列 COUNT(DISTINCT) 内存重，请加大 --mem（如 4096MB）后重试。`);
      return 2;
    }
    const row = rows[0] ?? {};
    const total = num(row.total_policies);
    const impure = num(row.impure_total);
    console.log(`- 去重保单数：${fmtInt(total)} · 跨格保单：${fmtInt(impure)}（${(impure / total * 100).toFixed(2)}%）`);
    console.log(`- 跨格 = 同一 policy_no 的多行在该列取值不唯一（一张保单可能多列同时跨格，故各列之和 ≥ 跨格总数）\n`);
    console.log(`| 维度列 | 致跨格保单数 | 占跨格 |`);
    console.log(`|---|---|---|`);
    for (const c of allDims.map((d) => ({ col: d, n: num(row[`by__${d}`]) })).sort((a, b) => b.n - a.n)) {
      if (c.n === 0) continue;
      console.log(`| ${c.col} | ${fmtInt(c.n)} | ${impure > 0 ? (c.n / impure * 100).toFixed(1) : '0'}% |`);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(OUT_DIR, `cube-cost-impure-diagnose-${stamp}.json`);
    // DuckDB COUNT 返回 BigInt，JSON.stringify 无法序列化 → 逐值转 number
    const byColumn = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, num(v)]));
    writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), totalPolicies: total, impureTotal: impure, byColumn }, null, 2));
    console.log(`\n产物：${path.relative(REPO_ROOT, outPath)}`);
    return 0;
  }

  const results: CubeBuildResult[] = [];

  // ── 2. 趋势 / 业务员立方体（行级可加，无探针）─────────────────────────────────
  const buildSimple = async (
    label: string,
    table: string,
    buildSql: string
  ): Promise<CubeBuildResult> => {
    const samples: number[] = [];
    let oom = false;
    let error: string | null = null;
    for (let i = 0; i < ITERS; i++) {
      try {
        const s = performance.now();
        await q(buildSql);
        samples.push(performance.now() - s);
      } catch (e) {
        const msg = errMsg(e);
        console.error(`  [构建错误] ${label}: ${msg}`);
        if (isOomError(msg)) { oom = true; } else { error = msg; }
        break;
      }
    }
    let rows: number | null = null;
    let memBytes: number | null = null;
    if (samples.length > 0 && !oom && !error) {
      const rr = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      rows = rr.length ? num(rr[0].n) : null;
      memBytes = await memNow();
      if (ISOLATE) await q(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    }
    return {
      table, label,
      buildMinMs: samples.length ? Math.min(...samples) : null,
      buildMedianMs: samples.length ? median(samples) : null,
      rows,
      oom, error, memBytes,
    };
  };

  console.log(`## 2. 立方体构建`);
  results.push(await buildSimple('趋势 CubeTrendDay', TREND_CUBE_TABLE, buildTrendCubeSql(hasBranchCode, policyDateIsTimestamp)));
  results.push(await buildSimple('业务员 CubeSalesmanDay', SALESMAN_CUBE_TABLE, buildSalesmanCubeSql(hasBranchCode, policyDateIsTimestamp)));

  // ── 3. 成本立方体（探针 → 三步 TEMP TABLE，OOM 捕获）───────────────────────────
  const costResult: CubeBuildResult = {
    table: COST_CUBE_TABLE, label: '成本 CubeCostDay',
    buildMinMs: null, buildMedianMs: null, rows: null, oom: false, error: null,
  };
  {
    const tp = performance.now();
    try {
      const [{ impure_policies }] = await q<{ impure_policies: number }>(buildCostCubeProbeSql(hasBranchCode));
      costResult.probeMs = performance.now() - tp;
      costResult.impurePolicies = num(impure_policies);
      costResult.exact = costResult.impurePolicies === 0;
    } catch (e) {
      const msg = errMsg(e);
      console.error(`  [构建错误] 成本探针: ${msg}`);
      costResult.probeMs = performance.now() - tp;
      if (isOomError(msg)) { costResult.oom = true; } else { costResult.error = msg; }
    }

    if (costResult.oom || costResult.error) {
      // 探针阶段已失败（OOM / 其他），跳过建表
    } else if (!costResult.exact) {
      console.log(`- ⚠️ 成本立方体探针发现 ${fmtInt(costResult.impurePolicies ?? 0)} 张跨格保单 → 本数据版本降级（不建表）`);
    } else {
      const [tempSql, mainSql, cleanupSql] = buildCostCubeSql(hasBranchCode);
      const samples: number[] = [];
      for (let i = 0; i < ITERS; i++) {
        try {
          const s = performance.now();
          await q(tempSql);
          if (i === 0) {
            const [{ n }] = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM __cost_policy_dedup`);
            costResult.dedupRows = num(n);
          }
          await q(mainSql);
          samples.push(performance.now() - s);
          await q(cleanupSql);
        } catch (e) {
          const msg = errMsg(e);
          console.error(`  [构建错误] 成本 CubeCostDay: ${msg}`);
          await q(`DROP TABLE IF EXISTS __cost_policy_dedup`).catch(() => {});
          if (isOomError(msg)) { costResult.oom = true; } else { costResult.error = msg; }
          break;
        }
      }
      if (samples.length > 0) {
        costResult.buildMinMs = Math.min(...samples);
        costResult.buildMedianMs = median(samples);
      }
      if (!costResult.oom && !costResult.error) {
        const [{ n }] = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${COST_CUBE_TABLE}`);
        costResult.rows = num(n);
        costResult.memBytes = await memNow();
        if (ISOLATE) await q(`DROP TABLE IF EXISTS ${COST_CUBE_TABLE}`).catch(() => {});
      }
    }
  }
  results.push(costResult);

  // 立方体常驻内存（取各成功表构建后占用的最大值；OOM 后 DuckDB 已释放，全局即时查询会失真，故用各表记账）
  const peakMemBytes = Math.max(0, ...results.map((r) => r.memBytes ?? 0));

  // ── 4. 报告 ──────────────────────────────────────────────────────────────────
  console.log(`\n模式：${ISOLATE ? '隔离（每张独立，测后即 DROP）' : '累积（三表常驻，复刻生产 reload 后内存形态）'}\n`);
  console.log(`| 立方体 | 构建耗时(min/中位) | 行数 | 压缩比 | 内存* | exact | 状态 |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const t = r.buildMinMs === null ? '—' : `${fmtMs(r.buildMinMs)} / ${fmtMs(r.buildMedianMs ?? r.buildMinMs)}`;
    const rows = r.rows === null ? '—' : fmtInt(r.rows);
    const ratio = r.rows && r.rows > 0 ? `${(num(policyRows) / r.rows).toFixed(1)}×` : '—';
    const mem = r.memBytes != null ? `${(r.memBytes / 1024 / 1024).toFixed(0)}MB` : '—';
    const exact = r.exact === undefined ? '—' : r.exact ? '✅ true' : '❌ false';
    const status = r.oom ? '🔴 OOM' : r.error ? '🔴 失败' : '🟢 成功';
    console.log(`| ${r.label} | ${t} | ${rows} | ${ratio} | ${mem} | ${exact} | ${status} |`);
  }
  console.log(`\n*内存 = 该表构建后 DuckDB 瞬时占用（${ISOLATE ? '隔离=单张需求' : '累积=含前序表'}），非峰值；上限 ${MAX_MEM}`);

  const totalBuildMs = results.reduce((acc, r) => acc + (r.buildMinMs ?? 0), 0) + (costResult.probeMs ?? 0);
  console.log(`\n## 3. 结论`);
  if (costResult.dedupRows) {
    console.log(`- 成本立方体去重后保单数：${fmtInt(costResult.dedupRows)}（内存主因，约 PolicyFact 的 ${(costResult.dedupRows / num(policyRows) * 100).toFixed(0)}%）`);
  }
  if (costResult.probeMs !== undefined) {
    console.log(`- 成本探针耗时：${fmtMs(costResult.probeMs)}（impure_policies=${fmtInt(costResult.impurePolicies ?? 0)}）`);
  }
  if (peakMemBytes > 0) {
    console.log(`- 成功立方体常驻内存（${ISOLATE ? '单张最大' : '累积峰值'}）：${(peakMemBytes / 1024 / 1024).toFixed(0)} MB / 上限 ${MAX_MEM}`);
  }
  console.log(`- 三立方体串行构建总耗时：${fmtMs(totalBuildMs)}（对照缓存预热器 30-60 秒，设计文档 §3.4 估 1.8 秒）`);

  // 退出判定
  let exitCode = 0;
  const blockers: string[] = [];
  if (costResult.oom) blockers.push('成本立方体 OOM');
  if (costResult.exact === false) blockers.push('成本立方体探针降级（跨格保单）');
  for (const r of results) if (r.error) blockers.push(`${r.label} 构建失败: ${r.error}`);
  if (blockers.length > 0) {
    exitCode = costResult.oom || costResult.exact === false ? 1 : 2;
    console.log(`\n🔴 切流前置 R2 未通过：${blockers.join('；')}`);
  } else {
    console.log(`\n🟢 切流前置 R2 通过：三立方体在 ${MAX_MEM} 下均构建成功，成本立方体 exact=true 无 OOM`);
  }

  // JSON 产物
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `cube-build-prod-probe-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { threads: THREADS, maxMemory: MAX_MEM, iters: ITERS, policyGlob: POLICY_GLOB, claimsGlob: CLAIMS_GLOB },
    data: { policyRows: num(policyRows), claimsAggRows: num(claimsAggRows), hasBranchCode, policyDateIsTimestamp },
    results,
    peakMemBytes,
    totalBuildMs,
    exitCode,
    blockers,
  }, null, 2));
  console.log(`\n产物：${path.relative(REPO_ROOT, outPath)}`);

  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n❌ 实测异常（原始错误对象）：`);
    console.error(err);
    process.exit(2);
  });
