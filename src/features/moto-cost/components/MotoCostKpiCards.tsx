/**
 * 摩意模型 - KPI 卡片组件
 */
import React from 'react';
import { cardStyles, textStyles, numericStyles, colorClasses, cn } from '@/shared/styles';
import type { MotoCostCalculation } from '../types';

interface MotoCostKpiCardsProps {
  calculation: MotoCostCalculation;
}

// 指标索引
const INDICATORS = {
  PREMIUM: 0,
  LOSS: 1,
  HANDLING_FEE: 2,
  SALES_PROMOTION: 3,
  LABOR_COST: 4,
  FIXED_COST: 5,
  PROFIT: 6,
};

const RATE_INDICATORS = {
  TCR: 0, // 综合成本率
  LOSS_RATIO: 1,
  HANDLING_FEE_RATIO: 2,
  SALES_PROMOTION_RATIO: 3,
};

export const MotoCostKpiCards: React.FC<MotoCostKpiCardsProps> = ({ calculation }) => {
  const combined = calculation.combined;

  // KPI 数据
  const kpis = [
    {
      label: '总利润',
      value: combined.absolute[INDICATORS.PROFIT],
      unit: '万元',
      type: 'profit' as const,
    },
    {
      label: '综合成本率',
      value: combined.rate[RATE_INDICATORS.TCR] * 100,
      unit: '%',
      type: 'rate' as const,
      threshold: 100,
    },
    {
      label: '总保费',
      value: combined.absolute[INDICATORS.PREMIUM],
      unit: '万元',
      type: 'neutral' as const,
    },
    {
      label: '边际贡献额',
      value: combined.absolute[INDICATORS.PROFIT] + combined.absolute[INDICATORS.FIXED_COST],
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
          className={cn(cardStyles.standard, 'text-center')}
        >
          <p className={textStyles.caption}>{kpi.label}</p>
          <p className={cn(numericStyles.kpiPrimary, 'mt-2', getColorClass(kpi.type, kpi.value, kpi.threshold))}>
            {formatValue(kpi.value)}
            <span className="text-base font-normal text-neutral-400 ml-1">{kpi.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
};

export default MotoCostKpiCards;
