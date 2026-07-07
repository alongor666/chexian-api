#!/usr/bin/env node
/**
 * 发布后验证脚本：比对本地 parquet 实读值与 data-sources.json + data-sources-status.json
 * （和可选 manifest）声明值。
 *
 * 基线来源（零手工输入，B314 契约/状态拆分后）：
 *   1. `数据管理/data-sources.json`：契约（output 路径等入库元数据，不含 row_count/data_range）
 *   2. `数据管理/data-sources-status.json`：运行时状态（row_count/data_range，ETL 自动生成，
 *      gitignored；首跑 ETL 前可能不存在或缺该域记录）
 *      两者按 `mergeDomainStatus` 合并（状态覆盖契约同名字段）作为期望值来源
 *   3. 可选 `--manifest <path>`：manifest 的 expected_max_date / expected_min_date / report_end
 *      优先覆盖合并视图的日期期望（用于新发布演练）
 *
 * 检查规则：
 *   - row_count：parquet 实读 >= 合并视图声明（允许增长，不允许缩减）
 *   - max_date：声明了 data_range 或 manifest 期望时必须一致
 *   - 合并视图既无 row_count 也无 data_range（活跃域但状态文件缺基线）：打印警告，
 *     仍执行 parquet 可读性探测与 manifest 期望比对，不计入失败
 *
 * 用法:
 *   node scripts/verify-data-release.mjs                                 # 默认基线
 *   node scripts/verify-data-release.mjs --manifest 数据管理/release-manifests/2026-04-19.json
 *   node scripts/verify-data-release.mjs --domain premium                # 仅验 1 域
 *
 * 退出码：任一域验证失败 → 1；全部通过 → 0
 */

import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// 中文相对路径在 ESM **静态** import 下是安全的（项目坑仅在动态 import 中文路径，见项目记忆）
import { readStatusDomains, mergeDomainStatus } from '../数据管理/lib/data-sources-status.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DATA_SOURCES_PATH = join(PROJECT_ROOT, '数据管理/data-sources.json');
const DATA_SOURCES_STATUS_PATH = join(PROJECT_ROOT, '数据管理/data-sources-status.json');

const PARQUET_DATE_COLUMN = {
  premium: 'policy_date',
  claims_detail: 'report_time',
  customer_flow: 'insurance_start_date',
  cross_sell: 'policy_date',
  quotes_conversion: 'signing_date',
};

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { manifest: null, domain: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--manifest': parsed.manifest = argv[++i]; break;
      case '--domain': parsed.domain = argv[++i]; break;
      case '-h': case '--help': {
        console.log(`Usage: verify-data-release.mjs [--manifest <path>] [--domain <id>]`);
        process.exit(0);
      }
      default: throw new Error(`未知参数: ${token}`);
    }
  }
  return parsed;
}

function loadManifestExpectations(manifestPath) {
  if (!manifestPath) return {};
  const abs = manifestPath.startsWith('/') ? manifestPath : join(PROJECT_ROOT, manifestPath);
  const m = JSON.parse(readFileSync(abs, 'utf-8'));
  const exp = {};
  for (const [id, spec] of Object.entries(m.domains || {})) {
    exp[id] = {
      max_date: spec.expected_max_date || spec.report_end || null,
      min_date: spec.expected_min_date || spec.report_start || null,
    };
  }
  return exp;
}

function queryParquet(parquetGlob, dateColumn) {
  const escaped = parquetGlob.replace(/'/g, "''");
  const union = parquetGlob.includes('*') ? ', union_by_name=true' : '';
  const selectDate = dateColumn
    ? `, MAX(CAST(${dateColumn} AS DATE)) AS max_date, MIN(CAST(${dateColumn} AS DATE)) AS min_date`
    : '';
  const code = `
import duckdb, json, sys
try:
    r = duckdb.sql("SELECT COUNT(*) AS rows${selectDate} FROM read_parquet('${escaped}'${union})").fetchone()
    print(json.dumps({"rows": int(r[0]), "max_date": str(r[1]) if len(r) > 1 else None, "min_date": str(r[2]) if len(r) > 2 else None}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;
  const result = spawnSync('python3', ['-c', code], { encoding: 'utf-8' });
  if (result.status !== 0) {
    return { error: (result.stderr || result.stdout || '').trim() || `exit ${result.status}` };
  }
  return JSON.parse(result.stdout.trim());
}

function main() {
  const args = parseArgs();
  if (!existsSync(DATA_SOURCES_PATH)) {
    console.error(`data-sources.json 不存在: ${DATA_SOURCES_PATH}`);
    process.exit(1);
  }

  const cfg = JSON.parse(readFileSync(DATA_SOURCES_PATH, 'utf-8'));
  const statusDomains = readStatusDomains(DATA_SOURCES_STATUS_PATH);
  const manifestExp = loadManifestExpectations(args.manifest);

  let failed = 0;
  let checked = 0;
  console.log(`▶ 发布验证（basin: data-sources.json + data-sources-status.json${args.manifest ? ` + manifest` : ''}）\n`);

  for (const domain of cfg.domains) {
    if (args.domain && domain.id !== args.domain) continue;
    if (!domain.output) continue;
    checked++;

    const merged = mergeDomainStatus(domain, statusDomains[domain.id]);

    const parquetGlob = join(PROJECT_ROOT, '数据管理', domain.output).replace(/\\/g, '/');
    const dateColumn = PARQUET_DATE_COLUMN[domain.id] || null;
    const probe = queryParquet(parquetGlob, dateColumn);

    if (probe.error) {
      console.log(`  ✗ ${domain.id.padEnd(22)} parquet 读取失败: ${probe.error}`);
      failed++;
      continue;
    }

    if (merged.row_count == null && merged.data_range == null) {
      console.log(`  ⚠ ${domain.id.padEnd(22)} 无状态基线（data-sources-status.json 缺该域），跳过 row_count/data_range 期望比对`);
    }

    const errors = [];
    if (typeof merged.row_count === 'number' && probe.rows < merged.row_count) {
      errors.push(`row_count ${probe.rows} < 声明 ${merged.row_count}`);
    }

    const expectedMax = manifestExp[domain.id]?.max_date
      || (merged.data_range && merged.data_range !== '-' ? merged.data_range.split('~').pop().trim() : null);
    if (expectedMax && probe.max_date && probe.max_date !== expectedMax) {
      errors.push(`max_date ${probe.max_date} ≠ 期望 ${expectedMax}`);
    }

    if (errors.length === 0) {
      const dateInfo = probe.max_date ? ` max_date=${probe.max_date}` : '';
      console.log(`  ✓ ${domain.id.padEnd(22)} rows=${probe.rows.toLocaleString()}${dateInfo}`);
    } else {
      console.log(`  ✗ ${domain.id.padEnd(22)} ${errors.join('; ')}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (failed === 0) {
    console.log(`✅ ${checked} 个域全部通过`);
    process.exit(0);
  }
  console.log(`❌ ${failed}/${checked} 个域验证失败`);
  process.exit(1);
}

main();
