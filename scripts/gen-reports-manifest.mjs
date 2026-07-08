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

import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_ROOT = join(__dirname, '..', 'public', 'reports');

// 报告文件名约定：<YYYY-MM-DD>-dashboard.html（首选）或 <YYYY-MM-DD>.html（旧版）
const REPORT_FILE_RE = /^(\d{4}-\d{2}-\d{2})(-dashboard)?\.html$/;

/** 读取 slug 目录下已存在的 manifest.json，返回其 entries（容错，失败返回 []）。 */
function readExistingEntries(slugDir) {
  const manifestPath = join(slugDir, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries.filter(
      (e) => e && typeof e.date === 'string' && typeof e.file === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * 扫描单个 slug 目录，返回按日期降序排列的 [{ date, file }]。
 *
 * 关键：与该目录已存在的 manifest.json **合并**（取并集）。
 * 原因（codex P2）：报告 HTML 被 gitignore，sync-vps 又是 append-only（不 --delete），
 * 历史报告只存在于远端/owning host。若仅做本地扫描就覆盖 manifest，从一个不含全部
 * 历史文件的 host 跑同步时，会把远端 manifest 缩成「只有本地这几期」甚至空，导致首页卡
 * 反而打不开既有报告。合并已存在 entries 可保证 manifest 在 owning host 上只增不减。
 *
 * 同一日期：优先 *-dashboard.html，其次保留先出现的；本地实际文件优先于旧 manifest 记录。
 */
export function scanSlugDir(slugDir) {
  const byDate = new Map();

  // 先放入旧 manifest 记录（优先级低，可被本地实际文件覆盖）
  for (const e of readExistingEntries(slugDir)) {
    const isDashboard = /-dashboard\.html$/i.test(e.file);
    byDate.set(e.date, { date: e.date, file: e.file, isDashboard, fromDisk: false });
  }

  // 本地实际存在的文件（优先级高）
  for (const name of readdirSync(slugDir)) {
    const m = name.match(REPORT_FILE_RE);
    if (!m) continue;
    const date = m[1];
    const isDashboard = Boolean(m[2]);
    const existing = byDate.get(date);
    // 覆盖条件：尚无记录 / 已有记录来自旧 manifest / 当前是 dashboard 而已有不是
    if (!existing || !existing.fromDisk || (isDashboard && !existing.isDashboard)) {
      byDate.set(date, { date, file: name, isDashboard, fromDisk: true });
    }
  }

  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map(({ date, file }) => ({ date, file }));
}

/** 列出目录下的子目录名（容错，非目录/不存在返回 []）。 */
function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    try {
      if (statSync(join(dir, name)).isDirectory()) out.push(name);
    } catch {
      /* 忽略瞬时消失的条目 */
    }
  }
  return out;
}

/**
 * 为单个报告目录（slug 根或机构子目录）写 manifest.json。
 * 空 entries 时跳过写入（绝不用空 manifest 覆盖既有非空 manifest —— codex P2）。
 * @returns {{ latest: string|null, count: number, skipped?: boolean }}
 */
function writeDirManifest(dir, slug, scope) {
  const entries = scanSlugDir(dir);
  if (entries.length === 0) {
    return { latest: null, count: 0, skipped: true };
  }
  const latest = entries[0] ?? null;
  const manifest = {
    slug,
    // 机构级 manifest 标注归属（branch + org），省级 manifest 无 scope 字段（向后兼容）
    ...(scope ? { scope } : {}),
    latest: latest ? latest.date : null,
    latestFile: latest ? latest.file : null,
    entries,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { latest: manifest.latest, count: entries.length };
}

/**
 * 为 reportsRoot 下每个 slug 目录生成 manifest.json。
 *
 * B346 机构级报告：slug 目录下若存在 `orgs/<branch>/<org>/` 子目录（生成端按机构产出的
 * 报告，branch = 两位大写分公司码），为每个机构目录单独生成 manifest.json
 * （schema 同省级，另带 scope: { branch, org }）。省级 manifest 只统计 slug 根目录文件。
 *
 * @returns {{ slug: string, latest: string|null, count: number, orgs?: object[] }[]} 摘要
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

    const provinceResult = writeDirManifest(slugDir, slug, null);

    // 机构级 manifest：orgs/<branch>/<org>/（branch 段非 ^[A-Z]{2}$ 的目录跳过，
    // 与 server/src/routes/reports.ts parseStaticReportOwner 的授权 schema 对齐）
    const orgSummaries = [];
    for (const branch of listSubdirs(join(slugDir, 'orgs'))) {
      if (!/^[A-Z]{2}$/.test(branch)) continue;
      for (const org of listSubdirs(join(slugDir, 'orgs', branch))) {
        const orgDir = join(slugDir, 'orgs', branch, org);
        const r = writeDirManifest(orgDir, slug, { branch, org });
        if (!r.skipped) orgSummaries.push({ branch, org, latest: r.latest, count: r.count });
      }
    }

    summaries.push({
      slug,
      latest: provinceResult.latest,
      count: provinceResult.count,
      ...(provinceResult.skipped ? { skipped: true } : {}),
      ...(orgSummaries.length > 0 ? { orgs: orgSummaries } : {}),
    });
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
      if (s.skipped) {
        console.log(`[reports-manifest] ${s.slug}: 本地无省级报告文件，跳过（保留既有 manifest）`);
      } else {
        console.log(`[reports-manifest] ${s.slug}: ${s.count} 期，最新 ${s.latest ?? '（无）'}`);
      }
      for (const o of s.orgs ?? []) {
        console.log(`[reports-manifest]   └ ${o.branch}/${o.org}: ${o.count} 期，最新 ${o.latest ?? '（无）'}`);
      }
    }
  }
}
