#!/usr/bin/env node
/**
 * 静态报告 manifest 生成器
 *
 * 背景（为什么需要它）：
 *   首页报告卡过去直接用 `etlDate` 拼 URL：`/reports/<slug>/<etlDate>-dashboard.html`。
 *   但报告 HTML 是由 diagnose-* skill 单独生成、再 rsync 到 Nginx 静态目录的；
 *   ETL 一旦把数据日期推进（etlDate 变新），而报告还没重新生成，URL 就指向一个
 *   并不存在的文件。Nginx `try_files $uri $uri/ /index.html` 会回落到 SPA index.html
 *   并返回 200 —— 用户点开是一个空白 SPA 页（“看不到报告”），HEAD 探测也无法分辨。
 *
 * 解决：
 *   在 rsync 报告到 VPS 之前扫描 `public/reports/<slug>/`，把“实际存在的报告日期”
 *   写进每个 slug 目录下的 `manifest.json`。前端据此：
 *     - 选取 ≤ etlDate 的最新一期可用报告（而不是盲目拼 etlDate）
 *     - 若最新可用报告日期 < etlDate → 视觉 + 文案提醒“数据未更新”，但仍可打开上一期
 *
 * 用法：
 *   node scripts/gen-reports-manifest.mjs                 # 扫描默认 public/reports
 *   node scripts/gen-reports-manifest.mjs <reportsRoot>   # 指定根目录
 *
 * 也可作为模块导入：import { generateReportsManifests } from './gen-reports-manifest.mjs'
 */

import { readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_ROOT = join(__dirname, '..', 'public', 'reports');

// 报告文件名约定：<YYYY-MM-DD>-dashboard.html（首选）或 <YYYY-MM-DD>.html（旧版）
const REPORT_FILE_RE = /^(\d{4}-\d{2}-\d{2})(-dashboard)?\.html$/;

/**
 * 扫描单个 slug 目录，返回按日期降序排列的 [{ date, file }]。
 * 同一日期同时存在 dashboard 与旧版时，优先 dashboard。
 */
export function scanSlugDir(slugDir) {
  const byDate = new Map();
  for (const name of readdirSync(slugDir)) {
    const m = name.match(REPORT_FILE_RE);
    if (!m) continue;
    const date = m[1];
    const isDashboard = Boolean(m[2]);
    const existing = byDate.get(date);
    // 首次出现，或当前是 dashboard 且已有的不是 → 覆盖为首选
    if (!existing || (isDashboard && !existing.isDashboard)) {
      byDate.set(date, { date, file: name, isDashboard });
    }
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map(({ date, file }) => ({ date, file }));
}

/**
 * 为 reportsRoot 下每个 slug 目录生成 manifest.json。
 * @returns {{ slug: string, latest: string|null, count: number }[]} 摘要
 */
export function generateReportsManifests(reportsRoot = DEFAULT_REPORTS_ROOT) {
  if (!existsSync(reportsRoot)) {
    return [];
  }
  const summaries = [];
  for (const slug of readdirSync(reportsRoot)) {
    const slugDir = join(reportsRoot, slug);
    let isDir = false;
    try {
      isDir = statSync(slugDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const entries = scanSlugDir(slugDir);
    const latest = entries[0] ?? null;
    const manifest = {
      slug,
      latest: latest ? latest.date : null,
      latestFile: latest ? latest.file : null,
      entries,
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(join(slugDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    summaries.push({ slug, latest: manifest.latest, count: entries.length });
  }
  return summaries;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain || process.argv[1]?.endsWith('gen-reports-manifest.mjs')) {
  const root = process.argv[2] || DEFAULT_REPORTS_ROOT;
  const summaries = generateReportsManifests(root);
  if (summaries.length === 0) {
    console.log(`[reports-manifest] 无报告目录可扫描：${root}`);
  } else {
    for (const s of summaries) {
      console.log(`[reports-manifest] ${s.slug}: ${s.count} 期，最新 ${s.latest ?? '（无）'}`);
    }
  }
}
