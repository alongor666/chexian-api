/**
 * 门户首页入口卡数据声明。
 *
 * 新增入口卡：往 `reportEntries` 数组追加一个 ReportEntry 即可（无需改 HomePage / ReportEntryCard）。
 * URL 由 `getReportUrl(etlDate)` 派生，默认指向 `public/reports/<slug>/<date>.html` 静态文件。
 */
import { BarChart3, type LucideIcon } from 'lucide-react'

export interface ReportEntry {
  /** 路由稳定 id，用于 React key */
  id: string
  /** 卡片标题 */
  title: string
  /** 卡片副标（一行简介） */
  subtitle: string
  /** 卡片右上角图标 */
  icon: LucideIcon
  /** 卡片内部展示的徽标/维度（4-6 项） */
  badges: string[]
  /** 由 etlDate 派生的 HTML 路径；返回 null 表示报告未生成 */
  getReportUrl: (etlDate: string | null) => string | null
  /** 视觉强调色，可选 */
  accent?: 'primary' | 'success'
}

export const reportEntries: ReportEntry[] = [
  {
    id: 'diagnose-period-trend',
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
    getReportUrl: (etlDate) =>
      etlDate ? `/reports/diagnose-period-trend/${etlDate}.html` : null,
    accent: 'primary',
  },
]
