/**
 * 读取 `/api/reports/portal/<slug>/manifest.json`（B346 门户：服务端按登录用户
 * 返回省级或本机构 manifest，文件由 `gen-reports-manifest.mjs` 生成、sync-vps 推送）。
 *
 * 容错要点：manifest 不存在时后端返回 404 JSON 错误体（org_user = 本机构报告
 * 未生成）。这里严格校验返回体是合法 manifest，否则一律返回 null —— 调用方
 * （resolveReport）会显式判为 unavailable 并禁用按钮，**不再** 回落到 etlDate
 * 直拼（那会重新打开 PR 441 修复的空白页）。content-type 校验保留，兼防经
 * Nginx 静态路径误配回落 SPA index.html 的旧形态。
 */
import { useQuery } from '@tanstack/react-query'
import { getManifestUrl, type ReportEntry } from '../data/reportEntries'
import type { ReportScope } from '../data/reportScope'
import type { ReportManifest } from '../data/resolveReport'

async function fetchManifest(
  slug: string,
  targetBranch?: string | null
): Promise<ReportManifest | null> {
  let res: Response
  try {
    res = await fetch(getManifestUrl(slug, targetBranch), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  // 回落到 SPA index.html 时 content-type 为 text/html —— 直接判为未部署
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) return null

  try {
    const data = (await res.json()) as Partial<ReportManifest>
    if (!data || typeof data.slug !== 'string' || !Array.isArray(data.entries)) {
      return null
    }
    return {
      slug: data.slug,
      latest: data.latest ?? null,
      latestFile: data.latestFile ?? null,
      entries: data.entries,
      generatedAt: data.generatedAt,
    }
  } catch {
    return null
  }
}

export function useReportManifest(
  entry: ReportEntry,
  scope: ReportScope,
  targetBranch?: string | null
) {
  return useQuery({
    // scope 进 queryKey：切换用户（分公司管理员 ↔ 机构用户）不得复用彼此的 manifest 缓存。
    // targetBranch 进 queryKey：全国超管切省后不得复用旧省 manifest 缓存（跨省串读，B346 续作）。
    queryKey: [
      'report-manifest',
      entry.slug,
      scope.kind,
      scope.kind === 'org' ? `${scope.branch}/${scope.org}` : null,
      targetBranch ?? null,
    ],
    queryFn: () => fetchManifest(entry.slug, targetBranch),
    // forbidden：不发请求（后端也会 403），卡片显示无权限
    enabled: scope.kind !== 'forbidden',
    staleTime: 60 * 60 * 1000, // 1 小时，与 data-version 对齐
  })
}
