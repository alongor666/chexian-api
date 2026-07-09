/**
 * gen-reports-manifest.mjs 行为锁定单测
 *
 * 重点覆盖 codex P2：报告 HTML 被 gitignore + sync-vps append-only，
 * 从无完整历史的 host 跑同步时，绝不能把既有 manifest 缩小/清空。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateReportsManifests, scanSlugDir } from '../gen-reports-manifest.mjs';

const created = [];
function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'reports-manifest-'));
  created.push(dir);
  return dir;
}
function slugDir(root, slug = 'diagnose-period-trend') {
  const d = join(root, slug);
  return d;
}
function touch(dir, name) {
  writeFileSync(join(dir, name), '');
}
function readManifest(root, slug = 'diagnose-period-trend') {
  return JSON.parse(readFileSync(join(root, slug, 'manifest.json'), 'utf8'));
}

afterEach(() => {
  while (created.length) rmSync(created.pop(), { recursive: true, force: true });
});

describe('generateReportsManifests', () => {
  it('扫描日期前缀报告，按日期降序，忽略非报告文件', () => {
    const root = makeRoot();
    const d = slugDir(root);
    rmSync(d, { recursive: true, force: true });
    writeFileSync(join(root, '.gitkeep'), ''); // 非目录项不应崩
    mkdirSync(d, { recursive: true });
    touch(d, '2026-05-27-dashboard.html');
    touch(d, '2026-05-29-dashboard.html');
    touch(d, '2026-05-29-narrative.html'); // 非 dashboard，忽略
    touch(d, 'random.html');

    generateReportsManifests(root);
    const m = readManifest(root);
    expect(m.entries.map((e) => e.date)).toEqual(['2026-05-29', '2026-05-27']);
    expect(m.latest).toBe('2026-05-29');
    expect(m.latestFile).toBe('2026-05-29-dashboard.html');
  });

  it('合并既有 manifest：本地缺失的历史期不会丢失', () => {
    const root = makeRoot();
    const d = slugDir(root);
    mkdirSync(d, { recursive: true });
    touch(d, '2026-05-27-dashboard.html');
    touch(d, '2026-05-29-dashboard.html');
    generateReportsManifests(root);

    // 模拟“只有最新文件”的 host：删掉旧文件，再跑
    rmSync(join(d, '2026-05-27-dashboard.html'));
    generateReportsManifests(root);

    const m = readManifest(root);
    expect(m.entries.map((e) => e.date).sort()).toEqual(['2026-05-27', '2026-05-29']);
  });

  it('本地无报告文件 + 已存在非空 manifest → 合并保留既有期，不清空', () => {
    const root = makeRoot();
    const d = slugDir(root);
    mkdirSync(d, { recursive: true });
    touch(d, '2026-05-29-dashboard.html');
    generateReportsManifests(root);

    rmSync(join(d, '2026-05-29-dashboard.html'));
    generateReportsManifests(root);

    const m = readManifest(root);
    expect(m.entries).toHaveLength(1); // 既有 manifest 经合并保留，绝不缩成空
    expect(m.latest).toBe('2026-05-29');
  });

  it('完全空目录、无既有 manifest → 跳过，不写出空 manifest 文件', () => {
    const root = makeRoot();
    const d = slugDir(root);
    mkdirSync(d, { recursive: true });
    const summaries = generateReportsManifests(root);
    expect(existsSync(join(d, 'manifest.json'))).toBe(false);
    expect(summaries.find((s) => s.slug === 'diagnose-period-trend')?.skipped).toBe(true);
  });

  it('本地实际文件优先于旧 manifest 记录（同日 dashboard 覆盖）', () => {
    const root = makeRoot();
    const d = slugDir(root);
    mkdirSync(d, { recursive: true });
    // 旧 manifest 记录指向旧版 <date>.html
    writeFileSync(
      join(d, 'manifest.json'),
      JSON.stringify({ slug: 'diagnose-period-trend', entries: [{ date: '2026-05-29', file: '2026-05-29.html' }] }),
    );
    touch(d, '2026-05-29-dashboard.html');
    const entries = scanSlugDir(d);
    expect(entries).toEqual([{ date: '2026-05-29', file: '2026-05-29-dashboard.html' }]);
  });
});

describe('generateReportsManifests: 机构级子目录（B346）', () => {
  it('orgs/<branch>/<org>/ 生成机构级 manifest（带 scope），省级 manifest 不受影响', () => {
    const root = makeRoot();
    const d = slugDir(root);
    mkdirSync(d, { recursive: true });
    touch(d, '2026-07-06-dashboard.html');
    const orgDir = join(d, 'orgs', 'SC', '乐山');
    mkdirSync(orgDir, { recursive: true });
    touch(orgDir, '2026-07-06-dashboard.html');
    touch(orgDir, '2026-07-01-dashboard.html');

    const summaries = generateReportsManifests(root);

    const province = readManifest(root);
    expect(province.entries).toHaveLength(1);
    expect(province.scope).toBeUndefined();

    const orgManifest = JSON.parse(readFileSync(join(orgDir, 'manifest.json'), 'utf8'));
    expect(orgManifest.slug).toBe('diagnose-period-trend');
    expect(orgManifest.scope).toEqual({ branch: 'SC', org: '乐山' });
    expect(orgManifest.entries.map((e) => e.date)).toEqual(['2026-07-06', '2026-07-01']);
    expect(orgManifest.latestFile).toBe('2026-07-06-dashboard.html');

    const s = summaries.find((x) => x.slug === 'diagnose-period-trend');
    expect(s.orgs).toEqual([
      { branch: 'SC', org: '乐山', latest: '2026-07-06', count: 2 },
    ]);
  });

  it('branch 段非两位大写 → 跳过（与后端授权 schema 对齐）', () => {
    const root = makeRoot();
    const d = slugDir(root);
    const badDir = join(d, 'orgs', 'sc', '乐山');
    mkdirSync(badDir, { recursive: true });
    touch(badDir, '2026-07-06-dashboard.html');

    generateReportsManifests(root);
    expect(existsSync(join(badDir, 'manifest.json'))).toBe(false);
  });

  it('省级无文件但机构目录有文件 → 机构 manifest 照常生成', () => {
    const root = makeRoot();
    const d = slugDir(root);
    const orgDir = join(d, 'orgs', 'SX', '太原一部');
    mkdirSync(orgDir, { recursive: true });
    touch(orgDir, '2026-07-06-dashboard.html');

    const summaries = generateReportsManifests(root);
    expect(existsSync(join(d, 'manifest.json'))).toBe(false); // 省级跳过不写空
    expect(existsSync(join(orgDir, 'manifest.json'))).toBe(true);
    const s = summaries.find((x) => x.slug === 'diagnose-period-trend');
    expect(s.skipped).toBe(true);
    expect(s.orgs).toHaveLength(1);
  });

  it('分公司级 branches/<branch>/ 目录 → 独立 manifest（scope 只带 branch，B346 门户按省取数）', () => {
    const root = makeRoot();
    const d = slugDir(root);
    const scBranchDir = join(d, 'branches', 'SC');
    const sxBranchDir = join(d, 'branches', 'SX');
    const badBranchDir = join(d, 'branches', 'sc1');
    mkdirSync(scBranchDir, { recursive: true });
    mkdirSync(sxBranchDir, { recursive: true });
    mkdirSync(badBranchDir, { recursive: true });
    touch(d, '2026-07-06-dashboard.html');
    touch(scBranchDir, '2026-07-06-dashboard.html');
    touch(sxBranchDir, '2026-07-06-dashboard.html');
    touch(badBranchDir, '2026-07-06-dashboard.html');

    const summaries = generateReportsManifests(root);
    const s = summaries.find((x) => x.slug === 'diagnose-period-trend');
    expect(s.branches).toHaveLength(2); // 非 ^[A-Z]{2}$ 的 branch 段跳过
    const m = JSON.parse(readFileSync(join(scBranchDir, 'manifest.json'), 'utf8'));
    expect(m.scope).toEqual({ branch: 'SC' });
    expect(m.latest).toBe('2026-07-06');
    expect(existsSync(join(badBranchDir, 'manifest.json'))).toBe(false);
  });

  it('机构 manifest 与既有记录合并（append-only 语义与省级一致）', () => {
    const root = makeRoot();
    const orgDir = join(slugDir(root), 'orgs', 'SC', '乐山');
    mkdirSync(orgDir, { recursive: true });
    touch(orgDir, '2026-07-01-dashboard.html');
    touch(orgDir, '2026-07-06-dashboard.html');
    generateReportsManifests(root);

    rmSync(join(orgDir, '2026-07-01-dashboard.html'));
    generateReportsManifests(root);

    const m = JSON.parse(readFileSync(join(orgDir, 'manifest.json'), 'utf8'));
    expect(m.entries.map((e) => e.date).sort()).toEqual(['2026-07-01', '2026-07-06']);
  });
});
