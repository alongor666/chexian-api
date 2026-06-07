/**
 * 准入闸门 — 本地 parquet 取数桥
 *
 * 设计原则：
 *   - 与 scripts/sentinel/lib/fetch-metrics.mjs 对称：sentinel 查 live API，闸门查刚 ETL 出的本地 parquet。
 *   - SQL 口径必须与 server/src/sql/cost/cost-ratios.ts 等 SSOT 一致：
 *       policy_dedup 按 (policy_no, CAST(insurance_start_date AS DATE)) 聚合 + HAVING SUM(premium) > 0
 *       赔款分子 = settled_amount + reserve_amount（已决 + 未决，项目标准口径）
 *   - 率值不在此层计算（gate 直接 Z-score 分子/分母独立序列即可，满足铁律 SUM(分子)/SUM(分母)
 *     而非二次平均；详见 .claude/rules/business-domain.md）
 *   - DuckDB CLI 子进程，避免引入原生模块依赖（@duckdb/node-api 安装失败时闸门仍可用）
 *
 * 纯函数 + 注入式 runDuckDB，便于单测（mock CLI 子进程）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 子进程执行 duckdb -c "<sql>"，返回 stdout（JSON 模式） */
export function runDuckDBDefault({ duckdbBin = 'duckdb', sql, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(duckdbBin, ['-json', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`duckdb 超时（${timeoutMs}ms）：${sql.slice(0, 200)}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`duckdb 启动失败：${err.message}（确认 ${duckdbBin} 在 PATH）`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`duckdb 退出码 ${code}\nstderr: ${stderr.trim()}\nsql: ${sql.slice(0, 400)}`));
      }
      try {
        const trimmed = stdout.trim();
        resolve(trimmed.length === 0 ? [] : JSON.parse(trimmed));
      } catch (e) {
        reject(new Error(`duckdb 输出非 JSON：${e.message}\nstdout 前 400: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

/**
 * 校验本地 parquet 目录是否就绪。
 * @returns {{ ready: boolean, policyGlob: string|null, claimsGlob: string|null, missing: string[] }}
 */
export function inspectWarehouse(warehouseRoot) {
  const missing = [];
  const policyDir = join(warehouseRoot, 'fact/policy/current');
  const claimsDir = join(warehouseRoot, 'fact/claims_detail');

  let policyGlob = null;
  if (existsSync(policyDir)) {
    const files = readdirSync(policyDir).filter((f) => f.endsWith('.parquet'));
    if (files.length > 0) policyGlob = join(policyDir, '*.parquet');
    else missing.push(`${policyDir}/*.parquet（目录存在但无 parquet 文件）`);
  } else {
    missing.push(`${policyDir}（目录不存在）`);
  }

  let claimsGlob = null;
  if (existsSync(claimsDir)) {
    const files = readdirSync(claimsDir).filter((f) => f.endsWith('.parquet'));
    if (files.length > 0) claimsGlob = join(claimsDir, '*.parquet');
    else missing.push(`${claimsDir}/*.parquet（目录存在但无 parquet 文件）`);
  } else {
    missing.push(`${claimsDir}（目录不存在）`);
  }

  return { ready: missing.length === 0, policyGlob, claimsGlob, missing };
}

/**
 * 时间窗约束：只看「已完整结束的月份」。
 *   - insurance_start_date 可远超业务当月（预签保单），不过滤会把未来月当成断崖触发。
 *   - 用 `< DATE '<业务月首日>'` 把当前不完整月也剔除，stats 的 excludeRecent
 *     再把上一个月（可能仍有迟到 ETL）排掉，得到稳定基线。
 *   - monthStart 由编排器按中国业务时区（Asia/Shanghai）注入，与发布机自身时区解耦：
 *     若退回 DuckDB `current_date`，UTC 机器在月初会退到上月，整月完整数据被误排除（codex PR #513 P2）。
 *   - 未注入时回退 `current_date`（向后兼容直接调用 / 单测）。
 */
const COMPLETED_MONTH_FILTER = (col, monthStart) => {
  if (monthStart && !/^\d{4}-\d{2}-\d{2}$/.test(monthStart)) {
    throw new Error(`monthStart 格式非法（须 YYYY-MM-DD）：${monthStart}`);
  }
  const bound = monthStart ? `DATE '${monthStart}'` : `date_trunc('month', current_date)`;
  return `${col} IS NOT NULL AND ${col} < ${bound}`;
};

/** SQL 模板表 — key = config.metric.source，value = (globPaths) => sql */
export const SQL_TEMPLATES = {
  /** 月签单保费：policy_dedup 后按月聚合 SUM(premium)。口径 = cost-ratios.ts B252 */
  'policy_dedup.monthly_premium': ({ policyGlob, monthStart }) => `
    WITH policy_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS start_date,
        SUM(premium) AS premium
      FROM read_parquet('${policyGlob}')
      WHERE ${COMPLETED_MONTH_FILTER('insurance_start_date', monthStart)}
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    )
    SELECT
      strftime(start_date, '%Y-%m') AS time_period,
      ROUND(SUM(premium), 2) AS value
    FROM policy_dedup
    GROUP BY time_period
    ORDER BY time_period
  `,
  /** 月签单件数：policy_dedup 后按月 COUNT DISTINCT policy_no */
  'policy_dedup.monthly_policy_count': ({ policyGlob, monthStart }) => `
    WITH policy_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS start_date,
        SUM(premium) AS premium
      FROM read_parquet('${policyGlob}')
      WHERE ${COMPLETED_MONTH_FILTER('insurance_start_date', monthStart)}
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    )
    SELECT
      strftime(start_date, '%Y-%m') AS time_period,
      COUNT(DISTINCT policy_no) AS value
    FROM policy_dedup
    GROUP BY time_period
    ORDER BY time_period
  `,
  /**
   * 月出险报告金额：口径锚定 ClaimsAgg.reported_claims SSOT
   * （server/src/services/duckdb-domain-loaders.ts）——每案已结案(settlement_time 非空)取
   * settled_amount、未结案取 reserve_amount（**非二者相加**，避免已结案残留 reserve 双计），
   * 并剔除无责(liability_ratio=0)/零结/注销/拒赔案件。与成本率口径一致，防误阻断/漏判漂移（codex PR #513 P2）。
   */
  'claims_detail.monthly_claim_amount': ({ claimsGlob, monthStart }) => `
    SELECT
      strftime(accident_time, '%Y-%m') AS time_period,
      ROUND(SUM(CASE
        WHEN COALESCE(liability_ratio, 100) > 0
         AND (case_type IS NULL OR case_type NOT IN ('零结','注销','拒赔'))
        THEN (CASE WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                   ELSE COALESCE(reserve_amount, 0) END)
        ELSE 0
      END), 2) AS value
    FROM read_parquet('${claimsGlob}')
    WHERE ${COMPLETED_MONTH_FILTER('accident_time', monthStart)}
    GROUP BY time_period
    ORDER BY time_period
  `,
  /** 月出险报案件数：COUNT DISTINCT claim_no by accident_time month（与 ClaimsAgg.claim_cases 一致，不过滤） */
  'claims_detail.monthly_claim_count': ({ claimsGlob, monthStart }) => `
    SELECT
      strftime(accident_time, '%Y-%m') AS time_period,
      COUNT(DISTINCT claim_no) AS value
    FROM read_parquet('${claimsGlob}')
    WHERE ${COMPLETED_MONTH_FILTER('accident_time', monthStart)}
    GROUP BY time_period
    ORDER BY time_period
  `,
};

/**
 * 取单个指标的逐期序列。
 *
 * @param {object} ctx - { policyGlob, claimsGlob, duckdbBin }
 * @param {string} source - config.metric.source（必须命中 SQL_TEMPLATES）
 * @param {(opts: {duckdbBin: string, sql: string}) => Promise<Array>} [runDuckDB] - 注入式，便于单测
 * @returns {Promise<Array<{time_period: string, value: number}>>}
 */
export async function fetchLocalSeries(ctx, source, runDuckDB = runDuckDBDefault) {
  const template = SQL_TEMPLATES[source];
  if (!template) {
    throw new Error(`未知 metric source：${source}（合法：${Object.keys(SQL_TEMPLATES).join(', ')}）`);
  }
  const sql = template(ctx).trim();
  const rows = await runDuckDB({ duckdbBin: ctx.duckdbBin, sql });
  return rows
    .filter((r) => r && r.time_period && r.value != null)
    .map((r) => ({ time_period: String(r.time_period), value: Number(r.value) }))
    .filter((r) => Number.isFinite(r.value));
}
