#!/usr/bin/env node

/**
 * 报告 scope 新鲜度一致性闸。
 *
 * Stage 1.5 生成报告后、sync-vps 前运行：先按现有 manifest 生成器刷新 manifest，
 * 再以磁盘上的真实 dashboard 文件为准，核对根目录、branches/<省>、
 * orgs/<省>/<机构> 是否同日。diagnose-period-trend 的应生成 scope 来自
 * branch-org-mapping/*.json SSOT，不能只扫描已经存在的目录，否则缺失 scope 会漏检。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { generateReportsManifests } from './gen-reports-manifest.mjs';
import {
  listBranchOrgMappingCodes,
  readBranchOrgUnits,
} from '../数据管理/lib/period-trend-orgs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DEFAULT_REPORTS_ROOT = join(ROOT_DIR, 'public', 'reports');
const DEFAULT_CONFIG_DIR = join(ROOT_DIR, '数据管理', 'config');
const REPORT_FILE_RE = /^(\d{4}-\d{2}-\d{2})(-dashboard)?\.html$/;
const PERIOD_TREND_SLUG = 'diagnose-period-trend';

function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** 只看磁盘真实文件，不读取 manifest，避免历史 manifest 自证“最新”。 */
export function scanActualLatest(dir) {
  if (!existsSync(dir)) return null;
  let latest = null;
  for (const name of readdirSync(dir)) {
    const match = REPORT_FILE_RE.exec(name);
    if (!match) continue;
    const candidate = {
      date: match[1],
      file: name,
      isDashboard: Boolean(match[2]),
    };
    if (
      latest === null
      || candidate.date > latest.date
      || (candidate.date === latest.date && candidate.isDashboard && !latest.isDashboard)
    ) {
      latest = candidate;
    }
  }
  return latest ? { date: latest.date, file: latest.file } : null;
}

