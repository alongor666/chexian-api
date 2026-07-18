#!/usr/bin/env node
/**
 * 上游 BI 导出拉取：VPS auto_loadbi/exports → 本地 inbox → 校验 → 分发 ETL 源目录
 *
 * 上游源头（替代 iCloud 手动下载链路）：
 *   VPS（ssh 别名 myvps）/root/workspace/auto_loadbi/exports/ 每天定时导出五张 xlsx，
 *   唯一稳定契约 = 目录内 latest-manifest.json（按 code 取当前份，文件名日期后缀每天变，
 *   禁止硬编文件名）。详见随目录同步落地的 inbox/README-for-etl.md。
 *
 * 流程（严格顺序，任一步失败 exit 1）：
 *   1. rsync -az --delete <alias>:<remote>/ 数据管理/inbox/       （镜像整目录，含 manifest + README）
 *   2. 校验 manifest：5 code 齐全 / 本地字节数=manifest / mtime=北京时间今天 / sizeMB 兜空表
 *      ⚠️ 本机时钟不一定在北京时区，新鲜度一律换算 Asia/Shanghai 再比（lib/bi-export-pull.mjs）
 *   3. 省份内容核验：抽样 01 签单保单号前缀 → fields.json branch_code.derivation.mapping 派生，
 *      与文件名省前缀声明比对。文件名 shanxi_/sichuan_ 前缀是导出配置标签（不自动跟登录账号），
 *      换账号没改配置会出现「四川数据、shanxi 前缀」错配 → 必须内容核验后才分发（fail-closed）
 *   4. 分发：按前缀路由省份（shanxi_→staging/SX、sichuan_/无前缀→数据管理/ 根；04 厂牌全国口径
 *      归根目录），落盘前做区间覆盖归档（旧短窗 xlsx → .xlsx-archive/<日期>/，防 merge 域堆积）
 *
 * 出表时机（上游 README，2026-07-18 起双批）：北京时间约 07:35 出早批 01 签单 + 05 理赔；
 * 约 11:50 出晚批 02 报价 + 03 维修（+ 04 厂牌，每周日更新）。按批拉取（--batch）时只校验本批
 * code，过早拉会因该批新鲜度校验失败而中止（符合"断线告警"契约）。不带 --batch = 全量拉取
 *（要求全部 code 今天新鲜，适合 12:00 后手动补一次全量）。
 *
 * 用法：
 *   node scripts/pull-bi-exports.mjs                        # 全量流程（不分批，要求 5 张全新鲜）
 *   node scripts/pull-bi-exports.mjs --batch early          # 只拉/校验 01 签单 + 05 理赔
 *   node scripts/pull-bi-exports.mjs --batch late           # 只拉/校验 02 报价 + 03 维修 + 04 厂牌
 *   node scripts/pull-bi-exports.mjs --dry-run              # rsync -n + 只打印校验与分发计划
 *   node scripts/pull-bi-exports.mjs --skip-rsync           # 跳过拉取，用现有 inbox 校验+分发
 *   node scripts/pull-bi-exports.mjs --skip-verify-province # 跳过省份内容核验（应急，红字告警）
 *   node scripts/pull-bi-exports.mjs --allow-stale 02       # 显式豁免指定 code 的"mtime 非今天"闸（应急：
 *                                                             上游当天没导但旧份有效仍要发布；仅豁免新鲜度）
 *   node scripts/pull-bi-exports.mjs --force                # 校验 error 降级为告警继续分发（应急）
 *
 * 分层校验语义（2026-07-05）：
 *   - 硬闸 code（01/02/03/05）：任一异常 → 中止（HARD_REQUIRED_CODES）
 *   - 可选 code（04 厂牌，低频维表）：异常 → 告警 + 跳过分发该文件（本地保留旧维表），不阻塞
 *   - 契约外补导文件：manifest 之外、符合报表命名模式的 xlsx（上游补历史窗口）一并分发（[4b] 段）
 *
 * 环境变量：
 *   PULL_BI_SSH_ALIAS   （默认 myvps）
 *   PULL_BI_REMOTE_DIR  （默认 /root/workspace/auto_loadbi/exports/）
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync,
  copyFileSync, renameSync, unlinkSync, utimesSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { branchSourceDir } from '../数据管理/lib/branch-naming.mjs';
import {
  REQUIRED_REPORT_CODES,
  OPTIONAL_REPORT_CODES,
  beijingDayOf,
  evaluateManifestReports,
  routeBranchCode,
  derivePolicyProvince,
  planCoverageArchive,
  planBackfillFiles,
} from '../数据管理/lib/bi-export-pull.mjs';
import { getReleaseBatch, batchAllCodes, RELEASE_BATCH_IDS } from '../数据管理/lib/release-batches.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '../..');
const DATA_DIR = join(PROJECT_ROOT, '数据管理');
const INBOX_DIR = join(DATA_DIR, 'inbox');
const MANIFEST_NAME = 'latest-manifest.json';
const FIELDS_JSON = join(PROJECT_ROOT, 'server/src/config/field-registry/fields.json');
const PROVINCE_SAMPLE_ROWS = 500;

const COLORS = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
function log(color, msg) { process.stdout.write(`${COLORS[color] || ''}${msg}${COLORS.reset}\n`); }

function parseArgs(argv) {
  // requiredCodes/optionalCodes 默认全集 → 无 --batch 时与拆批前逐字节一致（全量单批拉取）。
  const opts = {
    dryRun: false, skipRsync: false, skipVerifyProvince: false, force: false, allowStaleCodes: [],
    batch: null, requiredCodes: REQUIRED_REPORT_CODES, optionalCodes: OPTIONAL_REPORT_CODES,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-rsync') opts.skipRsync = true;
    else if (a === '--skip-verify-province') opts.skipVerifyProvince = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--batch' || a.startsWith('--batch=')) {
      // 双批发布：只校验/分发该批的 code 子集（早批 01/05、晚批 02/03/04）。
      // 不在子集内的 code 完全不参与校验、分发、补导（各批互不干扰）。
      const id = a.includes('=') ? a.slice('--batch='.length) : argv[++i];
      let batch;
      try { batch = getReleaseBatch(id); } catch (e) { log('red', e.message); process.exit(1); }
      opts.batch = batch.id;
      opts.requiredCodes = batchAllCodes(batch);
      opts.optionalCodes = batch.optionalCodes;
    }
    else if (a === '--allow-stale' || a.startsWith('--allow-stale=')) {
      // 显式豁免指定 code 的「mtime 非今天」硬闸（应急：上游某表当天没导但旧份数据有效仍要发布）。
      // 只豁免新鲜度——字节不一致 / 体积骤降不受影响；watcher 自动路径不透传本参数，断线闸长期不松。
      const raw = a.includes('=') ? a.slice('--allow-stale='.length) : argv[++i];
      const codes = (raw || '').split(',').map((c) => c.trim()).filter(Boolean);
      const bad = codes.filter((c) => !REQUIRED_REPORT_CODES.includes(c));
      if (codes.length === 0 || bad.length > 0) {
        log('red', `--allow-stale 参数非法：${raw ?? '(空)'}（须逗号分隔 code，合法值 ${REQUIRED_REPORT_CODES.join('/')}）`);
        process.exit(1);
      }
      opts.allowStaleCodes.push(...codes);
    }
    else if (a === '--help' || a === '-h') {
      log('cyan', `用法：node scripts/pull-bi-exports.mjs [--batch ${RELEASE_BATCH_IDS.join('|')}] [--dry-run] [--skip-rsync] [--skip-verify-province] [--allow-stale 02[,05]] [--force]`);
      log('cyan', '  --batch early：只拉/校验 01 签单 + 05 理赔；--batch late：只拉 02 报价 + 03 维修 + 04 厂牌；不带 --batch=全量');
      process.exit(0);
    } else {
      log('red', `未知参数：${a}（--help 查看用法）`);
      process.exit(1);
    }
  }
  return opts;
}

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe' });
    if (r.status === 0) return cmd;
  }
  return null;
}

function beijingNowHHMM() {
  return new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
}

// ── Step 1: rsync 镜像 ──

function runRsync({ dryRun }) {
  const alias = process.env.PULL_BI_SSH_ALIAS || 'myvps';
  const remoteDir = process.env.PULL_BI_REMOTE_DIR || '/root/workspace/auto_loadbi/exports/';
  const remote = `${alias}:${remoteDir.endsWith('/') ? remoteDir : remoteDir + '/'}`;
  mkdirSync(INBOX_DIR, { recursive: true });
  const args = ['-az', '--delete', ...(dryRun ? ['-n', '-v'] : []), remote, `${INBOX_DIR}/`];
  log('cyan', `\n▶ [1/4] rsync 上游导出 → inbox\n  rsync ${args.join(' ')}`);
  const r = spawnSync('rsync', args, { stdio: 'inherit' });
  if (r.status !== 0) {
    log('red', `❌ rsync 失败（exit=${r.status ?? r.error?.message}）——上游断线兜底：禁止默默用旧数据。`);
    log('yellow', `   排查：ssh ${alias} 'ls ${remoteDir}'；确认 VPS 在线与导出目录存在。`);
    process.exit(1);
  }
  log('green', '  ✓ rsync 完成');
}

// ── Step 2: manifest 校验 ──

function loadManifestAndValidate({ force, allowStaleCodes, requiredCodes, optionalCodes, batch }) {
  const manifestPath = join(INBOX_DIR, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    log('red', `❌ inbox 缺 ${MANIFEST_NAME}（${manifestPath}）——上游断线或从未拉取。`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    log('red', `❌ ${MANIFEST_NAME} 解析失败：${e.message}`);
    process.exit(1);
  }

  const statByName = {};
  for (const r of manifest.reports || []) {
    if (!r?.file) continue;
    const p = join(INBOX_DIR, r.file);
    statByName[r.file] = existsSync(p) ? { size: statSync(p).size } : null;
  }

  const todayBeijing = beijingDayOf(new Date());
  const result = evaluateManifestReports(manifest, { todayBeijing, statByName, allowStaleCodes, requiredCodes, optionalCodes });

  log('cyan', `\n▶ [2/4] manifest 校验（北京时间今天 = ${todayBeijing}${batch ? ` · 批次 ${batch}：code ${requiredCodes.join('/')}` : ''}）`);
  for (const r of result.reports) {
    const tag = r.province ? `[${r.province}] ` : '';
    log('green', `  ✓ code ${r.code} ${tag}${r.reportName} | ${r.sizeMB}MB | mtime北京 ${beijingDayOf(r.mtime)}`);
  }
  for (const issue of result.issues) {
    log(issue.level === 'error' ? 'red' : 'yellow', `  ${issue.level === 'error' ? '❌' : '⚠'} ${issue.message}`);
  }
  if (!result.ok) {
    const now = beijingNowHHMM();
    // 双批出表节奏（2026-07-18 起）：早批 01 签单 + 05 理赔约 07:35 就绪；晚批 02 报价 + 03 维修
    //（+ 04 厂牌，周日更新）约 11:50 就绪。提前拉会因新鲜度校验拦下（符合断线告警契约）。
    if (now < '07:40') {
      log('yellow', `  ℹ 当前北京时间 ${now}：早批（01/05）约 07:35 就绪、晚批（02/03/04）约 11:50 就绪，过早拉取会被新鲜度校验拦下。`);
    } else if (now < '11:50' && (requiredCodes.includes('02') || requiredCodes.includes('03'))) {
      log('yellow', `  ℹ 当前北京时间 ${now}：晚批（02 报价 / 03 维修）约 11:50 才两省就绪，此刻拉取晚批多半未出表。`);
    }
    if (force) {
      log('yellow', '  ⚠ --force：校验 error 降级为告警，继续分发（应急通道，事后必须人工核对数据日期）');
    } else {
      log('red', '❌ manifest 校验未通过，中止（--force 可应急放行，但禁止常态使用）');
      process.exit(1);
    }
  }
  return { result, manifest };
}

// ── Step 3: 省份内容核验（fail-closed）──

function loadBranchDerivation() {
  const fields = JSON.parse(readFileSync(FIELDS_JSON, 'utf-8')).fields;
  const branchField = fields.find((f) => f.id === 'branch_code');
  const derivation = branchField?.derivation;
  if (!derivation?.mapping || !derivation?.prefixLength) {
    throw new Error(`fields.json branch_code.derivation 结构非预期（${FIELDS_JSON}）`);
  }
  const policySourceColumn = fields.find((f) => f.id === 'policy_no')?.sourceColumn || '保单号';
  return { ...derivation, policySourceColumn };
}

function samplePolicyNos(python, xlsxPath, sourceColumn, nrows) {
  // ⚠️ BI 导出 xlsx 的 dimension 元数据是坏的（openpyxl read_only 读到 max_row=1），
  // 抽样必须走 pandas（read_excel 逐行解析不信 dimension）。
  const script = [
    'import json, sys, warnings',
    'warnings.filterwarnings("ignore")',
    'import pandas as pd',
    'path, col, nrows = sys.argv[1], sys.argv[2], int(sys.argv[3])',
    'df = pd.read_excel(path, sheet_name=0, usecols=[col], nrows=nrows)',
    'print(json.dumps([str(v) for v in df[col].dropna().tolist()], ensure_ascii=False))',
  ].join('\n');
  const r = spawnSync(python, ['-', xlsxPath, sourceColumn, String(nrows)], {
    input: script, encoding: 'utf-8', timeout: 5 * 60 * 1000,
  });
  if (r.status !== 0) {
    throw new Error(`保单号抽样失败：${(r.stderr || '').trim().split('\n').pop() || `exit=${r.status}`}`);
  }
  return JSON.parse(r.stdout.trim());
}

function verifyProvince(reports, { skipVerifyProvince }) {
  log('cyan', '\n▶ [3/4] 省份内容核验（文件名前缀是配置标签，不可当权威省份判据）');
  // 分省上线后 01 签单表每省一条当前份（见 bi-export-pull.mjs 的 .filter() 修复说明），
  // 必须逐条核验 —— 只核验第一条会让另一省的省份错配（如换账号没改 PROVINCE 配置）溜过去。
  const signings = reports.filter((r) => r.code === '01');
  if (signings.length === 0) {
    log('yellow', '  ⚠ 本批无 01 签单表，跳过省份内容核验');
    return;
  }
  const fail = (msg) => {
    if (skipVerifyProvince) {
      log('red', `  ⚠ ${msg}`);
      log('red', '  ⚠ --skip-verify-province：跳过省份核验强行继续 —— 分发目标省完全依赖文件名前缀，错配风险自负！');
      return;
    }
    log('red', `  ❌ ${msg}`);
    log('yellow', '     应急绕过：--skip-verify-province（须人工确认上游导出账号与 PROVINCE 配置一致）');
    process.exit(1);
  };

  const python = findPython();
  if (!python) return fail('未找到 Python（省份核验需要 pandas 抽样保单号）');
  let derivation;
  try {
    derivation = loadBranchDerivation();
  } catch (e) {
    return fail(e.message);
  }

  for (const signing of signings) {
    const declaredCode = routeBranchCode(signing.file);
    let samples;
    try {
      samples = samplePolicyNos(python, join(INBOX_DIR, signing.file), derivation.policySourceColumn, PROVINCE_SAMPLE_ROWS);
    } catch (e) {
      fail(e.message);
      continue;
    }
    const verdict = derivePolicyProvince(samples, derivation.mapping, derivation.prefixLength);
    if (!verdict.consistent) {
      fail(
        `01 签单保单号省份不一致：已注册省 ${JSON.stringify(verdict.counts)}，未知前缀 ${JSON.stringify(verdict.unknownPrefixes)}（抽样 ${verdict.sampled} 行，文件 ${signing.file}）`
      );
      continue;
    }
    if (verdict.code !== declaredCode) {
      fail(
        `省份错配：文件名前缀声明 ${declaredCode}，但保单号内容实测 ${verdict.code}（抽样 ${verdict.sampled} 行全部一致，文件 ${signing.file}）。` +
        '典型根因 = 上游换登录账号但没改导出脚本 PROVINCE 常量，须先修上游再拉。'
      );
      continue;
    }
    log('green', `  ✓ 内容实测 ${verdict.code}（抽样 ${verdict.sampled} 行保单号一致）= 文件名声明 ${declaredCode}（${signing.file}）`);
  }
}

// ── Step 4: 分发到 ETL 源目录 ──

function todayCompact() {
  return beijingDayOf(new Date()).replace(/-/g, '');
}

/**
 * 分发单个文件到 ETL 源目录：省份路由 → 同品类覆盖归档 → 幂等原子落盘（保留 mtime）。
 * manifest 当前份与契约外补导文件共用同一条路径，行为完全一致。
 * @returns {string} action 描述
 */
