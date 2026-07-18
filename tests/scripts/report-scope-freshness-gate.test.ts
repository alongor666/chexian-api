import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import {
  runReportScopeFreshnessGate,
  scanActualLatest,
} from '../../scripts/report-scope-freshness-gate.mjs';

const created: string[] = [];
const PROJECT_ROOT = process.cwd();
const GATE_CLI = join(PROJECT_ROOT, 'scripts', 'report-scope-freshness-gate.mjs');

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'report-scope-gate-'));
  created.push(root);
  const reportsRoot = join(root, 'public', 'reports');
  const configDir = join(root, '数据管理', 'config');
  mkdirSync(reportsRoot, { recursive: true });
  mkdirSync(join(configDir, 'branch-org-mapping'), { recursive: true });
  return { root, reportsRoot, configDir };
}

function writeMapping(configDir: string, branch: string, units: string[]) {
  writeFileSync(
    join(configDir, 'branch-org-mapping', `${branch}.json`),
    JSON.stringify({ units }),
    'utf8',
  );
}

function writeReport(dir: string, date: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}-dashboard.html`), '<html></html>', 'utf8');
}

function periodTrendDir(reportsRoot: string) {
  return join(reportsRoot, 'diagnose-period-trend');
}

function writeCompletePeriodTrend(
  reportsRoot: string,
  date: string,
  scopes: Record<string, string[]>,
) {
  const slugDir = periodTrendDir(reportsRoot);
  writeReport(slugDir, date);
  for (const [branch, units] of Object.entries(scopes)) {
    writeReport(join(slugDir, 'branches', branch), date);
    for (const org of units) writeReport(join(slugDir, 'orgs', branch, org), date);
  }
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

describe('report scope freshness gate', () => {
  it('根目录、全部 branch/org scope 的磁盘产物与 manifest 同日时通过', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeMapping(configDir, 'SX', ['太原一部']);
    writeCompletePeriodTrend(reportsRoot, '2026-07-15', {
      SC: ['乐山'],
      SX: ['太原一部'],
    });

    const result = runReportScopeFreshnessGate({ reportsRoot, configDir });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(readFileSync(
      join(periodTrendDir(reportsRoot), 'orgs', 'SC', '乐山', 'manifest.json'),
      'utf8',
    ))).toMatchObject({
      latest: '2026-07-15',
      scope: { branch: 'SC', org: '乐山' },
    });
  });

  it('根目录已更新但 org 磁盘产物仍旧时失败，即使旧 manifest 自称最新', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    const slugDir = periodTrendDir(reportsRoot);
    writeReport(slugDir, '2026-07-15');
    writeReport(join(slugDir, 'branches', 'SC'), '2026-07-15');
    const orgDir = join(slugDir, 'orgs', 'SC', '乐山');
    writeReport(orgDir, '2026-07-14');
    writeFileSync(join(orgDir, 'manifest.json'), JSON.stringify({
      slug: 'diagnose-period-trend',
      scope: { branch: 'SC', org: '乐山' },
      latest: '2026-07-15',
      latestFile: '2026-07-15-dashboard.html',
      entries: [{ date: '2026-07-15', file: '2026-07-15-dashboard.html' }],
    }), 'utf8');

    const result = runReportScopeFreshnessGate({ reportsRoot, configDir });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('diagnose-period-trend/orgs/SC/乐山');
    expect(result.errors.join('\n')).toContain('2026-07-14');
    expect(result.errors.join('\n')).toContain('2026-07-15');
  });

  it('所有 scope 虽同日但未在本批次刷新时失败', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeCompletePeriodTrend(reportsRoot, '2026-07-15', { SC: ['乐山'] });
    const notBeforeMs = Date.now() + 1_000;

    const result = runReportScopeFreshnessGate({ reportsRoot, configDir, notBeforeMs });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('未在本批次刷新');
  });

  it('其他报告类型可保留历史产物，不受 period-trend 本批次时间约束', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeCompletePeriodTrend(reportsRoot, '2026-07-15', { SC: ['乐山'] });
    const historicalDir = join(reportsRoot, 'diagnose-loss-development');
    writeReport(historicalDir, '2026-07-01');
    const historicalFile = join(historicalDir, '2026-07-01-dashboard.html');
    utimesSync(historicalFile, new Date(1_000), new Date(1_000));

    const result = runReportScopeFreshnessGate({
      reportsRoot,
      configDir,
      notBeforeMs: 2_000,
    });

    expect(result.ok).toBe(true);
    expect(result.checkedSlugs).toEqual([
      'diagnose-loss-development',
      'diagnose-period-trend',
    ]);
  });

  it('文件名匹配但实际为目录时不视为报告产物', () => {
    const { reportsRoot } = makeFixture();
    const slugDir = periodTrendDir(reportsRoot);
    mkdirSync(join(slugDir, '2026-07-15-dashboard.html'), { recursive: true });

    expect(scanActualLatest(slugDir)).toBeNull();
  });

  it('应生成的 branch 与 org scope 缺失时逐项列出并失败', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeReport(periodTrendDir(reportsRoot), '2026-07-15');

    const result = runReportScopeFreshnessGate({ reportsRoot, configDir });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('diagnose-period-trend/branches/SC');
    expect(result.errors.join('\n')).toContain('diagnose-period-trend/orgs/SC/乐山');
  });

  it('忽略不含报告产物与报告 manifest 的普通目录', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeCompletePeriodTrend(reportsRoot, '2026-07-15', { SC: ['乐山'] });
    const unrelated = join(reportsRoot, 'assets-cache');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, 'README.txt'), 'not a report', 'utf8');

    const result = runReportScopeFreshnessGate({ reportsRoot, configDir });

    expect(result.ok).toBe(true);
    expect(result.checkedSlugs).toEqual(['diagnose-period-trend']);
  });

  it('CLI 在 scope 失败时非零退出，错误输出包含具体 scope', () => {
    const { reportsRoot, configDir } = makeFixture();
    writeMapping(configDir, 'SC', ['乐山']);
    writeReport(periodTrendDir(reportsRoot), '2026-07-15');

    const result = spawnSync('node', [
      GATE_CLI,
      '--reports-root', reportsRoot,
      '--config-dir', configDir,
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('diagnose-period-trend/branches/SC');
  });

  it('CLI 参数缺值时直接报错，不把当前目录当作路径', () => {
    const result = spawnSync('node', [GATE_CLI, '--reports-root'], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('--reports-root 缺少值');
  });

  it('发布编排把 scope 闸放在报告生成之后、VPS sync 之前', () => {
    const source = readFileSync(
      join(PROJECT_ROOT, 'scripts', 'sync-and-reload.mjs'),
      'utf8',
    );
    const reportIndex = source.indexOf("'period-trend report'");
    const scopeGateIndex = source.indexOf("'report scope freshness gate'");
    const syncIndex = source.indexOf("'VPS sync'");
    const batchStartIndex = source.indexOf('const reportGenerationStartedAt = Date.now()');
    const notBeforeArgIndex = source.indexOf("'--not-before-epoch-ms'");

    expect(reportIndex).toBeGreaterThan(-1);
    expect(batchStartIndex).toBeGreaterThan(-1);
    expect(batchStartIndex).toBeLessThan(reportIndex);
    expect(scopeGateIndex).toBeGreaterThan(reportIndex);
    expect(notBeforeArgIndex).toBeGreaterThan(scopeGateIndex);
    expect(scopeGateIndex).toBeLessThan(syncIndex);
  });
});