function readManifest(dir) {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return { path, manifest: null, error: 'manifest.json 不存在' };
  try {
    return { path, manifest: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (error) {
    return { path, manifest: null, error: `manifest.json 无法解析：${error.message}` };
  }
}

function sameScope(actual, expected) {
  if (expected === null) return actual === undefined || actual === null;
  if (!actual || typeof actual !== 'object') return false;
  return actual.branch === expected.branch
    && (expected.org === undefined ? actual.org === undefined : actual.org === expected.org);
}

function inspectScope({ dir, label, slug, expectedScope, rootLatest, errors }) {
  const actual = scanActualLatest(dir);
  const { manifest, error: manifestError } = readManifest(dir);

  if (!actual) {
    const manifestHint = manifest?.latest ? `（manifest latest=${manifest.latest}，但磁盘无对应报告产物）` : '';
    errors.push(`${label}: 缺失可发布报告文件${manifestHint}`);
    return null;
  }

  if (manifestError) {
    errors.push(`${label}: ${manifestError}`);
  } else {
    if (manifest.slug !== slug) {
      errors.push(`${label}: manifest slug=${JSON.stringify(manifest.slug)}，期望 ${slug}`);
    }
    if (!sameScope(manifest.scope, expectedScope)) {
      errors.push(`${label}: manifest scope=${JSON.stringify(manifest.scope)}，期望 ${JSON.stringify(expectedScope)}`);
    }
    if (manifest.latest !== actual.date || manifest.latestFile !== actual.file) {
      errors.push(
        `${label}: manifest latest=${manifest.latest ?? '缺失'}/${manifest.latestFile ?? '缺失'}，`
        + `磁盘 latest=${actual.date}/${actual.file}`,
      );
    }
    const hasActualEntry = Array.isArray(manifest.entries)
      && manifest.entries.some((entry) => entry?.date === actual.date && entry?.file === actual.file);
    if (!hasActualEntry) {
      errors.push(`${label}: manifest entries 未登记磁盘 latest=${actual.date}/${actual.file}`);
    }
  }

  if (rootLatest && actual.date !== rootLatest.date) {
    errors.push(`${label}: 磁盘 latest=${actual.date}，根目录基准=${rootLatest.date}`);
  }
  return actual;
}

function loadPeriodTrendExpectedScopes(configDir, errors) {
  const branches = listBranchOrgMappingCodes(configDir);
  const orgs = [];
  if (branches.length === 0) {
    errors.push(`${PERIOD_TREND_SLUG}: branch-org-mapping 下无已注册省份，无法确定应生成 scope`);
    return { branches, orgs };
  }
  for (const branch of branches) {
    try {
      const units = readBranchOrgUnits(configDir, branch) ?? [];
      for (const org of units) orgs.push({ branch, org });
    } catch (error) {
      errors.push(`${PERIOD_TREND_SLUG}/orgs/${branch}: 机构清单读取失败：${error.message}`);
    }
  }
  return { branches, orgs };
}

function discoverObservedScopes(slugDir) {
  const branches = listSubdirs(join(slugDir, 'branches'))
    .filter((branch) => /^[A-Z]{2}$/.test(branch));
  const orgs = [];
  for (const branch of listSubdirs(join(slugDir, 'orgs')).filter((name) => /^[A-Z]{2}$/.test(name))) {
    for (const org of listSubdirs(join(slugDir, 'orgs', branch))) orgs.push({ branch, org });
  }
  return { branches, orgs };
}

function scopeKey(scope) {
  return scope.org === undefined ? scope.branch : `${scope.branch}\0${scope.org}`;
}

export function runReportScopeFreshnessGate({
  reportsRoot = DEFAULT_REPORTS_ROOT,
  configDir = DEFAULT_CONFIG_DIR,
} = {}) {
  // 复用现有 manifest schema/合并语义；随后仍以磁盘扫描复核，避免旧 entries 自证成功。
  const summaries = generateReportsManifests(reportsRoot);
  const errors = [];
  const expectedPeriodTrend = loadPeriodTrendExpectedScopes(configDir, errors);
  const candidateSlugs = new Set([PERIOD_TREND_SLUG]);

  for (const summary of summaries) {
    if (!summary.skipped || (summary.branches?.length ?? 0) > 0 || (summary.orgs?.length ?? 0) > 0) {
      candidateSlugs.add(summary.slug);
    }
  }

  const checkedSlugs = [...candidateSlugs].sort();
  for (const slug of checkedSlugs) {
    const slugDir = join(reportsRoot, slug);
    const expected = slug === PERIOD_TREND_SLUG
      ? expectedPeriodTrend
      : { branches: [], orgs: [] };
    const observed = discoverObservedScopes(slugDir);
    const branches = [...new Set([...expected.branches, ...observed.branches])].sort();
    const orgMap = new Map(
      [...expected.orgs, ...observed.orgs].map((scope) => [scopeKey(scope), scope]),
    );
    const orgs = [...orgMap.values()].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));

    const rootLatest = inspectScope({
      dir: slugDir,
      label: `${slug}/root`,
      slug,
      expectedScope: null,
      rootLatest: null,
      errors,
    });
    for (const branch of branches) {
      inspectScope({
        dir: join(slugDir, 'branches', branch),
        label: `${slug}/branches/${branch}`,
        slug,
        expectedScope: { branch },
        rootLatest,
        errors,
      });
    }
    for (const { branch, org } of orgs) {
      inspectScope({
        dir: join(slugDir, 'orgs', branch, org),
        label: `${slug}/orgs/${branch}/${org}`,
        slug,
        expectedScope: { branch, org },
        rootLatest,
        errors,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checkedSlugs,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reports-root') options.reportsRoot = resolve(argv[++i] ?? '');
    else if (arg === '--config-dir') options.configDir = resolve(argv[++i] ?? '');
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function main() {
  const result = runReportScopeFreshnessGate(parseCliArgs(process.argv.slice(2)));
  if (!result.ok) {
    console.error(`❌ 报告 scope 新鲜度一致性闸失败（${result.errors.length} 项）：`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ 报告 scope 新鲜度一致性闸通过：${result.checkedSlugs.join(', ')}`);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`❌ 报告 scope 新鲜度一致性闸异常：${error.message}`);
    process.exitCode = 1;
  }
}
