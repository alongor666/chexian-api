/**
 * 已赚保费计算指引组件
 * Earned Premium Calculation Guide Component
 *
 * 用图文并茂的方式展示：
 * - 滚动12个月财务口径概念
 * - 六种保单情形及其计算规则
 * - 首日费用归属原则
 * - 时间分摊计算方法
 * - 实际计算案例
 */

import React, { useState, useMemo } from 'react';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import { colorClasses, cn } from '../../../shared/styles';

/**
 * 计算滚动12个月窗口的起始日期
 * 原定义位于 shared/sql/cost.ts，已迁移至本地
 */
function getRolling12MonthWindowStart(cutoffDate: string): string {
  const [year, month, day] = cutoffDate.split('-').map((v) => Number(v));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 364);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface EarnedPremiumGuideProps {
  cutoffDate: string;
  defaultExpanded?: boolean;
}

/**
 * 时间轴可视化组件 - 展示滚动12个月窗口
 */
const TimelineVisualization: React.FC<{ cutoffDate: string }> = ({ cutoffDate }) => {
  const windowInfo = useMemo(() => {
    return {
      cutoff: cutoffDate,
      windowStart: getRolling12MonthWindowStart(cutoffDate),
    };
  }, [cutoffDate]);

  return (
    <div className={cn("bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border", colorClasses.border.primary)}>
      <h4 className={cn("text-sm font-semibold mb-3 flex items-center gap-2", colorClasses.text.primary)}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        滚动12个月统计窗口
      </h4>

      {/* 时间轴图示 */}
      <div className="relative py-6">
        {/* 主轴线 */}
        <div className={cn("absolute left-0 right-0 top-1/2 h-1 rounded", colorClasses.bg.neutral)} />

        {/* 统计窗口高亮区域 */}
        <div className="absolute left-[10%] right-[10%] top-1/2 h-2 bg-primary rounded -translate-y-1/2" />

        {/* 窗口开始标记 */}
        <div className="absolute left-[10%] top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-4 h-4 bg-primary-dark rounded-full border-2 border-white shadow" />
          <div className="mt-6 text-xs text-center">
            <div className={cn("font-medium", colorClasses.text.primary)}>窗口开始</div>
            <div className={colorClasses.text.neutral}>{windowInfo.windowStart}</div>
          </div>
        </div>

        {/* 统计日标记 */}
        <div className="absolute left-[90%] top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="w-4 h-4 bg-indigo-600 rounded-full border-2 border-white shadow" />
          <div className="mt-6 text-xs text-center">
            <div className="font-medium text-indigo-700">统计日</div>
            <div className={colorClasses.text.neutral}>{windowInfo.cutoff}</div>
          </div>
        </div>

        {/* 365天标注 */}
        <div className={cn("absolute left-1/2 -translate-x-1/2 -top-2 text-xs font-medium", colorClasses.text.primary)}>
          ← 365天 →
        </div>
      </div>

      {/* 公式说明 */}
      <div className="mt-4 p-3 bg-white/70 rounded text-sm">
        <code className={colorClasses.text.primary}>窗口开始日 = 统计日 - 365天 + 1天</code>
        <p className={cn("mt-1 text-xs", colorClasses.text.neutral)}>
          只有在此窗口内有"在保期间"的保单，才会计入本期已赚保费
        </p>
      </div>
    </div>
  );
};

/**
 * 保单情形图示组件
 */
