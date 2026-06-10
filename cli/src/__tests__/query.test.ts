import { describe, it, expect } from 'vitest';
import { parseExtraParams, resolveTarget } from '../commands/query.js';
import { applyPathParams } from '../path-params.js';

describe('parseExtraParams', () => {
  it('解析 --key=value 形式', () => {
    expect(parseExtraParams(['--year=2026', '--org_level_3=分公司A']))
      .toEqual({ year: '2026', org_level_3: '分公司A' });
  });

  it('忽略不含 = 的参数', () => {
    expect(parseExtraParams(['--year=2026', '--debug'])).toEqual({ year: '2026' });
  });

  it('保留 = 之后的所有内容（含等号）', () => {
    expect(parseExtraParams(['--filter=a=b']))
      .toEqual({ filter: 'a=b' });
  });
});

describe('resolveTarget', () => {
  const routes = [
    { key: 'KPI', path: '/kpi', fullPath: '/api/query/kpi' },
    { key: 'CLAIMS_DETAIL_HEATMAP', path: '/claims-detail/heatmap', fullPath: '/api/query/claims-detail/heatmap' },
  ];

  it('key 宽容匹配（小写/中划线 → 大写下划线）', () => {
    expect(resolveTarget('kpi', routes)?.fullPath).toBe('/api/query/kpi');
    expect(resolveTarget('claims-detail-heatmap', routes)?.fullPath).toBe('/api/query/claims-detail/heatmap');
  });

  it('catalog path 命中', () => {
    expect(resolveTarget('/kpi', routes)?.fullPath).toBe('/api/query/kpi');
    expect(resolveTarget('/claims-detail/heatmap', routes)?.key).toBe('CLAIMS_DETAIL_HEATMAP');
  });

  it('catalog 未登记的 / 开头 path 直通拼接', () => {
    expect(resolveTarget('/repair/overview', routes)?.fullPath).toBe('/api/query/repair/overview');
  });

  it('非 path 且 catalog 无匹配 → null', () => {
    expect(resolveTarget('nonexistent', routes)).toBeNull();
  });
});

describe('applyPathParams (cli)', () => {
  it(':domain 替换且从参数移除', () => {
    const { resolvedPath, restArgs } = applyPathParams('/api/query/patrol/:domain', {
      domain: 'renewal',
      year: '2026',
    });
    expect(resolvedPath).toBe('/api/query/patrol/renewal');
    expect(restArgs).toEqual({ year: '2026' });
  });

  it('缺少 path 参数时抛错', () => {
    expect(() => applyPathParams('/api/query/patrol/:domain', {})).toThrow(/domain/);
  });
});
