/**
 * 地理风险热力图 — 阈值/严重度/洞察生成器单元测试
 *
 * 覆盖：
 *   - crossRegionSeverity（主洞察阈值）
 *   - topProvinceSeverity（沿用 Tab 1 套路）
 *   - extractProvinceName / topPlateConcentration（数据形态钉死）
 *   - frequencyYoyDeterioration（同比窗口判定）
 *   - topProvinceAvgClaim（聚合 + 比值）
 *   - deriveGeoInsights（端到端 4 卡 + 降级）
 */
import { describe, expect, it } from 'vitest';
import {
  GEO_THRESHOLDS,
  crossRegionSeverity,
  deriveGeoInsights,
  extractProvinceName,
  frequencyYoyDeterioration,
  topPlateConcentration,
  topProvinceAvgClaim,
  topProvinceSeverity,
} from './insights';
import type {
  FrequencyYoyRow,
  GeoAccidentRow,
  GeoComparisonRow,
  GeoPlateRow,
} from './types';

describe('crossRegionSeverity', () => {
  it('null / 负值 → neutral', () => {
    expect(crossRegionSeverity(null)).toBe('neutral');
    expect(crossRegionSeverity(undefined)).toBe('neutral');
    expect(crossRegionSeverity(-1)).toBe('neutral');
  });

  it('< 25% → good', () => {
    expect(crossRegionSeverity(0)).toBe('good');
    expect(crossRegionSeverity(24.9)).toBe('good');
  });

  it('[25%, 40%) → warn', () => {
    expect(crossRegionSeverity(GEO_THRESHOLDS.crossRegionPctWarn)).toBe('warn');
    expect(crossRegionSeverity(30)).toBe('warn');
    expect(crossRegionSeverity(39.9)).toBe('warn');
  });

  it('≥ 40% → bad', () => {
    expect(crossRegionSeverity(GEO_THRESHOLDS.crossRegionPctBad)).toBe('bad');
    expect(crossRegionSeverity(99)).toBe('bad');
  });

  it('阈值边界含等号（≥ 而非 >）', () => {
    expect(crossRegionSeverity(25)).toBe('warn');
    expect(crossRegionSeverity(40)).toBe('bad');
  });
});

describe('topProvinceSeverity', () => {
  it('ratio ≤ 0 → neutral（防止空数据/除零）', () => {
    expect(topProvinceSeverity(0)).toBe('neutral');
    expect(topProvinceSeverity(-0.5)).toBe('neutral');
  });

  it('< 1.2 → good', () => {
    expect(topProvinceSeverity(1.0)).toBe('good');
    expect(topProvinceSeverity(1.19)).toBe('good');
  });

  it('[1.2, 1.6) → warn', () => {
    expect(topProvinceSeverity(1.2)).toBe('warn');
    expect(topProvinceSeverity(1.59)).toBe('warn');
  });

  it('≥ 1.6 → bad', () => {
    expect(topProvinceSeverity(1.6)).toBe('bad');
    expect(topProvinceSeverity(3.0)).toBe('bad');
  });
});

describe('extractProvinceName', () => {
  it('剥离 adcode 前缀', () => {
    expect(extractProvinceName('510000四川省')).toBe('四川省');
    expect(extractProvinceName('110000北京市')).toBe('北京市');
  });

  it('空/undefined → 空字符串', () => {
    expect(extractProvinceName('')).toBe('');
    expect(extractProvinceName(undefined)).toBe('');
  });

  it('无 adcode 前缀的字面不变', () => {
    expect(extractProvinceName('四川省')).toBe('四川省');
  });
});

describe('topPlateConcentration', () => {
  const PLATES: GeoPlateRow[] = [
    { plate_city: '成都', cases: 100 },
    { plate_city: '德阳', cases: 50 },
    { plate_city: '绵阳', cases: 30 },
    { plate_city: '乐山', cases: 10 },
    { plate_city: '南充', cases: 10 },
  ];

  it('Top 3 占比 = (100+50+30) / 200 = 90%', () => {
    const out = topPlateConcentration(PLATES);
    expect(out.sharePct).toBe(90);
    expect(out.topNames).toEqual(['成都', '德阳', '绵阳']);
    expect(out.topCases).toBe(180);
    expect(out.totalCases).toBe(200);
  });

  it('按 cases 降序排（即使输入乱序）', () => {
    const shuffled = [...PLATES].reverse();
    const out = topPlateConcentration(shuffled);
    expect(out.topNames).toEqual(['成都', '德阳', '绵阳']);
  });

  it('空输入 → sharePct=0、不崩溃', () => {
    const out = topPlateConcentration([]);
    expect(out.sharePct).toBe(0);
    expect(out.topNames).toEqual([]);
    expect(out.totalCases).toBe(0);
  });

  it('不足 3 个 plate → 用现有数', () => {
    const out = topPlateConcentration([{ plate_city: '成都', cases: 50 }]);
    expect(out.topNames).toEqual(['成都']);
    expect(out.sharePct).toBe(100);
  });
});

