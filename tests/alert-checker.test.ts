/**
 * 预警检测引擎单元测试
 *
 * @module alert-checker.test
 * @author @claude
 * @since 2026-01-14
 */

import { describe, it, expect } from 'vitest';
import {
  checkGrowthDecline,
  checkTargetProgress,
  checkRenewalRateDrop,
  checkPremiumSpike,
  checkPolicyCountDrop,
  runAlertChecks,
  calculateAlertSummary,
  calculateTimeProgress,
  createTargetProgress,
  type AlertCheckData,
} from '../src/shared/utils/alertChecker';
import type { AlertRule, TargetProgress } from '../src/shared/types/alert';
import { DEFAULT_ALERT_RULES } from '../src/shared/types/alert';

describe('预警检测引擎 (Alert Checker)', () => {
  describe('checkGrowthDecline - 增长率下降检测', () => {
    it('应检测到严重下降（-20%以下）', () => {
      const result = checkGrowthDecline(80, 100, '机构A');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.type).toBe('growth_decline');
      expect(result?.dimension).toBe('机构A');
    });

    it('应检测到警告下降（-10%到-20%之间）', () => {
      const result = checkGrowthDecline(85, 100, '机构B');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });

    it('小幅下降不应触发预警', () => {
      const result = checkGrowthDecline(95, 100, '机构C');
      expect(result).toBeNull();
    });

    it('增长情况不应触发预警', () => {
      const result = checkGrowthDecline(120, 100, '机构D');
      expect(result).toBeNull();
    });

    it('基期为0时不应崩溃', () => {
      const result = checkGrowthDecline(100, 0, '机构E');
      expect(result).toBeNull();
    });
  });

  describe('checkTargetProgress - 目标进度检测', () => {
    it('应检测到目标落后严重（-20%以下）', () => {
      const progress: TargetProgress = {
        type: 'annual',
        target: 1000000,
        current: 300000,
        achievementRate: 0.3,
        timeProgress: 0.6,
        progressGap: -0.3,
      };
      const result = checkTargetProgress(progress);
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.type).toBe('target_behind');
    });

    it('应检测到目标落后警告（-10%到-20%之间）', () => {
      const progress: TargetProgress = {
        type: 'monthly',
        target: 100000,
        current: 40000,
        achievementRate: 0.4,
        timeProgress: 0.55,
        progressGap: -0.15,
      };
      const result = checkTargetProgress(progress);
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });

    it('应检测到目标达成', () => {
      const progress: TargetProgress = {
        type: 'monthly',
        target: 100000,
        current: 120000,
        achievementRate: 1.2,
        timeProgress: 0.8,
        progressGap: 0.4,
      };
      const result = checkTargetProgress(progress);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('target_achievement');
      expect(result?.level).toBe('info');
    });

    it('进度正常不应触发预警', () => {
      const progress: TargetProgress = {
        type: 'annual',
        target: 1000000,
        current: 550000,
        achievementRate: 0.55,
        timeProgress: 0.5,
        progressGap: 0.05,
      };
      const result = checkTargetProgress(progress);
      expect(result).toBeNull();
    });
  });

  describe('checkRenewalRateDrop - 续保率下降检测', () => {
    it('应检测到续保率严重下降（-10%以下）', () => {
      const result = checkRenewalRateDrop(0.65, 0.8, '机构F');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.type).toBe('renewal_rate_drop');
    });

    it('应检测到续保率警告下降（-5%到-10%之间）', () => {
      const result = checkRenewalRateDrop(0.72, 0.8, '机构G');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });

    it('小幅波动不应触发预警', () => {
      const result = checkRenewalRateDrop(0.78, 0.8, '机构H');
      expect(result).toBeNull();
    });
  });

  describe('checkPremiumSpike - 保费异常波动检测', () => {
    it('应检测到严重波动（100%以上）', () => {
      const result = checkPremiumSpike(250000, 100000, '机构I');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.type).toBe('premium_spike');
    });

    it('应检测到警告波动（50%-100%）', () => {
      const result = checkPremiumSpike(160000, 100000, '机构J');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });

    it('正常波动不应触发预警', () => {
      const result = checkPremiumSpike(120000, 100000, '机构K');
      expect(result).toBeNull();
    });

    it('应检测到负向波动', () => {
      const result = checkPremiumSpike(30000, 100000, '机构L');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });
  });

  describe('checkPolicyCountDrop - 件数下降检测', () => {
    it('应检测到件数严重下降', () => {
      const result = checkPolicyCountDrop(70, 100, '机构M');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
      expect(result?.type).toBe('policy_count_drop');
    });

    it('应检测到件数警告下降', () => {
      const result = checkPolicyCountDrop(85, 100, '机构N');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('warning');
    });
  });

  describe('runAlertChecks - 批量检测', () => {
    it('应正确处理多维度数据', () => {
      const data: AlertCheckData[] = [
        {
          dimension: '机构A',
          currentPremium: 70000,
          previousPremium: 100000, // -30% 严重
          currentCount: 85,
          previousCount: 100, // -15% 警告
        },
        {
          dimension: '机构B',
          currentPremium: 110000,
          previousPremium: 100000, // +10% 正常
          currentRenewalRate: 0.6,
          previousRenewalRate: 0.8, // -25% 严重
        },
      ];

      const alerts = runAlertChecks(data);

      // 应该有 3 条预警（机构A保费严重+件数警告，机构B续保率严重）
      expect(alerts.length).toBeGreaterThanOrEqual(3);

      // 应按严重程度排序
      const criticalFirst = alerts.findIndex(a => a.level === 'critical');
      const warningFirst = alerts.findIndex(a => a.level === 'warning');
      expect(criticalFirst).toBeLessThan(warningFirst);
    });

    it('应正确处理空数据', () => {
      const alerts = runAlertChecks([]);
      expect(alerts).toEqual([]);
    });

    it('应正确处理目标进度', () => {
      const data: AlertCheckData[] = [
        {
          dimension: '整体',
          targetProgress: {
            type: 'annual',
            target: 1000000,
            current: 300000,
            achievementRate: 0.3,
            timeProgress: 0.6,
            progressGap: -0.3,
          },
        },
      ];

      const alerts = runAlertChecks(data);
      expect(alerts.some(a => a.type === 'target_behind')).toBe(true);
    });
  });

  describe('calculateAlertSummary - 摘要计算', () => {
    it('应正确计算摘要', () => {
      const alerts = [
        { id: '1', type: 'growth_decline' as const, level: 'critical' as const, title: '', description: '', timestamp: new Date(), read: false, resolved: false },
        { id: '2', type: 'target_behind' as const, level: 'warning' as const, title: '', description: '', timestamp: new Date(), read: true, resolved: false },
        { id: '3', type: 'renewal_rate_drop' as const, level: 'info' as const, title: '', description: '', timestamp: new Date(), read: false, resolved: false },
      ];

      const summary = calculateAlertSummary(alerts);

      expect(summary.total).toBe(3);
      expect(summary.byLevel.critical).toBe(1);
      expect(summary.byLevel.warning).toBe(1);
      expect(summary.byLevel.info).toBe(1);
      expect(summary.byType.growth_decline).toBe(1);
      expect(summary.byType.target_behind).toBe(1);
      expect(summary.byType.renewal_rate_drop).toBe(1);
      expect(summary.unread).toBe(2);
    });

    it('应正确处理空列表', () => {
      const summary = calculateAlertSummary([]);
      expect(summary.total).toBe(0);
      expect(summary.unread).toBe(0);
    });
  });

  describe('calculateTimeProgress - 时间进度计算', () => {
    it('应正确计算年度进度（年中）', () => {
      // 7月1日大约是年度的 50%
      const progress = calculateTimeProgress('annual', new Date(2026, 6, 1));
      expect(progress).toBeGreaterThan(0.49);
      expect(progress).toBeLessThan(0.52);
    });

    it('应正确计算月度进度（月中）', () => {
      // 1月15日大约是月度的 50%
      const progress = calculateTimeProgress('monthly', new Date(2026, 0, 15));
      expect(progress).toBeGreaterThan(0.45);
      expect(progress).toBeLessThan(0.52);
    });

    it('应正确计算季度进度（季中）', () => {
      // 2月15日大约是Q1的 50%
      const progress = calculateTimeProgress('quarterly', new Date(2026, 1, 15));
      expect(progress).toBeGreaterThan(0.45);
      expect(progress).toBeLessThan(0.55);
    });

    it('应正确处理年初', () => {
      const progress = calculateTimeProgress('annual', new Date(2026, 0, 1));
      expect(progress).toBeLessThan(0.01);
    });

    it('应正确处理年末', () => {
      const progress = calculateTimeProgress('annual', new Date(2026, 11, 31));
      expect(progress).toBeGreaterThan(0.99);
    });
  });

  describe('createTargetProgress - 目标进度创建', () => {
    it('应正确创建年度目标进度', () => {
      const progress = createTargetProgress(
        'annual',
        1000000,
        500000,
        '整体',
        new Date(2026, 6, 1) // 7月1日
      );

      expect(progress.type).toBe('annual');
      expect(progress.target).toBe(1000000);
      expect(progress.current).toBe(500000);
      expect(progress.achievementRate).toBe(0.5);
      expect(progress.timeProgress).toBeGreaterThan(0.49);
      expect(progress.timeProgress).toBeLessThan(0.52);
      expect(progress.progressGap).toBeCloseTo(0, 1);
      expect(progress.projectedValue).toBeDefined();
    });

    it('应正确创建月度目标进度', () => {
      const progress = createTargetProgress(
        'monthly',
        100000,
        60000,
        '机构A',
        new Date(2026, 0, 20) // 1月20日
      );

      expect(progress.type).toBe('monthly');
      expect(progress.achievementRate).toBe(0.6);
      // 月度目标不计算projectedValue
      expect(progress.projectedValue).toBeUndefined();
    });

    it('目标为0时不应崩溃', () => {
      const progress = createTargetProgress('annual', 0, 100000, '机构B');
      expect(progress.achievementRate).toBe(0);
    });
  });

  describe('自定义规则', () => {
    it('应支持自定义阈值', () => {
      const customRules: AlertRule[] = [
        {
          id: 'custom_growth',
          name: '自定义增长率',
          type: 'growth_decline',
          enabled: true,
          threshold: {
            warning: -0.05, // 更敏感：5%即警告
            critical: -0.1, // 10%即严重
          },
        },
      ];

      // 使用默认规则不会触发
      const defaultResult = checkGrowthDecline(92, 100, '机构X');
      expect(defaultResult).toBeNull();

      // 使用自定义规则会触发
      const customResult = checkGrowthDecline(92, 100, '机构X', customRules);
      expect(customResult).not.toBeNull();
      expect(customResult?.level).toBe('warning');
    });

    it('应支持禁用规则', () => {
      const disabledRules: AlertRule[] = [
        {
          id: 'disabled_growth',
          name: '禁用的增长率',
          type: 'growth_decline',
          enabled: false, // 已禁用
          threshold: { warning: -0.1, critical: -0.2 },
        },
      ];

      const result = checkGrowthDecline(70, 100, '机构Y', disabledRules);
      expect(result).toBeNull();
    });
  });
});
