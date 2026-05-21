/**
 * 赔付率发展三角形 — 叙事横幅派生单元测试
 *
 * 覆盖：
 *   - 无数据：hero=null + neutral
 *   - 单 cohort：仅绝对值阈值（无 badge）
 *   - 双 cohort + prev.maxDev >= currM：完整 hero + badge
 *   - prev.maxDev < currM：不取 prev（防止口径错位）
 *   - 三种 metric 各自 severity 分支
 */
import { describe, expect, it } from 'vitest';
import { deriveHeadline } from './headline';
import type { CohortData } from './types';

function makeCohort(
  policyCount: number,
  premiumWan: number,
  monthVals: Array<Record<string, number>>,
): CohortData {
  const months: Record<number, any> = {};
  let maxDev = 0;
  for (const v of monthVals) {
    const m = v.dev_month;
    months[m] = v;
    if (m > maxDev) maxDev = m;
  }
  return { policyCount, premiumWan, maxDev, months };
}

describe('deriveHeadline — 边界', () => {
  it('无 cohort 数据：返回 neutral + hero=null', () => {
    const h = deriveHeadline({}, [], 'loss_ratio_pct');
    expect(h.severity).toBe('neutral');
    expect(h.tagLabel).toBe('暂无');
    expect(h.hero).toBeNull();
  });

  it('cohort 存在但指标 NULL：hero=null + neutral', () => {
    const cohorts = {
      2025: makeCohort(100, 500, [{ dev_month: 3 }]), // 无 loss_ratio_pct
    };
    const h = deriveHeadline(cohorts, [2025], 'loss_ratio_pct');
    expect(h.severity).toBe('neutral');
    expect(h.hero).toBeNull();
  });
});

describe('deriveHeadline — 单 cohort（无 prev）', () => {
  it('赔付率 80% > 70 → severity=bad，无 badge', () => {
    const cohorts = {
      2026: makeCohort(500, 2500, [{ dev_month: 5, loss_ratio_pct: 80 }]),
    };
    const h = deriveHeadline(cohorts, [2026], 'loss_ratio_pct');
    expect(h.severity).toBe('bad');
    expect(h.hero).not.toBeNull();
    expect(h.hero!.badge).toBeUndefined();
    expect(h.hero!.value).toBe('80.0');
    expect(h.hero!.unit).toBe('%');
    expect(h.headline).toContain('暂无同期可比 cohort');
  });

  it('出险率 60% > 50 但 < 70 → severity=warn', () => {
    const cohorts = {
      2026: makeCohort(500, 2500, [
        { dev_month: 5, incident_rate_pct: 60 },
      ]),
    };
    const h = deriveHeadline(cohorts, [2026], 'incident_rate_pct');
    expect(h.severity).toBe('warn');
  });
});

