/**
 * 准入闸门 — 本地 parquet 取数桥
 *
 * 设计原则：
 *   - 与 scripts/sentinel/lib/fetch-metrics.mjs 对称：sentinel 查 live API，闸门查刚 ETL 出的本地 parquet。
 *   - SQL 口径必须与 SSOT 一致：policy_dedup 按 (policy_no, CAST(insurance_start_date AS DATE)) 聚合
 *       + HAVING SUM(premium) > 0（cost-ratios.ts B252）；赔款金额锚定 ClaimsAgg.reported_claims SSOT
 *       （已结案取 settled、未结案取 reserve，剔除无责/零结/注销/拒赔——非二者相加，codex PR #513 P2）
 *   - **时间维度对齐生产 trend SSOT**（codex PR #513 第4轮 P2）：policy 月度 flow 指标按 `policy_date`
 *       月分组（与 `server/src/sql/trend/premium-trend.ts:31` 默认 `dateField='policy_date'`、sentinel
 *       `fetchTrend(perspective=premium|policy_count, granularity=monthly)` 路径一致），不再按
 *       `insurance_start_date`——否则 ETL 把 policy_date 写错而 insurance_start_date 正常时，闸门按
 *       起保月聚合可放行，但发布后 sentinel 按签单月会断崖告警。dedup key 仍按 B252 SSOT 保留
 *       (policy_no, insurance_start_date)，但 sign_date 从 dedup CTE 取 `COALESCE(ANY_VALUE(CASE
 *       WHEN premium>0 THEN policy_date END), ANY_VALUE(policy_date))`——按生产 policy-dedup
 *       ORIGINAL_PRIORITY_FIELDS 模式优先取原单（premium>0 行）的 policy_date，避免批改副本带偏。
 *       claims 仍按 `accident_time`（与 claims-heatmap cohort 一致；生产 ClaimsAgg 也按出险月分组）。
 *   - 读法「镜像生产」而非自定义（codex PR #513 第2/3轮）：闸门是发布前金丝雀，必须与生产加载器逐字一致，
 *       否则要么误阻断、要么把"生产会崩"的场景放行。生产读法本身不对称，照搬不可擅自统一：
 *       · policy → read_parquet(glob, union_by_name=true)，对齐 duckdb-parquet-loader.ts。
 *         policy/current 混有旧静态分片+新周更分片，按位置 union 会因 schema 漂移报错（缺它→误阻断）。
 *       · claims → 裸 read_parquet(glob)，对齐 duckdb-domain-loaders.ts（生产 claims 加载器无 union_by_name）。
 *         闸门若擅自加 union_by_name 会比生产更宽容→生产首次加载 ClaimsDetail/ClaimsAgg 仍崩而闸门已放行。
 *         （生产 claims 加载器缺 union_by_name 本身是潜伏 bug，已登记 BACKLOG B340 单独修；本闸门只做忠实镜像。）
 *       · claims glob 同样镜像 data-bootstrapper.ts：优先 claims_*.parquet 分区、回退 latest.parquet 单文件，
 *         不纳入生产不会服务的杂项 parquet（codex PR #513 第3轮 3b）。
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

  // claims glob 镜像生产 data-bootstrapper.ts：优先 claims_*.parquet 分区、回退 latest.parquet 单文件。
  // 不接受其它杂项 parquet——生产 lazy-load 不会服务它们，纳入会导致月赔款/件数判定与线上不一致。
  let claimsGlob = null;
  if (existsSync(claimsDir)) {
    const files = readdirSync(claimsDir).filter((f) => f.endsWith('.parquet'));
    const partitioned = files.filter((f) => f.startsWith('claims_'));
    if (partitioned.length > 0) {
      claimsGlob = join(claimsDir, 'claims_*.parquet');
    } else if (files.includes('latest.parquet')) {
      claimsGlob = join(claimsDir, 'latest.parquet');
    } else if (files.length > 0) {
      missing.push(`${claimsDir}（有 parquet 但无 claims_*.parquet 分区、也无 latest.parquet；生产加载器不会服务这些文件）`);
    } else {
      missing.push(`${claimsDir}/claims_*.parquet（目录存在但无 parquet 文件）`);
    }
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
  /**
   * 月签单保费：policy_dedup（B252 SSOT）后按 **policy_date 月** 聚合 SUM(premium)。
   * 时间维度对齐生产 trend SSOT（premium-trend.ts:31 默认 dateField='policy_date'），
   * 让闸门能抓到「policy_date ETL 写错而 insurance_start_date 正常」类型的漂移
   * （否则 sentinel post-publish 抓到时数据已上线）。codex PR #513 第4轮 P2。
   * sign_date 取 `COALESCE(ANY_VALUE(CASE WHEN premium>0 THEN policy_date END),
   * ANY_VALUE(policy_date))`，镜像生产 policy-dedup ORIGINAL_PRIORITY_FIELDS 模式
   * 优先原单 policy_date，避免批改副本另选月份带偏。
   */
  'policy_dedup.monthly_premium': ({ policyGlob, monthStart }) => `
    WITH policy_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS start_date,
        COALESCE(
          ANY_VALUE(CASE WHEN premium > 0 THEN CAST(policy_date AS DATE) END),
          CAST(ANY_VALUE(policy_date) AS DATE)
        ) AS sign_date,
        SUM(premium) AS premium
      FROM read_parquet('${policyGlob}', union_by_name=true)
      WHERE insurance_start_date IS NOT NULL
        AND ${COMPLETED_MONTH_FILTER('policy_date', monthStart)}
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    )
    SELECT
      strftime(sign_date, '%Y-%m') AS time_period,
      ROUND(SUM(premium), 2) AS value
    FROM policy_dedup
    GROUP BY time_period
    ORDER BY time_period
  `,
  /**
   * 月签单件数：policy_dedup 后按 **policy_date 月** COUNT DISTINCT policy_no。
   * 时间维度同 monthly_premium 对齐生产 trend SSOT（codex PR #513 第4轮 P2）。
   */
  'policy_dedup.monthly_policy_count': ({ policyGlob, monthStart }) => `
    WITH policy_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS start_date,
        COALESCE(
          ANY_VALUE(CASE WHEN premium > 0 THEN CAST(policy_date AS DATE) END),
          CAST(ANY_VALUE(policy_date) AS DATE)
        ) AS sign_date,
        SUM(premium) AS premium
      FROM read_parquet('${policyGlob}', union_by_name=true)
      WHERE insurance_start_date IS NOT NULL
        AND ${COMPLETED_MONTH_FILTER('policy_date', monthStart)}
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    )
    SELECT
      strftime(sign_date, '%Y-%m') AS time_period,
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
