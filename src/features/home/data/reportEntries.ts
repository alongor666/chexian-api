/**
 * 门户首页入口卡数据声明。
 *
 * 新增入口卡：往 `reportEntries` 数组追加一个 ReportEntry 即可（无需改 HomePage / ReportEntryCard）。
 *
 * 报告 URL 不再直接用 etlDate 直拼，而是先读 `/reports/<slug>/manifest.json`
 * （由 scripts/gen-reports-manifest.mjs 生成），解析出真正存在的最新一期报告，
 * 详见 components/ReportEntryCard.tsx 与 data/resolveReport.ts。
 */
import { BarChart3, type LucideIcon } from 'lucide-react'

export interface ReportEntry {
  /** 路由稳定 id，用于 React key */
  id: string
  /** 报告 slug，对应 public/reports/<slug>/ 静态目录 */
  slug: string
  /** 卡片标题 */
  title: string
  /** 卡片副标（一行简介） */
  subtitle: string
  /** 卡片右上角图标 */
  icon: LucideIcon
  /** 卡片内部展示的徽标/维度（4-6 项） */
  badges: string[]
  /** 视觉强调色，可选 */
  accent?: 'primary' | 'success'
}

/** manifest 静态文件 URL */
export function getManifestUrl(slug: string): string {
  return `/reports/${slug}/manifest.json`
}

/** 由 slug + 文件名拼出报告 URL */
export function getReportUrl(slug: string, file: string): string {
  return `/reports/${slug}/${file}`
}

/** manifest 缺失时的旧版回落：用 etlDate 直拼（保持向后兼容） */
export function getLegacyReportUrl(slug: string, etlDate: string | null): string | null {
  return etlDate ? `/reports/${slug}/${etlDate}-dashboard.html` : null
}

export const reportEntries: ReportEntry[] = [
  {
    id: 'diagnose-period-trend',
    slug: 'diagnose-period-trend',
    title: '车险经营 · 短中长期对照',
    subtitle: '当年起保 vs 上年同期 vs 滚动 6/12/24/36/48 月 — 7 指标全景画像',
    icon: BarChart3,
    badges: [
      '7 时间窗',
      '7 核心指标',
      '11 客户类别',
      '四级亮灯',
      '行列转置',
      '双主题',
    ],
    accent: 'primary',
  },
]
