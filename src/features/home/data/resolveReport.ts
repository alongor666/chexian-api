/**
 * 报告可见性解析 — 把「ETL 数据日期」与「实际已生成的静态报告」对齐。
 *
 * 背景：报告 HTML 由 diagnose-* skill 单独生成并同步到 Nginx 静态目录，
 * 与 ETL 数据更新解耦。过去首页卡片直接用 etlDate 拼 URL，一旦数据更新但
 * 报告还没重新生成，链接就指向不存在的文件（Nginx 回落到 SPA index.html，
 * 返回 200 空白页 → “看不到报告”）。
 *
 * 本模块据 manifest（由 scripts/gen-reports-manifest.mjs 生成）解析出：
 *   - 应该打开哪一期报告（≤ etlDate 的最新一期可用报告）
 *   - 该报告是否落后于当前数据（stale → 视觉/文案提醒“数据未更新”）
 */

/** 单期报告条目 */
export interface ReportManifestEntry {
  /** YYYY-MM-DD */
  date: string
  /** 相对 slug 目录的文件名，如 2026-05-29-dashboard.html */
  file: string
}

/** scripts/gen-reports-manifest.mjs 写入的 manifest.json 结构 */
export interface ReportManifest {
  slug: string
  latest: string | null
  latestFile: string | null
  entries: ReportManifestEntry[]
  generatedAt?: string
}

export type ReportStatus =
  /** manifest 已加载，有一期 date === etlDate 的报告（或 etlDate 未知时取最新一期） */
  | 'ready'
  /** 最新可用报告早于 etlDate —— 数据已更新但报告未刷新 */
  | 'stale'
  /** manifest 已加载但没有任何报告 */
  | 'unavailable'
  /** manifest 尚未部署（旧版本）—— 回落到 etlDate 直拼，保持兼容、不做提醒 */
  | 'unknown'

export interface ResolvedReport {
  status: ReportStatus
  /** 实际打开的报告日期；unknown 时为 etlDate；unavailable 时为 null */
  reportDate: string | null
  /** 相对 slug 目录的文件名；无可用报告时为 null */
  reportFile: string | null
  /** 当前 ETL 数据日期（透传，便于 UI 文案） */
  etlDate: string | null
}

/**
 * 解析应展示的报告。
 *
 * @param manifest   已加载的 manifest；null 表示尚未部署 manifest（旧链路）
 * @param etlDate    当前 ETL 数据日期；null 表示未知
 */
export function resolveReport(
  manifest: ReportManifest | null,
  etlDate: string | null,
): ResolvedReport {
  // manifest 未部署 → 维持旧行为（由调用方用 etlDate 直拼），不做 stale 判定
  if (!manifest) {
    return { status: 'unknown', reportDate: etlDate, reportFile: null, etlDate }
  }

  const entries = manifest.entries ?? []
  if (entries.length === 0) {
    return { status: 'unavailable', reportDate: null, reportFile: null, etlDate }
  }

  // entries 由生成器按日期降序排列，但这里不假设顺序，显式挑选。
  // 选取 ≤ etlDate 的最新一期；若 etlDate 未知，取整体最新一期。
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const target = etlDate
    ? sorted.find((e) => e.date <= etlDate) ?? sorted[sorted.length - 1]
    : sorted[0]

  const isStale = etlDate != null && target.date < etlDate
  return {
    status: isStale ? 'stale' : 'ready',
    reportDate: target.date,
    reportFile: target.file,
    etlDate,
  }
}