function distributeOne(fileName, label, { dryRun }) {
  const branch = routeBranchCode(fileName);
  const targetDir = branchSourceDir(DATA_DIR, branch);
  const targetPath = join(targetDir, fileName);
  const srcPath = join(INBOX_DIR, fileName);
  if (!dryRun) mkdirSync(targetDir, { recursive: true });

  const existing = existsSync(targetDir)
    ? readdirSync(targetDir).filter((n) => /\.xlsx$/i.test(n))
    : [];
  const plan = planCoverageArchive(fileName, existing);

  for (const name of plan.archive) {
    const archiveDir = join(targetDir, '.xlsx-archive', todayCompact());
    if (dryRun) {
      log('yellow', `  [plan] 归档被覆盖旧文件：${name} → .xlsx-archive/${todayCompact()}/`);
    } else {
      mkdirSync(archiveDir, { recursive: true });
      renameSync(join(targetDir, name), join(archiveDir, name));
      log('yellow', `  📦 归档被覆盖旧文件：${name} → .xlsx-archive/${todayCompact()}/`);
    }
  }

  let action;
  if (plan.incomingRedundant) {
    action = '跳过（目录已有同区间同品类文件）';
  } else if (existsSync(targetPath)) {
    const src = statSync(srcPath);
    const dst = statSync(targetPath);
    action = dst.size === src.size && Math.abs(dst.mtimeMs - src.mtimeMs) < 2000
      ? '已是最新，跳过'
      : '更新';
  } else {
    action = '新增';
  }

  if ((action === '新增' || action === '更新') && !dryRun) {
    const tmp = `${targetPath}.tmp-pull`;
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
      copyFileSync(srcPath, tmp);
      const src = statSync(srcPath);
      utimesSync(tmp, src.atime, src.mtime); // 保留 mtime：daily.mjs 缓存判定 / 取最新依赖它
      renameSync(tmp, targetPath);
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* 清理尽力而为 */ }
      log('red', `  ❌ ${label} 分发失败：${e.message}`);
      process.exit(1);
    }
  }
  const rel = targetDir.slice(PROJECT_ROOT.length + 1) || '.';
  log(action.includes('跳过') ? 'yellow' : 'green',
    `  ${dryRun ? '[plan] ' : ''}${label} [${branch}] ${action}：${rel}/${fileName}`);
  return action;
}