const PolicyScenarioCard: React.FC<{
  scenario: number;
  title: string;
  description: string;
  firstDayIncluded: boolean;
  timeDays: string;
  svgContent: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}> = ({ scenario, title, description, firstDayIncluded, timeDays, svgContent, isActive, onClick }) => {
  return (
    <div
      className={cn(`p-3 rounded-lg border-2 cursor-pointer transition-all`, isActive
        ? `border-blue-500 ${colorClasses.bg.primary} shadow-md`
        : `${colorClasses.border.neutral} bg-white hover:border-blue-300 hover:shadow`
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={cn(`text-xs font-bold px-2 py-0.5 rounded`, isActive
          ? 'bg-blue-500 text-white'
          : `${colorClasses.bg.neutralLight} ${colorClasses.text.neutral}`
        )}>
          情形{scenario}
        </span>
        <span className={cn('text-xs', firstDayIncluded ? colorClasses.text.success : colorClasses.text.danger)}>
          首日费用{firstDayIncluded ? '✓' : '✗'}
        </span>
      </div>
      <h5 className={cn("text-sm font-medium mb-1", colorClasses.text.neutralBlack)}>{title}</h5>
      <p className={cn("text-xs mb-2", colorClasses.text.neutral)}>{description}</p>

      {/* SVG图示 */}
      <div className={cn("h-12 flex items-center justify-center rounded mb-2", colorClasses.bg.neutral)}>
        {svgContent}
      </div>

      <div className={cn("text-xs", colorClasses.text.neutral)}>
        <span className="font-medium">时间分摊天数：</span>{timeDays}
      </div>
    </div>
  );
};

/**
 * 六种保单情形展示
 */
const PolicyScenariosSection: React.FC<{
  activeScenario: number;
  setActiveScenario: (s: number) => void;
}> = ({ activeScenario, setActiveScenario }) => {
  const scenarios = [
    {
      scenario: 1,
      title: '窗口内起保、窗口内到期',
      description: '完整周期在窗口内',
      firstDayIncluded: true,
      timeDays: '起保日 → 止期',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="20" y="10" width="160" height="10" fill="#E5E7EB" rx="2" />
          <rect x="50" y="10" width="100" height="10" fill="#3B82F6" rx="2" />
          <circle cx="50" cy="15" r="4" fill="#10B981" />
          <circle cx="150" cy="15" r="4" fill="#EF4444" />
          <text x="50" y="28" fontSize="8" fill="#6B7280" textAnchor="middle">起保</text>
          <text x="150" y="28" fontSize="8" fill="#6B7280" textAnchor="middle">止期</text>
        </svg>
      ),
    },
    {
      scenario: 2,
      title: '窗口内起保、窗口后到期',
      description: '新单未满期',
      firstDayIncluded: true,
      timeDays: '起保日 → 统计日',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="20" y="10" width="160" height="10" fill="#E5E7EB" rx="2" />
          <rect x="100" y="10" width="80" height="10" fill="#3B82F6" rx="2" />
          <rect x="180" y="10" width="15" height="10" fill="#FCD34D" rx="2" />
          <circle cx="100" cy="15" r="4" fill="#10B981" />
          <circle cx="180" cy="15" r="4" fill="#6366F1" />
          <text x="100" y="28" fontSize="8" fill="#6B7280" textAnchor="middle">起保</text>
          <text x="180" y="28" fontSize="8" fill="#6B7280" textAnchor="middle">统计日</text>
        </svg>
      ),
    },
    {
      scenario: 3,
      title: '窗口前起保、窗口内到期',
      description: '跨窗口前边界',
      firstDayIncluded: false,
      timeDays: '窗口开始 → 止期',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="20" y="10" width="160" height="10" fill="#E5E7EB" rx="2" />
          <rect x="5" y="10" width="15" height="10" fill="#FCD34D" rx="2" />
          <rect x="20" y="10" width="100" height="10" fill="#3B82F6" rx="2" />
          <circle cx="5" cy="15" r="4" fill="#10B981" />
          <circle cx="20" cy="15" r="4" fill="#6366F1" />
          <circle cx="120" cy="15" r="4" fill="#EF4444" />
          <text x="5" y="28" fontSize="7" fill="#6B7280" textAnchor="middle">起保</text>
          <text x="20" y="5" fontSize="7" fill="#6B7280" textAnchor="middle">窗口始</text>
          <text x="120" y="28" fontSize="8" fill="#6B7280" textAnchor="middle">止期</text>
        </svg>
      ),
    },
    {
      scenario: 4,
      title: '窗口前起保、窗口后到期',
      description: '横跨整个窗口',
      firstDayIncluded: false,
      timeDays: '窗口开始 → 统计日',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="20" y="10" width="160" height="10" fill="#3B82F6" rx="2" />
          <rect x="5" y="10" width="15" height="10" fill="#FCD34D" rx="2" />
          <rect x="180" y="10" width="15" height="10" fill="#FCD34D" rx="2" />
          <circle cx="5" cy="15" r="4" fill="#10B981" />
          <circle cx="20" cy="15" r="4" fill="#6366F1" />
          <circle cx="180" cy="15" r="4" fill="#6366F1" />
          <text x="5" y="28" fontSize="7" fill="#6B7280" textAnchor="middle">起保</text>
          <text x="100" y="5" fontSize="7" fill="#3B82F6" textAnchor="middle">整个窗口</text>
        </svg>
      ),
    },
    {
      scenario: 5,
      title: '窗口前已到期',
      description: '已完全赚完，不计入',
      firstDayIncluded: false,
      timeDays: '0（无交集）',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="60" y="10" width="120" height="10" fill="#E5E7EB" rx="2" />
          <rect x="5" y="10" width="40" height="10" fill="#9CA3AF" rx="2" />
          <circle cx="5" cy="15" r="4" fill="#10B981" />
          <circle cx="45" cy="15" r="4" fill="#EF4444" />
          <circle cx="60" cy="15" r="4" fill="#6366F1" />
          <text x="25" y="28" fontSize="8" fill="#9CA3AF" textAnchor="middle">已到期</text>
          <text x="60" y="5" fontSize="7" fill="#6B7280" textAnchor="middle">窗口始</text>
        </svg>
      ),
    },
    {
      scenario: 6,
      title: '窗口后才起保',
      description: '尚未起保，不计入',
      firstDayIncluded: false,
      timeDays: '0（尚未起保）',
      svg: (
        <svg viewBox="0 0 200 30" className="w-full h-full">
          <rect x="20" y="10" width="120" height="10" fill="#E5E7EB" rx="2" />
          <rect x="155" y="10" width="40" height="10" fill="#9CA3AF" rx="2" />
          <circle cx="140" cy="15" r="4" fill="#6366F1" />
          <circle cx="155" cy="15" r="4" fill="#10B981" />
          <text x="140" y="5" fontSize="7" fill="#6B7280" textAnchor="middle">统计日</text>
          <text x="175" y="28" fontSize="8" fill="#9CA3AF" textAnchor="middle">未来起保</text>
        </svg>
      ),
    },
  ];

  return (
    <div className={cn("bg-white rounded-lg border p-4", colorClasses.border.neutral)}>
      <h4 className={cn("text-sm font-semibold mb-3 flex items-center gap-2", colorClasses.text.neutralBlack)}>
        <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        六种保单情形（点击查看详情）
      </h4>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {scenarios.map((s) => (
          <PolicyScenarioCard
            key={s.scenario}
            {...s}
            svgContent={s.svg}
            isActive={activeScenario === s.scenario}
            onClick={() => setActiveScenario(s.scenario)}
          />
        ))}
      </div>

      {/* 图例说明 */}
      <div className={cn("mt-4 p-3 rounded flex flex-wrap gap-4 text-xs", colorClasses.bg.neutral)}>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-primary rounded" /> 窗口内在保
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-yellow-300 rounded" /> 窗口外部分
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-neutral-400 rounded" /> 不计入期间
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-success" /> 起保日
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-danger" /> 止期
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-indigo-500" /> 统计日/窗口边界
        </span>
      </div>
    </div>
  );
};