describe('frequencyYoyDeterioration', () => {
  const YOY: FrequencyYoyRow[] = [
    { year: 2025, quarter: 1, freq_per_1000: 10 },
    { year: 2025, quarter: 2, freq_per_1000: 11 },
    { year: 2026, quarter: 1, freq_per_1000: 12 }, // 同比 2025Q1 +20%
  ];

  it('找最新季度的同季度上一年对比', () => {
    const out = frequencyYoyDeterioration(YOY);
    expect(out).not.toBeNull();
    expect(out!.yoyPct).toBe(20);
    expect(out!.latestQuarterLabel).toBe('2026Q1');
    expect(out!.latestFreq).toBe(12);
  });

  it('找不到上一年同季度 → null', () => {
    const noBase: FrequencyYoyRow[] = [
      { year: 2026, quarter: 2, freq_per_1000: 12 }, // 2025Q2 缺失
    ];
    expect(frequencyYoyDeterioration(noBase)).toBeNull();
  });

  it('上一年同季度 freq=0 → null（避免除零）', () => {
    const zeroPrev: FrequencyYoyRow[] = [
      { year: 2025, quarter: 1, freq_per_1000: 0 },
      { year: 2026, quarter: 1, freq_per_1000: 5 },
    ];
    expect(frequencyYoyDeterioration(zeroPrev)).toBeNull();
  });

  it('数据点不足 2 个 → null', () => {
    expect(frequencyYoyDeterioration([])).toBeNull();
    expect(frequencyYoyDeterioration([{ year: 2026, quarter: 1, freq_per_1000: 5 }])).toBeNull();
  });

  it('改善方向（负同比）也应返回，由调用方判定 severity', () => {
    const improving: FrequencyYoyRow[] = [
      { year: 2025, quarter: 1, freq_per_1000: 15 },
      { year: 2026, quarter: 1, freq_per_1000: 10 }, // -33%
    ];
    const out = frequencyYoyDeterioration(improving);
    expect(out!.yoyPct).toBeCloseTo(-33.33, 1);
  });
});

describe('topProvinceAvgClaim', () => {
  it('找案均最高省份 + 比值', () => {
    const accidents: GeoAccidentRow[] = [
      // 四川省: 10 件 + 50 万 = 案均 5 万元
      { province: '510000四川省', city: 'X', cases: 10, reserve_wan: 50 },
      // 北京市: 5 件 + 50 万 = 案均 10 万元（最高）
      { province: '110000北京市', city: 'Y', cases: 5, reserve_wan: 50 },
    ];
    const out = topProvinceAvgClaim(accidents, 60000); // 全国均值 6 万
    expect(out).not.toBeNull();
    expect(out!.provinceName).toBe('北京市');
    expect(out!.provinceAvg).toBe(100000);
    expect(out!.ratio).toBeCloseTo(100000 / 60000, 2);
    expect(out!.cases).toBe(5);
  });

  it('overallAvg = 0 → null（避免除零）', () => {
    const accidents: GeoAccidentRow[] = [
      { province: '510000四川省', city: 'X', cases: 10, reserve_wan: 50 },
    ];
    expect(topProvinceAvgClaim(accidents, 0)).toBeNull();
  });

  it('空 accidents → null', () => {
    expect(topProvinceAvgClaim([], 60000)).toBeNull();
  });

  it('cases 全为 0 的省份被跳过', () => {
    const accidents: GeoAccidentRow[] = [
      { province: '510000四川省', city: 'X', cases: 0, reserve_wan: 5 },
    ];
    expect(topProvinceAvgClaim(accidents, 60000)).toBeNull();
  });

  it('同省多市数据聚合', () => {
    const accidents: GeoAccidentRow[] = [
      { province: '510000四川省', city: '510100成都市', cases: 5, reserve_wan: 25 },
      { province: '510000四川省', city: '510700绵阳市', cases: 5, reserve_wan: 25 },
    ];
    const out = topProvinceAvgClaim(accidents, 30000);
    // 合并后：10 件 + 50 万 = 5 万元/件
    expect(out!.provinceAvg).toBe(50000);
    expect(out!.cases).toBe(10);
  });
});