describe('deriveHeadline — 双 cohort + 同窗口可比', () => {
  it('2026 vs 2025 同 M5：完整 hero + badge', () => {
    const cohorts = {
      2025: makeCohort(1000, 5000, [
        { dev_month: 5, loss_ratio_pct: 40 },
        { dev_month: 12, loss_ratio_pct: 65 },
      ]),
      2026: makeCohort(500, 2500, [
        { dev_month: 5, loss_ratio_pct: 50 },
      ]),
    };
    const h = deriveHeadline(cohorts, [2025, 2026], 'loss_ratio_pct');
    // delta = 50 - 40 = +10pp → 不到 trendDeltaPp=15 → severity 仅看绝对值（50 < 70 → good）
    expect(h.severity).toBe('good');
    expect(h.hero!.badge).toBeDefined();
    expect(h.hero!.badge).toMatch(/\+10\.0pp/);
    expect(h.hero!.badge).toContain('2025');
    expect(h.headline).toContain('2026年第5月');
    expect(h.headline).toContain('2025年同期');
  });

  it('delta >= 15pp 恶化：severity=warn 且 headline 包含"恶化"', () => {
    const cohorts = {
      2025: makeCohort(1000, 5000, [{ dev_month: 5, loss_ratio_pct: 30 }]),
      2026: makeCohort(500, 2500, [{ dev_month: 5, loss_ratio_pct: 50 }]),
    };
    const h = deriveHeadline(cohorts, [2025, 2026], 'loss_ratio_pct');
    expect(h.severity).toBe('warn');
    expect(h.headline).toContain('恶化');
  });

  it('案均赔款用百分比差：badge 含 %', () => {
    const cohorts = {
      2025: makeCohort(1000, 5000, [{ dev_month: 5, avg_claim: 5000 }]),
      2026: makeCohort(500, 2500, [{ dev_month: 5, avg_claim: 7000 }]),
    };
    const h = deriveHeadline(cohorts, [2025, 2026], 'avg_claim');
    expect(h.hero!.badge).toMatch(/\+40\.0%/);
    expect(h.severity).toBe('warn');
  });

  it('案均赔款 prevVal=0 不能算涨幅：badge=undefined + headline 说明基期为零（codex P2-1）', () => {
    // 反例：早期发展月 prev cohort 尚无赔案（avg_claim=0）
    // 不能 fallback 到 pp 分支（会输出 "+5000.0pp vs 2024" 这种单位错误的徽章）
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 5, avg_claim: 0 }]),
      2026: makeCohort(500, 2500, [{ dev_month: 5, avg_claim: 5000 }]),
    };
    const h = deriveHeadline(cohorts, [2024, 2026], 'avg_claim');
    expect(h.hero).not.toBeNull();
    expect(h.hero!.badge).toBeUndefined();
    expect(h.headline).toContain('基期为零');
    expect(h.headline).toContain('2024');
    // 关键反断言：不出现 'pp' 这种错误单位
    expect(h.headline).not.toMatch(/pp/);
    expect(h.hero!.value).toBe('5,000'); // currVal 仍展示
  });
});

describe('deriveHeadline — prev cohort 选择口径', () => {
  it('prev.maxDev < currM：不取 prev（防止口径错位）', () => {
    // 2026 maxDev=5，2024 maxDev=3 < 5 → 不能比
    const cohorts = {
      2024: makeCohort(1000, 5000, [{ dev_month: 3, loss_ratio_pct: 30 }]),
      2026: makeCohort(500, 2500, [
        { dev_month: 3, loss_ratio_pct: 40 },
        { dev_month: 5, loss_ratio_pct: 60 },
      ]),
    };
    const h = deriveHeadline(cohorts, [2024, 2026], 'loss_ratio_pct');
    expect(h.hero!.badge).toBeUndefined();
    expect(h.headline).toContain('暂无同期可比 cohort');
  });

  it('多个 prev 候选：取最近一年（yr < currYr 中最大）', () => {
    const cohorts = {
      2023: makeCohort(1000, 5000, [{ dev_month: 5, loss_ratio_pct: 20 }]),
      2024: makeCohort(1000, 5000, [{ dev_month: 5, loss_ratio_pct: 35 }]),
      2026: makeCohort(500, 2500, [{ dev_month: 5, loss_ratio_pct: 50 }]),
    };
    const h = deriveHeadline(cohorts, [2023, 2024, 2026], 'loss_ratio_pct');
    expect(h.hero!.badge).toContain('2024'); // 不是 2023
    // delta = 50 - 35 = +15pp
    expect(h.hero!.badge).toMatch(/\+15\.0pp/);
  });
});

describe('deriveHeadline — coverage 提示', () => {
  it('coverage < 99.9：summary 含覆盖率', () => {
    const cohorts = {
      2026: makeCohort(1000, 5000, [
        { dev_month: 5, loss_ratio_pct: 50, coverage_pct: 85 },
      ]),
    };
    const h = deriveHeadline(cohorts, [2026], 'loss_ratio_pct');
    expect(h.summary).toContain('85%');
  });

  it('coverage = 100：summary 不含覆盖率', () => {
    const cohorts = {
      2024: makeCohort(1000, 5000, [
        { dev_month: 12, loss_ratio_pct: 50, coverage_pct: 100 },
      ]),
    };
    const h = deriveHeadline(cohorts, [2024], 'loss_ratio_pct');
    expect(h.summary).not.toContain('覆盖');
  });
});
