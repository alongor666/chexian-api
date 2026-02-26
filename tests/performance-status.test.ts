import { describe, expect, it } from 'vitest';
import {
  classifyAchievementBand,
  classifyGrowthBand,
  classifyPerformanceQuadrant,
  getAchievementBandLabel,
  getGrowthBandLabel,
  PERFORMANCE_ACHIEVEMENT_THRESHOLD,
  PERFORMANCE_GROWTH_THRESHOLD,
} from '../src/features/dashboard/performanceStatus';

describe('performance status rules', () => {
  it('should classify achievement boundaries correctly', () => {
    expect(classifyAchievementBand(105)).toBe('ge_105');
    expect(classifyAchievementBand(104.99)).toBe('ge_100');
    expect(classifyAchievementBand(100)).toBe('ge_100');
    expect(classifyAchievementBand(99.99)).toBe('ge_95');
    expect(classifyAchievementBand(95)).toBe('ge_95');
    expect(classifyAchievementBand(94.99)).toBe('ge_90');
    expect(classifyAchievementBand(90)).toBe('ge_90');
    expect(classifyAchievementBand(89.99)).toBe('lt_90');
    expect(classifyAchievementBand(null)).toBe('no_plan');
  });

  it('should classify growth boundaries correctly', () => {
    expect(classifyGrowthBand(15)).toBe('excellent');
    expect(classifyGrowthBand(14.99)).toBe('healthy');
    expect(classifyGrowthBand(10)).toBe('healthy');
    expect(classifyGrowthBand(9.99)).toBe('abnormal');
    expect(classifyGrowthBand(5)).toBe('abnormal');
    expect(classifyGrowthBand(4.99)).toBe('danger');
    expect(classifyGrowthBand(0)).toBe('danger');
    expect(classifyGrowthBand(-0.01)).toBe('negative');
    expect(classifyGrowthBand(undefined)).toBe('unknown');
  });

  it('should provide expected labels', () => {
    expect(getAchievementBandLabel('ge_105')).toBe('>=105%');
    expect(getAchievementBandLabel('ge_100')).toBe('100%-105%');
    expect(getAchievementBandLabel('ge_95')).toBe('95%-100%');
    expect(getAchievementBandLabel('ge_90')).toBe('90%-95%');
    expect(getAchievementBandLabel('lt_90')).toBe('<90%');

    expect(getGrowthBandLabel('excellent')).toBe('优秀');
    expect(getGrowthBandLabel('healthy')).toBe('健康');
    expect(getGrowthBandLabel('abnormal')).toBe('异常');
    expect(getGrowthBandLabel('danger')).toBe('危险');
    expect(getGrowthBandLabel('negative')).toBe('负增长');
  });

  it('should classify performance quadrant boundaries', () => {
    expect(
      classifyPerformanceQuadrant(PERFORMANCE_ACHIEVEMENT_THRESHOLD, PERFORMANCE_GROWTH_THRESHOLD)
    ).toBe('high_growth_high_achievement');
    expect(
      classifyPerformanceQuadrant(PERFORMANCE_ACHIEVEMENT_THRESHOLD - 0.01, PERFORMANCE_GROWTH_THRESHOLD)
    ).toBe('high_growth_low_achievement');
    expect(
      classifyPerformanceQuadrant(PERFORMANCE_ACHIEVEMENT_THRESHOLD, PERFORMANCE_GROWTH_THRESHOLD - 0.01)
    ).toBe('low_growth_high_achievement');
    expect(
      classifyPerformanceQuadrant(PERFORMANCE_ACHIEVEMENT_THRESHOLD - 0.01, PERFORMANCE_GROWTH_THRESHOLD - 0.01)
    ).toBe('low_growth_low_achievement');
    expect(classifyPerformanceQuadrant(null, 10)).toBe('unknown');
  });
});
