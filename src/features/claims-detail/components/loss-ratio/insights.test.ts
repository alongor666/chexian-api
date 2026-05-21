/**
 * 赔付率发展三角形 — 阈值/洞察生成器单元测试
 *
 * 覆盖：
 *   - 阈值边界（lrInverted=100 / lrHigh=70 / irHigh=70 / irModerate=50 /
 *     trendDeltaPp=15 / anomalyMultiplier=3）的等号判定
 *   - 三种 metric 各自的 card 生成路径
 *   - 同期 cohort 选择规则（prev.maxDev >= compareM 否则跳过）
 *   - kind='card' vs 'note' 分离
 *   - id 稳定性（panel key 依赖）
 */
import { describe, expect, it } from 'vitest';
import {
  LOSS_RATIO_THRESHOLDS,
  deriveLossRatioInsights,
} from './insights';
import type { CohortData } from './types';

/** 构造 cohort fixture 的工具 */
function makeCohort(
  policyCount: number,
  premiumWan: number,
  monthVals: Array<Partial<{
    dev_month: number;
    loss_ratio_pct: number;
    incident_rate_pct: number;
    avg_claim: number;
    coverage_pct: number;
  }>>,
): CohortData {
  const months: Record<number, any> = {};
  let maxDev = 0;
  for (const v of monthVals) {
    const m = v.dev_month!;
    months[m] = v;
    if (m > maxDev) maxDev = m;
  }
  return { policyCount, premiumWan, maxDev, months };
}

describe('deriveLossRatioInsights — 赔付率', () => {
  it('阈值边界 lrInverted=100：> 100 才算倒挂（=100 不算）', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [
        { dev_month: 12, loss_ratio_pct: 100, coverage_pct: 100 },
      ]),
      2025: makeCohort(1000, 5000, [
        { dev_month: 12, loss_ratio_pct: 100.1, coverage_pct: 100 },
      ]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const inverted = items.find(i => i.id.startsWith('lr-inverted'));
    expect(inverted).toBeDefined();
    // 2024 (=100) 不算，只有 2025 (=100.1) 进入
    expect(inverted!.id).toBe('lr-inverted-2025');
    expect(inverted!.severity).toBe('bad');
    expect(inverted!.iconKey).toBe('alert');
  });

  it('阈值边界 lrHigh=70：> 70 才算偏高', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 70 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 70.5 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const high = items.find(i => i.id.startsWith('lr-high'));
    expect(high).toBeDefined();
    expect(high!.id).toBe('lr-high-2025');
  });

  it('趋势 delta >= 15pp：恶化 → severity=warn + iconKey=trendUp', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 50 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 65 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const trend = items.find(i => i.id.startsWith('lr-trend'));
    expect(trend).toBeDefined();
    expect(trend!.severity).toBe('warn');
    expect(trend!.iconKey).toBe('trendUp');
    expect(trend!.metricValue).toMatch(/^\+15\.0/);
  });

  it('趋势 delta <= -15pp：改善 → severity=good + iconKey=trendDown', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 80 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 65 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const trend = items.find(i => i.id.startsWith('lr-trend'));
    expect(trend).toBeDefined();
    expect(trend!.severity).toBe('good');
    expect(trend!.iconKey).toBe('trendDown');
  });

  it('趋势 delta < 15pp 但两端均 > lrHigh：高位震荡 → iconKey=shockwave', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 75 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 80 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const shock = items.find(i => i.id.startsWith('lr-shock'));
    expect(shock).toBeDefined();
    expect(shock!.iconKey).toBe('shockwave');
  });
});

describe('deriveLossRatioInsights — 出险率', () => {
  it('阈值边界 irHigh=70：> 70 → severity=bad', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, incident_rate_pct: 70 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, incident_rate_pct: 70.5 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'incident_rate_pct');
    const high = items.find(i => i.id.startsWith('ir-high'));
    expect(high).toBeDefined();
    expect(high!.severity).toBe('bad');
  });

  it('阈值边界 irModerate=50：(50, 70] → severity=warn + iconKey=flame', () => {
    const cohorts = {
      2025: makeCohort(1000, 5000, [{ dev_month: 12, incident_rate_pct: 50.1 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2025], 'incident_rate_pct');
    const mod = items.find(i => i.id.startsWith('ir-mod'));
    expect(mod).toBeDefined();
    expect(mod!.severity).toBe('warn');
    expect(mod!.iconKey).toBe('flame');
  });
});