function distribute(reports, manifest, { dryRun, requiredCodes = REQUIRED_REPORT_CODES }) {
  log('cyan', '\n▶ [4/4] 分发到 ETL 源目录（shanxi_→staging/SX；sichuan_/无前缀→数据管理/ 根）');
  for (const r of reports) {
    distributeOne(r.file, `code ${r.code}`, { dryRun });
  }

  // 契约外补导文件：上游补导历史窗口时（如 2026-07-05 批量补导 02 报价 0624-0703 单日文件），
  // manifest 只登记当前份，补导文件随 rsync 在 inbox 但不在 reports 里 —— 挑出符合五张表
  // 命名模式的一并分发。排除集 = manifest 全部当前份（含被剔除的可选/异常份，防侧门混入）。
  const inboxNames = existsSync(INBOX_DIR) ? readdirSync(INBOX_DIR) : [];
  const currentFiles = (manifest.reports || []).map((r) => r?.file).filter(Boolean);
  // 补导只认本批的 code（早批不会把上游昨日残留的 02/03 当补导误分发进早批）。
  const backfills = planBackfillFiles(inboxNames, currentFiles, requiredCodes);
  if (backfills.length > 0) {
    log('cyan', `\n▶ [4b] 契约外补导文件（manifest 之外、符合报表命名模式）：${backfills.length} 个`);
    for (const name of backfills) {
      distributeOne(name, '补导', { dryRun });
    }
  }
  return backfills.length;
}