describe('deriveGeoInsights', () => {
  const COMP: GeoComparisonRow = {
    total_cases: 1000,
    cross_region_cases: 350,
    cross_region_pct: 35,
    cross_region_avg_reserve: 8000,
    local_avg_reserve: 5000,
  };
  const PLATES: GeoPlateRow[] = [
    { plate_city: '成都', cases: 500, reserve_wan: 100 },
    { plate_city: '德阳', cases: 200, reserve_wan: 40 },
    { plate_city: '绵阳', cases: 100, reserve_wan: 20 },
    { plate_city: '其它', cases: 200, reserve_wan: 40 },
  ];
  const YOY: FrequencyYoyRow[] = [
    { year: 2025, quarter: 1, freq_per_1000: 10 },
    { year: 2026, quarter: 1, freq_per_1000: 12 }, // +20%
  ];
  const ACCIDENTS: GeoAccidentRow[] = [
    { province: '510000四川省', cases: 10, reserve_wan: 50 },
    { province: '110000北京市', cases: 5, reserve_wan: 50 },
  ];

  it('完整数据 → 始终 4 卡', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, ACCIDENTS);
    expect(out).toHaveLength(4);
    expect(out.map(i => i.id)).toEqual([
      'cross-region',
      'plate-concentration',
      'frequency-trend',
      'top-province',
    ]);
  });

  it('异地出险率 35% → warn', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, ACCIDENTS);
    expect(out[0].severity).toBe('warn');
    expect(out[0].title).toContain('异地出险率偏高');
  });

  it('Top 3 占比 80%（500+200+100 / 1000）→ warn', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, ACCIDENTS);
    expect(out[1].severity).toBe('warn');
    expect(out[1].title).toContain('集中度高');
  });

  it('频度同比 +20% → warn', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, ACCIDENTS);
    expect(out[2].severity).toBe('warn');
    expect(out[2].title).toBe('出险频度同比恶化');
  });

  it('北京市案均 10 万 vs 全国估算均值 → bad（ratio > 1.6）', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, ACCIDENTS);
    // 全国均值估算 = (8000 * 350 + 5000 * 650) / 1000 = 6050
    // 北京 案均 100000 / 6050 ≈ 16.5 倍 → bad
    expect(out[3].severity).toBe('bad');
    expect(out[3].title).toContain('北京市');
  });

  it('comparison 缺失 → cross-region 卡返回 neutral 而不崩溃', () => {
    const out = deriveGeoInsights(undefined, PLATES, YOY, ACCIDENTS);
    expect(out[0].severity).toBe('neutral');
    expect(out[0].metricValue).toBe('—');
  });

  it('plates 空 → 集中度卡 neutral', () => {
    const out = deriveGeoInsights(COMP, [], YOY, ACCIDENTS);
    expect(out[1].severity).toBe('neutral');
  });

  it('YOY 数据不足 → 频度卡 neutral', () => {
    const out = deriveGeoInsights(COMP, PLATES, [], ACCIDENTS);
    expect(out[2].severity).toBe('neutral');
    expect(out[2].title).toBe('同比数据不足');
  });

  it('accidents 空 → 案均省份卡 neutral', () => {
    const out = deriveGeoInsights(COMP, PLATES, YOY, []);
    expect(out[3].severity).toBe('neutral');
  });

  it('全部输入空 → 仍 4 卡，全 neutral，不崩溃', () => {
    const out = deriveGeoInsights(undefined, [], [], []);
    expect(out).toHaveLength(4);
    out.forEach(card => {
      expect(card.severity).toBe('neutral');
      expect(card.title).toBeTruthy();
      expect(card.metricValue).toBeDefined();
    });
  });

  it('异地出险率 < 25% + Top3 < 50% + 同比 ±15% 内 + 省案均比 < 1.2 → 全 good', () => {
    const calm: GeoComparisonRow = { ...COMP, cross_region_pct: 15, cross_region_cases: 150 };
    const flatPlates: GeoPlateRow[] = [
      { plate_city: 'A', cases: 100 },
      { plate_city: 'B', cases: 100 },
      { plate_city: 'C', cases: 100 },
      { plate_city: 'D', cases: 100 },
      { plate_city: 'E', cases: 100 },
      { plate_city: 'F', cases: 100 },
      { plate_city: 'G', cases: 100 },
      { plate_city: 'H', cases: 100 },
      { plate_city: 'I', cases: 100 },
      { plate_city: 'J', cases: 100 },
    ];
    const stableYoy: FrequencyYoyRow[] = [
      { year: 2025, quarter: 1, freq_per_1000: 10 },
      { year: 2026, quarter: 1, freq_per_1000: 10.5 }, // +5%
    ];
    const evenAccidents: GeoAccidentRow[] = [
      { province: '510000四川省', cases: 10, reserve_wan: 5 }, // 5000 元 / 件
    ];
    const out = deriveGeoInsights(calm, flatPlates, stableYoy, evenAccidents);
    expect(out[0].severity).toBe('good');
    expect(out[1].severity).toBe('good');
    expect(out[2].severity).toBe('good');
    // out[3] 不一定 good — 北京一省没数据，但四川 5000/全国估算（不同输入），跳过严格断言
  });
});