describe('deriveLossRatioInsights — 案均赔款', () => {
  it('异常尖峰阈值 anomalyMultiplier=3：peak > 3×mean → iconKey=zap', () => {
    const cohorts = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 1, avg_claim: 10000 },
        { dev_month: 2, avg_claim: 10000 },
        { dev_month: 3, avg_claim: 40000 }, // peak=40000, mean=20000, ratio=2 ← 不触发
      ]),
    };
    let items = deriveLossRatioInsights(cohorts, [2025], 'avg_claim');
    expect(items.find(i => i.id.startsWith('ac-spike'))).toBeUndefined();

    const cohorts2 = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 1, avg_claim: 10000 },
        { dev_month: 2, avg_claim: 10000 },
        { dev_month: 3, avg_claim: 70000 }, // mean=30000, ratio≈2.33 ← 不触发
      ]),
    };
    items = deriveLossRatioInsights(cohorts2, [2025], 'avg_claim');
    expect(items.find(i => i.id.startsWith('ac-spike'))).toBeUndefined();

    const cohorts3 = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 1, avg_claim: 10000 },
        { dev_month: 2, avg_claim: 10000 },
        { dev_month: 3, avg_claim: 100000 }, // mean=40000, ratio=2.5 ← 不触发
      ]),
    };
    items = deriveLossRatioInsights(cohorts3, [2025], 'avg_claim');
    expect(items.find(i => i.id.startsWith('ac-spike'))).toBeUndefined();

    const cohorts4 = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 1, avg_claim: 10000 },
        { dev_month: 2, avg_claim: 10000 },
        { dev_month: 3, avg_claim: 150000 }, // mean≈56666, ratio≈2.65 ← 不触发
      ]),
    };
    items = deriveLossRatioInsights(cohorts4, [2025], 'avg_claim');
    expect(items.find(i => i.id.startsWith('ac-spike'))).toBeUndefined();

    const cohorts5 = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 1, avg_claim: 10000 },
        { dev_month: 2, avg_claim: 10000 },
        { dev_month: 3, avg_claim: 10000 },
        { dev_month: 4, avg_claim: 200000 }, // mean=57500, ratio≈3.47 ← 触发
      ]),
    };
    items = deriveLossRatioInsights(cohorts5, [2025], 'avg_claim');
    const spike = items.find(i => i.id.startsWith('ac-spike'));
    expect(spike).toBeDefined();
    expect(spike!.iconKey).toBe('zap');
    expect(spike!.severity).toBe('warn');
  });

  it('趋势 growthPct >= 40%：iconKey=trendUp', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, avg_claim: 5000 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, avg_claim: 7500 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'avg_claim');
    const trend = items.find(i => i.id.startsWith('ac-trend'));
    expect(trend).toBeDefined();
    expect(trend!.iconKey).toBe('trendUp');
    expect(trend!.severity).toBe('warn');
  });
});

describe('deriveLossRatioInsights — 同期 cohort 选择', () => {
  it('compare：必须有 prev.maxDev >= currM 的 prev，否则不出 note', () => {
    // 2026 maxDev=3，2024 maxDev=12 满足 ≥ 3
    const cohorts = {
      2024: makeCohort(1000, 5000, [
        { dev_month: 3, loss_ratio_pct: 30 },
        { dev_month: 12, loss_ratio_pct: 65 },
      ]),
      2026: makeCohort(500, 2500, [{ dev_month: 3, loss_ratio_pct: 50 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2026], 'loss_ratio_pct');
    const compare = items.find(i => i.id.includes('-compare-2026-2024'));
    expect(compare).toBeDefined();
    expect(compare!.kind).toBe('note');
    expect(compare!.iconKey).toBe('compare');
  });

  it('compare：所有 prev.maxDev < currM → 不出 note（防止口径错位）', () => {
    // 2025 是 early (maxDev=4 < 6)，但 2024 maxDev=2 < currM=4 → 不能比
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 2, loss_ratio_pct: 30 }]),
      2025: makeCohort(500, 2500, [
        { dev_month: 1, loss_ratio_pct: 50 },
        { dev_month: 2, loss_ratio_pct: 60 },
        { dev_month: 3, loss_ratio_pct: 70 },
        { dev_month: 4, loss_ratio_pct: 80 },
      ]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    expect(items.find(i => i.id.includes('-compare-'))).toBeUndefined();
  });
});