// ── 主流程 ──

function main() {
  const opts = parseArgs(process.argv.slice(2));
  log('cyan', '════════════════════════════════════════════════');
  log('cyan', '  pull-bi-exports：VPS auto_loadbi → inbox → 校验 → 分发');
  log('cyan', `  inbox: ${INBOX_DIR}${opts.dryRun ? '  (dry-run)' : ''}`);
  log('cyan', `  批次: ${opts.batch ? `${opts.batch}（code ${opts.requiredCodes.join('/')}）` : '全量（不分批）'}`);
  log('cyan', '════════════════════════════════════════════════');

  if (opts.skipRsync) log('yellow', '\n⚠ 跳过 rsync（--skip-rsync），使用现有 inbox');
  else runRsync(opts);

  const { result, manifest } = loadManifestAndValidate(opts);
  verifyProvince(result.reports, opts);
  const backfillCount = distribute(result.reports, manifest, opts);

  // 一个 code 现在可能有多省份份数（如 01/02/03/05 各 SC+SX 两份），
  // 分子分母都用「份数」对不上「code 数」会看着像超过 100% —— 拆开报告两个数字更清楚。
  const distinctCodes = new Set(result.reports.map((r) => r.code)).size;
  log('green', `\n✅ 拉取${opts.dryRun ? '计划打印' : ''}完成：${distinctCodes}/${opts.requiredCodes.length} 张报表（共 ${result.reports.length} 份，含分省）${backfillCount > 0 ? ` + ${backfillCount} 个补导文件` : ''}${opts.dryRun ? '' : '已就位，可跑 ETL（release:daily 或 daily.mjs）'}`);
}

main();
