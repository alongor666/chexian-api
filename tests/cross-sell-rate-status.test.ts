import { describe, expect, it } from 'vitest';
import {
  classifyQuadrant,
  getJiaosanStatus,
  getRateClassByField,
  getRateStatusLabel,
  getZhuquanStatus,
  JIAOSAN_RATE_THRESHOLDS,
  JIAOSAN_THRESHOLD,
  MAIN_FULL_THRESHOLD,
  QUADRANT_META,
  ZHUQUAN_RATE_THRESHOLDS,
} from '../src/features/dashboard/crossSellRateStatus';
import { getMetricOrThrow } from '../server/src/config/metric-registry/index.js';

describe('cross-sell rate status rules', () => {
  it('前端阈值镜像必须与指标注册表 thresholds 同步（红线：阈值事实源在注册表）', () => {
    const zhuquan = getMetricOrThrow('cross_sell_zhuquan_rate').thresholds;
    const jiaosan = getMetricOrThrow('cross_sell_jiaosan_rate').thresholds;

    expect(zhuquan?.direction).toBe('lower_worse');
    expect(jiaosan?.direction).toBe('lower_worse');
    expect({ notice: zhuquan?.notice, warn: zhuquan?.warn, danger: zhuquan?.danger })
      .toEqual(ZHUQUAN_RATE_THRESHOLDS);
    expect({ notice: jiaosan?.notice, warn: jiaosan?.warn, danger: jiaosan?.danger })
      .toEqual(JIAOSAN_RATE_THRESHOLDS);

    // 四象限分界派生关系：主全取 warn，交三取 danger
    expect(MAIN_FULL_THRESHOLD).toBe(zhuquan?.warn);
    expect(JIAOSAN_THRESHOLD).toBe(jiaosan?.danger);
  });

  it('should classify zhuquan thresholds correctly', () => {
    expect(getZhuquanStatus(80)).toBe('excellent');
    expect(getZhuquanStatus(75)).toBe('healthy');
    expect(getZhuquanStatus(70)).toBe('abnormal');
    expect(getZhuquanStatus(69.99)).toBe('danger');
  });

  it('should classify jiaosan thresholds correctly', () => {
    expect(getJiaosanStatus(70)).toBe('excellent');
    expect(getJiaosanStatus(65)).toBe('healthy');
    expect(getJiaosanStatus(60)).toBe('abnormal');
    expect(getJiaosanStatus(59.99)).toBe('danger');
  });

  it('should return status labels and text classes', () => {
    expect(getRateStatusLabel('excellent')).toBe('优秀');
    expect(getRateStatusLabel('healthy')).toBe('健康');
    expect(getRateStatusLabel('abnormal')).toBe('异常');
    expect(getRateStatusLabel('danger')).toBe('危险');

    expect(getRateClassByField('zhuquan_rate', 85)).toContain('text-success');
    expect(getRateClassByField('jiaosan_rate', 55)).toContain('text-danger');
  });

  it('should classify quadrants and provide color metadata', () => {
    expect(classifyQuadrant(80, 70)).toBe('dual_excellent');
    expect(classifyQuadrant(70, 50)).toBe('dual_weak');
    expect(classifyQuadrant(80, 50)).toBe('main_excellent_jiaosan_weak');
    expect(classifyQuadrant(70, 70)).toBe('main_weak_jiaosan_excellent');

    expect(QUADRANT_META.dual_excellent.label).toContain('双优');
    expect(QUADRANT_META.dual_weak.label).toContain('双差');
  });
});
