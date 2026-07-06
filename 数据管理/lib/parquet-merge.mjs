/**
 * 「部分重叠」周更分片合并执行器（不重复不遗漏）
 *
 * 配合 range-coverage.mjs 的 findPartialOverlapPairs：检出「谁都不完全包含谁」的两份
 * 同品类 parquet 后，本模块负责真正做合并——本次刚转换出的文件（authoritative，上游
 * 最新一次拉取，权威性最高）全部采纳；另一份已存在的文件（other）只保留 authoritative
 * 覆盖不到的日期（早于/晚于 authoritative 区间的部分），避免假设"谁的起点更早"这类
 * 日期序关系（上游窗口既可能前移也可能后移，权威性只应该看"谁是本次刚拉取的"）。
 *
 * duckdb CLI 调用模式抄自 scripts/release/sx-promote.mjs 的 runDuckdbCli（spawn + 参数数组，
 * 不走 shell 字符串拼接，SQL 内嵌路径统一走 '' 转义单引号）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 执行 duckdb CLI SQL（-json 模式返回结果行数组；无输出时返回空数组）。
 * @param {string} sql
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export function runDuckdbCli(sql, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('duckdb', ['-json', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`duckdb 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`duckdb 启动失败：${err.message}（确认 duckdb 在 PATH，brew install duckdb）`));
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

const q = (p) => p.replace(/'/g, "''");

/** YYYYMMDD → YYYY-MM-DD（供 SQL 日期比较）。 */
function toIsoDate(compact) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

/**
 * 合并一对「部分重叠」的周更分片。authoritative（本次刚转换、上游最新）全部采纳；
 * other（已存在于 current/ 的旧文件）只保留 authoritative 覆盖不到的日期段。
 * 原两份文件归档到 archiveDir（不删除，保留可回滚证据），合并结果写到 mergedPath。
 *
 * @param {object} opts
 * @param {string} opts.authoritativePath 本次刚转换文件绝对路径（全部采纳）
 * @param {string} opts.authoritativeStart 该文件 range.start（YYYYMMDD）
 * @param {string} opts.authoritativeEnd 该文件 range.end（YYYYMMDD）
 * @param {string} opts.otherPath 已存在的旧文件绝对路径（只取其独占日期段）
 * @param {string} opts.mergedPath 合并输出路径（文件名应体现两份区间的并集）
 * @param {string} opts.archiveDir 原文件归档目录（会自动创建）
 * @param {string} [opts.dateColumn='policy_date'] 切分依据的日期列
 * @param {(sql:string, opts?:object)=>Promise<Array<object>>} [opts.runDuckdb] 注入式，便于单测
 * @param {boolean} [opts.dryRun=false] true 时仍跑真实 COPY 到临时文件校验行数（不重复不遗漏），
 *   但跳过归档/落地——不改动 otherPath/authoritativePath/mergedPath 任何一份真实文件
 * @returns {Promise<{mergedRows:number, otherKeptRows:number, authoritativeRows:number, dryRun:boolean}>}
 */
export async function mergeOverlappingWeeklyShard({
  authoritativePath, authoritativeStart, authoritativeEnd,
  otherPath, mergedPath, archiveDir,
  dateColumn = 'policy_date', runDuckdb = runDuckdbCli, dryRun = false,
}) {
  const startIso = toIsoDate(authoritativeStart);
  const endIso = toIsoDate(authoritativeEnd);
  const mergedTmp = `${mergedPath}.tmp-merge`;
  const otherKeptWhere = `${dateColumn} < '${startIso}' OR ${dateColumn} > '${endIso}'`;

  const countRows = async (sql) => {
    const rows = await runDuckdb(sql, { timeoutMs: 120_000 });
    return Number(rows[0]?.n ?? 0);
  };

  const otherKeptRows = await countRows(
    `SELECT COUNT(*) AS n FROM read_parquet('${q(otherPath)}') WHERE ${otherKeptWhere}`
  );
  const authoritativeRows = await countRows(
    `SELECT COUNT(*) AS n FROM read_parquet('${q(authoritativePath)}')`
  );

  await runDuckdb(
    `COPY (
       SELECT * FROM read_parquet('${q(otherPath)}') WHERE ${otherKeptWhere}
       UNION ALL BY NAME
       SELECT * FROM read_parquet('${q(authoritativePath)}')
     ) TO '${q(mergedTmp)}' (FORMAT PARQUET)`,
    { timeoutMs: 180_000 }
  );

  const mergedRows = await countRows(`SELECT COUNT(*) AS n FROM read_parquet('${q(mergedTmp)}')`);
  if (mergedRows !== otherKeptRows + authoritativeRows) {
    if (existsSync(mergedTmp)) unlinkSync(mergedTmp);
    throw new Error(
      `[parquet-merge] 合并后行数对不上（不重复不遗漏校验失败）：` +
      `旧文件保留 ${otherKeptRows} + 本次文件 ${authoritativeRows} = ${otherKeptRows + authoritativeRows}，实得 ${mergedRows}`
    );
  }

  if (dryRun) {
    // 仅校验、不落地：真实文件（other/authoritative/mergedPath）保持原样，清掉合并临时文件
    if (existsSync(mergedTmp)) unlinkSync(mergedTmp);
    return { mergedRows, otherKeptRows, authoritativeRows, dryRun: true };
  }

  mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (existsSync(otherPath)) {
    renameSync(otherPath, join(archiveDir, `${otherPath.split('/').pop().replace('.parquet', '')}_${stamp}.parquet`));
  }
  if (existsSync(authoritativePath) && authoritativePath !== mergedPath) {
    renameSync(authoritativePath, join(archiveDir, `${authoritativePath.split('/').pop().replace('.parquet', '')}_${stamp}.parquet`));
  }
  renameSync(mergedTmp, mergedPath);

  return { mergedRows, otherKeptRows, authoritativeRows, dryRun: false };
}
