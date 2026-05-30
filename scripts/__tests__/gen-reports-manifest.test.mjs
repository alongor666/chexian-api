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