/**
 * 计算公式展示
 */
const FormulaSection: React.FC = () => {
  return (
    <div className={cn("bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border", colorClasses.border.success)}>
      <h4 className={cn("text-sm font-semibold mb-3 flex items-center gap-2", colorClasses.text.success)}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        计算公式
      </h4>

      {/* 主公式 */}
      <div className="bg-white/80 rounded-lg p-4 mb-3">
        <div className="text-center mb-3">
          <span className={cn("text-lg font-semibold", colorClasses.text.neutralBlack)}>期间已赚保费</span>
          <span className={cn("mx-3", colorClasses.text.neutralMuted)}>=</span>
          <span className="text-indigo-600 font-medium">首日费用部分</span>
          <span className={cn("mx-2", colorClasses.text.neutralMuted)}>+</span>
          <span className={cn("font-medium", colorClasses.text.success)}>时间分摊部分</span>
        </div>
      </div>

      {/* 分项公式 */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white/80 rounded-lg p-3">
          <div className="text-sm font-medium text-indigo-700 mb-2">首日费用部分</div>
          <div className="bg-indigo-50 rounded px-3 py-2 text-center font-mono">
            P × F × α × <span className="text-indigo-600 font-bold">I</span>
          </div>
          <div className={cn("mt-2 text-xs", colorClasses.text.neutral)}>
            <span className="text-indigo-600 font-bold">I</span> = 起保日在窗口内时为1，否则为0
          </div>
        </div>

        <div className="bg-white/80 rounded-lg p-3">
          <div className={cn("text-sm font-medium mb-2", colorClasses.text.success)}>时间分摊部分</div>
          <div className={cn("rounded px-3 py-2 text-center font-mono", colorClasses.bg.success)}>
            P × (1-F) × (D / 365)
          </div>
          <div className={cn("mt-2 text-xs", colorClasses.text.neutral)}>
            <span className={cn("font-bold", colorClasses.text.success)}>D</span> = 窗口内在保天数
          </div>
        </div>
      </div>

      {/* 参数说明 */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="bg-white/60 rounded px-2 py-1.5">
          <code className={cn("font-bold", colorClasses.text.neutral)}>P</code>
          <span className={cn("ml-1", colorClasses.text.neutralMuted)}>保费金额</span>
        </div>
        <div className="bg-white/60 rounded px-2 py-1.5">
          <code className={cn("font-bold", colorClasses.text.neutral)}>F</code>
          <span className={cn("ml-1", colorClasses.text.neutralMuted)}>费用率 (费用/保费)</span>
        </div>
        <div className="bg-white/60 rounded px-2 py-1.5">
          <code className={cn("font-bold", colorClasses.text.neutral)}>α</code>
          <span className={cn("ml-1", colorClasses.text.neutralMuted)}>险类系数</span>
        </div>
        <div className="bg-white/60 rounded px-2 py-1.5">
          <code className={cn("font-bold", colorClasses.text.neutral)}>D</code>
          <span className={cn("ml-1", colorClasses.text.neutralMuted)}>窗口内天数</span>
        </div>
      </div>

      {/* 险类系数说明 */}
      <div className="mt-3 flex gap-4 text-xs">
        <span className="bg-white/60 rounded px-2 py-1">
          <span className="font-medium">交强险</span>: α = <span className={cn("font-bold", colorClasses.text.primary)}>0.82</span>
        </span>
        <span className="bg-white/60 rounded px-2 py-1">
          <span className="font-medium">商业险</span>: α = <span className={cn("font-bold", colorClasses.text.primary)}>0.94</span>
        </span>
      </div>
    </div>
  );
};

/**
 * 计算案例展示
 */
const CalculationExample: React.FC<{ cutoffDate: string; activeScenario: number }> = ({
  cutoffDate,
  activeScenario,
}) => {
  // 根据选中的情形显示对应案例
  const examples = {
    1: {
      title: '情形1案例：窗口内完整周期',
      effectiveDate: '2025-06-01',
      expiryDate: '2026-05-31',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 365,
      firstDayIncluded: true,
    },
    2: {
      title: '情形2案例：新单未满期',
      effectiveDate: '2026-02-01',
      expiryDate: '2027-01-31',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 59,
      firstDayIncluded: true,
    },
    3: {
      title: '情形3案例：跨窗口前边界',
      effectiveDate: '2025-01-01',
      expiryDate: '2025-12-31',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 275,
      firstDayIncluded: false,
    },
    4: {
      title: '情形4案例：横跨整个窗口',
      effectiveDate: '2025-03-01',
      expiryDate: '2026-02-28',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 334,
      firstDayIncluded: false,
    },
    5: {
      title: '情形5案例：已完全赚完',
      effectiveDate: '2024-06-01',
      expiryDate: '2025-05-31',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 0,
      firstDayIncluded: false,
    },
    6: {
      title: '情形6案例：尚未起保',
      effectiveDate: '2026-05-01',
      expiryDate: '2027-04-30',
      premium: 10000,
      feeRate: 0.1,
      alpha: 0.94,
      windowDays: 0,
      firstDayIncluded: false,
    },
  };

  const example = examples[activeScenario as keyof typeof examples] || examples[2];

  const firstDayPart = example.firstDayIncluded
    ? example.premium * example.feeRate * example.alpha
    : 0;
  const timePart = example.premium * (1 - example.feeRate) * (example.windowDays / 365);
  const totalEarned = firstDayPart + timePart;

  return (
    <div className={cn("bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-4 border", colorClasses.border.warning)}>
      <h4 className={cn("text-sm font-semibold mb-3 flex items-center gap-2", colorClasses.text.warning)}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {example.title}
      </h4>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 输入参数 */}
        <div className="bg-white/80 rounded-lg p-3">
          <div className={cn("text-xs font-medium mb-2", colorClasses.text.neutral)}>输入参数</div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>起保日</span>
              <span className="font-mono">{example.effectiveDate}</span>
            </div>
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>止期</span>
              <span className="font-mono">{example.expiryDate}</span>
            </div>
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>保费 P</span>
              <span className="font-mono">{formatCount(example.premium)}元</span>
            </div>
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>费用率 F</span>
              <span className="font-mono">{formatPercent(example.feeRate * 100, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>险类系数 α</span>
              <span className="font-mono">{example.alpha}</span>
            </div>
            <div className="flex justify-between">
              <span className={colorClasses.text.neutral}>窗口内天数 D</span>
              <span className={cn("font-mono font-bold", colorClasses.text.primary)}>{example.windowDays}天</span>
            </div>
          </div>
        </div>

        {/* 计算过程 */}
        <div className="bg-white/80 rounded-lg p-3">
          <div className={cn("text-xs font-medium mb-2", colorClasses.text.neutral)}>计算过程</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-indigo-600">首日费用</span>
              <span className="font-mono">
                {example.firstDayIncluded
                  ? `${example.premium} × ${example.feeRate} × ${example.alpha} = `
                  : '不计入（非窗口内起保）= '}
                <span className="font-bold">{formatCount(firstDayPart)}元</span>
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className={colorClasses.text.success}>时间分摊</span>
              <span className="font-mono">
                {example.premium} × {1 - example.feeRate} × ({example.windowDays}/365) ={' '}
                <span className="font-bold">{formatCount(timePart)}元</span>
              </span>
            </div>
            <div className={cn("border-t pt-2 flex justify-between items-center", colorClasses.border.warning)}>
              <span className={cn("font-medium", colorClasses.text.warning)}>期间已赚保费</span>
              <span className={cn("font-mono text-lg font-bold", colorClasses.text.warning)}>
                {formatCount(totalEarned)}元
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={cn("mt-3 text-xs", colorClasses.text.neutralMuted)}>
        统计日：{cutoffDate}　｜　窗口：{cutoffDate} 往前365天
      </div>
    </div>
  );
};

/**
 * 核心规则总结
 */
const RulesSummary: React.FC = () => {
  return (
    <div className={cn("bg-white rounded-lg border p-4", colorClasses.border.neutral)}>
      <h4 className={cn("text-sm font-semibold mb-3 flex items-center gap-2", colorClasses.text.neutralBlack)}>
        <svg className={cn("w-4 h-4", colorClasses.text.danger)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        核心规则速记
      </h4>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-indigo-50 rounded-lg p-3">
          <div className="font-medium text-indigo-800 text-sm mb-2">首日费用归属</div>
          <ul className="text-xs text-indigo-700 space-y-1">
            <li className="flex items-start gap-1">
              <span className={colorClasses.text.success}>✓</span>
              起保日在统计窗口内 → 首日费用<strong>计入</strong>本期
            </li>
            <li className="flex items-start gap-1">
              <span className={colorClasses.text.danger}>✗</span>
              起保日在统计窗口前 → 首日费用<strong>不计入</strong>（已确认）
            </li>
          </ul>
        </div>

        <div className={cn("rounded-lg p-3", colorClasses.bg.success)}>
          <div className={cn("font-medium text-sm mb-2", colorClasses.text.success)}>时间分摊计算</div>
          <ul className={cn("text-xs space-y-1", colorClasses.text.success)}>
            <li className="flex items-start gap-1">
              <span>📅</span>
              取保单在保期间与统计窗口的<strong>交集</strong>
            </li>
            <li className="flex items-start gap-1">
              <span>⏱️</span>
              只计算交集天数对应的时间分摊
            </li>
          </ul>
        </div>
      </div>

      <div className={cn("mt-3 p-3 rounded-lg", colorClasses.bg.neutral)}>
        <div className={cn("text-xs", colorClasses.text.neutral)}>
          <strong className={colorClasses.text.neutralBlack}>窗口内在保天数计算</strong>：
          <code className={cn("ml-2 bg-white px-2 py-0.5 rounded", colorClasses.text.neutral)}>
            D = MIN(统计日, 止期) - MAX(窗口开始, 起保日)
          </code>
        </div>
      </div>
    </div>
  );
};

/**
 * 已赚保费计算指引主组件
 */
export const EarnedPremiumGuide: React.FC<EarnedPremiumGuideProps> = ({
  cutoffDate,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeScenario, setActiveScenario] = useState(2);

  return (
    <div className="mb-4">
      {/* 折叠/展开按钮 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">已赚保费计算指引</span>
          <span className="text-blue-200 text-sm">（滚动12个月财务口径）</span>
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 展开的内容 */}
      {isExpanded && (
        <div className={cn("mt-3 space-y-4 p-4 rounded-lg border", colorClasses.bg.neutral, colorClasses.border.neutral)}>
          {/* 时间轴可视化 */}
          <TimelineVisualization cutoffDate={cutoffDate} />

          {/* 六种保单情形 */}
          <PolicyScenariosSection
            activeScenario={activeScenario}
            setActiveScenario={setActiveScenario}
          />

          {/* 计算公式 */}
          <FormulaSection />

          {/* 计算案例 */}
          <CalculationExample cutoffDate={cutoffDate} activeScenario={activeScenario} />

          {/* 核心规则总结 */}
          <RulesSummary />
        </div>
      )}
    </div>
  );
};

export default EarnedPremiumGuide;
