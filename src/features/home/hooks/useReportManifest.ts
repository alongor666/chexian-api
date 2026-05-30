/**
 * 读取 `/reports/<slug>/manifest.json`（Nginx 静态托管）。
 *
 * 容错要点：当 manifest 不存在时，Nginx `try_files` 会回落到 SPA index.html
 * 并返回 200（HTML 而非 JSON）。因此这里必须严格校验返回体是合法 manifest，
 * 否则一律视为「manifest 未部署」返回 null（调用方走旧版 etlDate 回落逻辑）。
 */
import { useQuery } from '@tanstack/react-query'
import { getManifestUrl, type ReportEntry } from '../data/reportEntries'
import type { ReportManifest } from '../data/resolveReport'

async function fetchManifest(slug: string): Promise<ReportManifest | null> {
  let res: Response
  try {
    res = await fetch(getManifestUrl(slug), {
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

export function useReportManifest(entry: ReportEntry) {
  return useQuery({
    queryKey: ['report-manifest', entry.slug],
    queryFn: () => fetchManifest(entry.slug),
    staleTime: 60 * 60 * 1000, // 1 小时，与 data-version 对齐
  })
}
