/**
 * 摩意模型 - KPI 卡片组件
 * 对齐原版的数据展示
 */
import React from 'react';
import { cardStyles, textStyles, numericStyles, colorClasses, cn } from '@/shared/styles';
import type { MotoCostCalculation } from '../types';

interface MotoCostKpiCardsProps {
  calculation: MotoCostCalculation;
}

// 指标索引 - 与 calculator.ts 中的 absolute 数组顺序一致
// [0]=保费, [1]=赔款, [2]=手续费, [3]=销推, [4]=人力成本, [5]=固定成本, [6]=利润
const INDEX = {
  PREMIUM: 0,
  LOSS: 1,
  HANDLING_FEE: 2,
  SALES_PROMOTION: 3,
  LABOR_COST: 4,
  FIXED_COST: 5,
  PROFIT: 6,
};

// 比率索引 - 与 calculator.ts 中的 rate 数组顺序一致
// [0]=综合成本率, [1]=赔付率, [2]=手续费率, [3]=销推率, [4]=人力成本率, [5]=固定成本率
const RATE_INDEX = {
  TCR: 0,
  LOSS_RATIO: 1,
};

export const MotoCostKpiCards: React.FC<MotoCostKpiCardsProps> = ({ calculation }) => {
  const combined = calculation.combined;

  // 边际贡献额 = 保费 - (赔款 + 手续费 + 销推 + 人力成本)
  // = 利润 + 固定成本
  const edgeContribution = combined.absolute[INDEX.PROFIT] + combined.absolute[INDEX.FIXED_COST];

  // KPI 数据
  const kpis = [
    {
      label: '总利润',
      value: combined.absolute[INDEX.PROFIT],
      unit: '万元',
      type: 'profit' as const,
    },
    {
      label: '综合成本率',
      value: combined.rate[RATE_INDEX.TCR] * 100,
      unit: '%',
      type: 'rate' as const,
      threshold: 100,
    },
    {
      label: '总保费',
      value: combined.absolute[INDEX.PREMIUM],
      unit: '万元',
      type: 'neutral' as const,
    },
    {
      label: '边际贡献额',
      value: edgeContribution,
      unit: '万元',
      type: 'contribution' as const,
    },
  ];

  // 获取颜色类
  const getColorClass = (type: string, value: number, threshold?: number) => {
    if (type === 'profit') {
      return value >= 0 ? colorClasses.text.success : colorClasses.text.danger;
    }
    if (type === 'rate' && threshold !== undefined) {
      return value <= threshold ? colorClasses.text.success : colorClasses.text.danger;
    }
    if (type === 'contribution') {
      return value >= 0 ? colorClasses.text.success : colorClasses.text.danger;
    }
    return textStyles.label;
  };

  // 格式化数值
  const formatValue = (value: number, decimals: number = 1) => {
    return value.toFixed(decimals);
  };

  return (
    <div className="grid grid-cols-4 gap-4">
      {kpis.map((kpi, index) => (
        <div
          key={index}
          className={cn(cardStyles.standard, 'text-center py-6')}
        >
          <p className={textStyles.caption}>{kpi.label}</p>
          <p className={cn(numericStyles.kpiPrimary, 'mt-3', getColorClass(kpi.type, kpi.value, kpi.threshold))}>
            {formatValue(kpi.value)}
            <span className="text-base font-normal text-neutral-400 ml-1">{kpi.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
};

export default MotoCostKpiCards;
