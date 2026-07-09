/**
 * 门户首页入口卡数据声明。
 *
 * 新增入口卡：往 `reportEntries` 数组追加一个 ReportEntry 即可（无需改 HomePage / ReportEntryCard）。
 *
 * 报告 URL **必须** 通过 `/reports/<slug>/manifest.json` 解析 —— manifest 由
 * `scripts/gen-reports-manifest.mjs` 在 VPS 端按真实存在的 HTML 文件清单生成。
 * 拉不到 / 非合法 JSON 一律视为 unavailable，**不再** 回落到 etlDate 直拼
 * （那正是 PR 441 想根除的「空白 SPA 页」行为）。
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

/**
 * 报告目录基址（B346 彻底治理）：统一走后端门户 `/api/reports/portal/<slug>/`。
 * 同一 URL 对所有用户成立——**服务端**按登录身份解析省级（branch_admin）或
 * 本机构（org_user → orgs/<branch>/<org>/）文件，前端不再按 scope 拼不同 URL
 * （旧 Nginx 静态直链 `/reports/<slug>/...` 保留为纵深防御，403 拦越权直链）。
 */
function getReportBase(slug: string): string {
  return `/api/reports/portal/${slug}`
}

/**
 * 追加全国超管切省信号 `?targetBranch=XX`（2026-07-09-claude-9692f9，B346 续作）。
 *
 * 门户 manifest 走裸 fetch()、报告 HTML 由浏览器直接导航打开，都**不经** apiClient，
 * 故 client-core 的 injectTargetBranch 注入对门户无效——切省信号必须直接拼进门户 URL。
 * 仅全国超管切省时由调用方（ReportEntryCard / useReportManifest）传入 effectiveBranch；
 * 普通单省用户传 null/undefined → 不追加，零行为变化（天然灰度）。服务端仍按 token 的
 * visibleBranches 白名单校验，绝不信任此原值（见 reports.ts resolvePortalScope）。
 */
function withTargetBranch(url: string, targetBranch?: string | null): string {
  if (!targetBranch) return url
  return `${url}?targetBranch=${encodeURIComponent(targetBranch)}`
}

/** manifest URL（服务端按用户可见范围返回省级或机构级 manifest；全国超管切省时带 targetBranch） */
export function getManifestUrl(slug: string, targetBranch?: string | null): string {
  return withTargetBranch(`${getReportBase(slug)}/manifest.json`, targetBranch)
}

/** 由 slug + 文件名拼出报告 URL（服务端按用户可见范围选文件；全国超管切省时带 targetBranch） */
export function getReportUrl(slug: string, file: string, targetBranch?: string | null): string {
  return withTargetBranch(`${getReportBase(slug)}/${file}`, targetBranch)
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
