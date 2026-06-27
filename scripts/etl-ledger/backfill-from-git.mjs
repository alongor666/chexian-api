/**
 * ETL 流转台账 — git 历史回填（一次性）。
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md §9
 *
 * 主力来源 = data-sources.json 的 git 提交历史（每次 ETL 同步 metadata 都留痕）。
 * 诚实边界：历史 row_count 取自快照参考值（手填，可能与当时真实 Parquet 有偏差）；
 * 粒度为「每次 metadata 提交」，非每次真实 ETL run；git 只留成功提交 → 历史段无失败记录。
 */
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_PATH } from './record.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REL = '数据管理/data-sources.json';

/**
 * 把一个 data-sources.json 快照解析成回填事件（仅含 row_count 的域）。
 * @param {object} obj 解析后的 data-sources.json
 * @param {{sha:string,date:string}} commitMeta 提交元数据
 */
export function parseSnapshotToEvents(obj, commitMeta) {
  const domains = obj?.domains ?? [];
  return domains
    .filter((d) => d && d.id && typeof d.row_count === 'number')
    .map((d) => ({
      ts: commitMeta.date,
      run_id: `backfill-${commitMeta.sha.slice(0, 8)}`,
      stage: 'etl',
      step: `${d.id}_snapshot`,
      domain: d.id,
      status: 'success',
      row_count: d.row_count,
      date_range: (d.data_range ?? '').replace(/\s*~\s*/, '~') || null,
      actor: 'backfill',
      backfilled: true,
      source_commit: commitMeta.sha.slice(0, 8),
    }));
}

/** 同域连续相同 row_count 只保留变化点（events 须按时间正序） */
export function dedupeByDomainChange(events) {
  const last = {};
  const out = [];
  for (const e of events) {
    if (last[e.domain] !== e.row_count) {
      out.push(e);
      last[e.domain] = e.row_count;
    }
  }
  return out;
}

function main() {
  if (
    existsSync(LEDGER_PATH) &&
    readFileSync(LEDGER_PATH, 'utf8').includes('"backfilled":true') &&
    !process.env.FORCE
  ) {
    console.log('[backfill] 台账已含回填事件，跳过（设 FORCE=1 强制重跑）。');
    return;
  }
  const log = execFileSync('git', ['-C', PROJECT_ROOT, 'log', '--reverse', '--format=%H\t%cI', '--', REL], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const all = [];
  for (const line of log) {
    const [sha, date] = line.split('\t');
    try {
      const obj = JSON.parse(execFileSync('git', ['-C', PROJECT_ROOT, 'show', `${sha}:${REL}`], { encoding: 'utf8' }));
      all.push(...parseSnapshotToEvents(obj, { sha, date }));
    } catch {
      // 早期提交可能无该文件或格式不同 → 跳过
    }
  }
  const deduped = dedupeByDomainChange(all);
  for (const ev of deduped) appendFileSync(LEDGER_PATH, JSON.stringify(ev) + '\n', 'utf8');
  console.log(`[backfill] 回填 ${deduped.length} 条事件（扫描 ${log.length} 次提交）→ ${LEDGER_PATH}`);
}

// 仅在直接运行时执行（被 import 测试时不触发）；realpathSync 两边归一化，兼容中文路径 + 相对调用
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
