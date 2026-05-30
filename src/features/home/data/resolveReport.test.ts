import { describe, it, expect } from 'vitest'
import { resolveReport, type ReportManifest } from './resolveReport'

function manifest(dates: string[]): ReportManifest {
  const entries = dates.map((date) => ({ date, file: `${date}-dashboard.html` }))
  // 生成器写入时是降序，这里故意乱序以验证 resolveReport 自身不依赖入参顺序
  return {
    slug: 'diagnose-period-trend',
    latest: dates.length ? dates[dates.length - 1] : null,
    latestFile: dates.length ? `${dates[dates.length - 1]}-dashboard.html` : null,
    entries,
  }
}

describe('resolveReport', () => {
  it('manifest 缺失 → unknown，回落 etlDate（保持旧行为）', () => {
    const r = resolveReport(null, '2026-05-29')
    expect(r.status).toBe('unknown')
    expect(r.reportDate).toBe('2026-05-29')
    expect(r.reportFile).toBeNull()
  })

  it('manifest 无任何报告 → unavailable', () => {
    const r = resolveReport(manifest([]), '2026-05-29')
    expect(r.status).toBe('unavailable')
    expect(r.reportFile).toBeNull()
  })

  it('报告与数据同日 → ready', () => {
    const r = resolveReport(manifest(['2026-05-28', '2026-05-29']), '2026-05-29')
    expect(r.status).toBe('ready')
    expect(r.reportDate).toBe('2026-05-29')
    expect(r.reportFile).toBe('2026-05-29-dashboard.html')
  })

  it('数据已更新但报告未刷新 → stale，取最新一期可用报告', () => {
    const r = resolveReport(manifest(['2026-05-27', '2026-05-29']), '2026-05-30')
    expect(r.status).toBe('stale')
    expect(r.reportDate).toBe('2026-05-29')
    expect(r.reportFile).toBe('2026-05-29-dashboard.html')
    expect(r.etlDate).toBe('2026-05-30')
  })

  it('选取 ≤ etlDate 的最新一期（忽略晚于 etlDate 的报告）', () => {
    const r = resolveReport(manifest(['2026-05-20', '2026-05-25', '2026-06-01']), '2026-05-28')
    expect(r.status).toBe('stale')
    expect(r.reportDate).toBe('2026-05-25')
  })

  it('etlDate 未知 → 取整体最新一期，不判 stale', () => {
    const r = resolveReport(manifest(['2026-05-25', '2026-05-29']), null)
    expect(r.status).toBe('ready')
    expect(r.reportDate).toBe('2026-05-29')
  })

  it('所有报告都晚于 etlDate（异常）→ 回落到最早一期，不崩溃', () => {
    const r = resolveReport(manifest(['2026-06-01', '2026-06-02']), '2026-05-30')
    expect(r.reportFile).not.toBeNull()
    expect(r.reportDate).toBe('2026-06-01')
  })
})