describe('deriveLossRatioInsights — 排序 + 分类', () => {
  it('排序：card 在前（bad > warn > good > neutral），note 在后', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [
        { dev_month: 3, loss_ratio_pct: 30 },
        { dev_month: 12, loss_ratio_pct: 120 }, // 倒挂 → bad
      ]),
      2025: makeCohort(1000, 5000, [
        { dev_month: 12, loss_ratio_pct: 50 },
      ]),
      2026: makeCohort(500, 2500, [{ dev_month: 3, loss_ratio_pct: 80 }]),
    };
    const items = deriveLossRatioInsights(cohorts, [2024, 2025, 2026], 'loss_ratio_pct');
    const cards = items.filter(i => i.kind === 'card');
    const notes = items.filter(i => i.kind === 'note');
    // 所有 card 都排在 note 前
    expect(items.slice(0, cards.length).every(i => i.kind === 'card')).toBe(true);
    expect(items.slice(cards.length).every(i => i.kind === 'note')).toBe(true);
    // card 内部按 severity 升序（bad → warn → good）
    if (cards.length >= 2) {
      const SEV_ORDER = { bad: 0, warn: 1, good: 2, neutral: 3 };
      for (let i = 1; i < cards.length; i++) {
        expect(SEV_ORDER[cards[i].severity]).toBeGreaterThanOrEqual(
          SEV_ORDER[cards[i - 1].severity],
        );
      }
    }
    // early cohort 必出 info note
    expect(notes.find(n => n.iconKey === 'info' && n.id === 'early-2026')).toBeDefined();
  });

  it('全部空数据：返回空数组（不抛错）', () => {
    expect(deriveLossRatioInsights({}, [], 'loss_ratio_pct')).toEqual([]);
  });

  it('id 稳定性：同一 cohort 调两次输出 id 集合相同', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 80 }]),
      2025: makeCohort(1000, 5000, [{ dev_month: 12, loss_ratio_pct: 110 }]),
    };
    const a = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    const b = deriveLossRatioInsights(cohorts, [2024, 2025], 'loss_ratio_pct');
    expect(a.map(i => i.id).sort()).toEqual(b.map(i => i.id).sort());
  });
});

describe('LOSS_RATIO_THRESHOLDS 常量', () => {
  it('与原 utils/devInsightRules.ts 保持业务对齐', () => {
    expect(LOSS_RATIO_THRESHOLDS.lrInverted).toBe(100);
    expect(LOSS_RATIO_THRESHOLDS.lrHigh).toBe(70);
    expect(LOSS_RATIO_THRESHOLDS.irHigh).toBe(70);
    expect(LOSS_RATIO_THRESHOLDS.irModerate).toBe(50);
    expect(LOSS_RATIO_THRESHOLDS.trendDeltaPp).toBe(15);
    expect(LOSS_RATIO_THRESHOLDS.anomalyMultiplier).toBe(3);
    expect(LOSS_RATIO_THRESHOLDS.compareDeltaPp).toBe(15);
    expect(LOSS_RATIO_THRESHOLDS.avgClaimGrowthPct).toBe(40);
    expect(LOSS_RATIO_THRESHOLDS.avgClaimComparePct).toBe(30);
    expect(LOSS_RATIO_THRESHOLDS.minDevForAlert).toBe(6);
  });
});
