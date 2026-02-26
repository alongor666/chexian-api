/**
 * 摩意模型 - 计算服务
 * 完全对齐原版 moto_cost 的计算逻辑
 */
import type { MotoCostInputs, MotoCostCalculation, BreakEvenAnalysis } from '../types';

/**
 * 将百分比输入转换为小数
 * 如果值 > 1，认为是百分比输入（如 104.2 → 1.042）
 * 如果值 <= 1，认为已经是小数（如 0.04 → 0.04）
 */
function toRate(value: number): number {
  return value > 1 ? value / 100 : value;
}

/**
 * 执行成本计算
 * 返回结构：
 * - absolute: [保费, 赔款, 手续费, 销推费用, 人力成本, 固定成本, 利润]
 * - rate: [综合成本率, 赔付率, 手续费率, 销推费用率, 人力成本率, 固定成本率]
 */
export function performCalculations(inputs: MotoCostInputs): MotoCostCalculation {
  // 转换比率参数（百分比 → 小数）
  const carLossRatio = toRate(inputs.carLossRatio);
  const carHandlingFeeRate = toRate(inputs.carHandlingFeeRate);
  const carSalesPromotionRate = toRate(inputs.carSalesPromotionRate);
  const motoLossRatio = toRate(inputs.motoLossRatio);
  const motoWithCarFeeRate = toRate(inputs.motoWithCarFeeRate);
  const motoCardFeeRate = toRate(inputs.motoCardFeeRate);
  const motoSalesPromotionRate = toRate(inputs.motoSalesPromotionRate);
  const laborBaseRate = toRate(inputs.laborBaseRate);
  const fixedOperationRate = toRate(inputs.fixedOperationRate);

  const {
    carPremium, motoPremium,
    carStandardPremiumRatio,
    motoStandardPremiumRatio,
  } = inputs;

  // 摩意险手续费率 = (随车费用率 + 卡单费用率) / 2
  const motoHandlingFeeRate = (motoWithCarFeeRate + motoCardFeeRate) / 2;

  // ============ 车险计算 ============
  const carLaborCostRate = carStandardPremiumRatio * laborBaseRate;
  const carVariableCostRate = carLossRatio + carHandlingFeeRate + carSalesPromotionRate + carLaborCostRate;
  const carTotalCostRate = carVariableCostRate + fixedOperationRate;

  const carLoss = carPremium * carLossRatio;
  const carHandlingFee = carPremium * carHandlingFeeRate;
  const carSalesPromotion = carPremium * carSalesPromotionRate;
  const carLaborCost = carPremium * carLaborCostRate;
  const carFixedCost = carPremium * fixedOperationRate;
  const carProfit = carPremium * (1 - carTotalCostRate);

  // ============ 摩意险计算 ============
  const motoLaborCostRate = motoStandardPremiumRatio * laborBaseRate;
  const motoVariableCostRate = motoLossRatio + motoHandlingFeeRate + motoSalesPromotionRate + motoLaborCostRate;
  const motoTotalCostRate = motoVariableCostRate + fixedOperationRate;

  const motoLoss = motoPremium * motoLossRatio;
  const motoHandlingFee = motoPremium * motoHandlingFeeRate;
  const motoSalesPromotion = motoPremium * motoSalesPromotionRate;
  const motoLaborCost = motoPremium * motoLaborCostRate;
  const motoFixedCost = motoPremium * fixedOperationRate;
  const motoProfit = motoPremium * (1 - motoTotalCostRate);

  // ============ 合计计算 ============
  const totalPremium = carPremium + motoPremium;
  const totalLoss = carLoss + motoLoss;
  const totalHandlingFee = carHandlingFee + motoHandlingFee;
  const totalSalesPromotion = carSalesPromotion + motoSalesPromotion;
  const totalLaborCost = carLaborCost + motoLaborCost;
  const totalFixedCost = carFixedCost + motoFixedCost;
  const totalProfit = carProfit + motoProfit;

  // 综合成本率 = (赔款 + 手续费 + 销推 + 人力成本 + 固定成本) / 保费
  const totalCostRate = totalPremium > 0
    ? (totalLoss + totalHandlingFee + totalSalesPromotion + totalLaborCost + totalFixedCost) / totalPremium
    : 0;

  // 各项比率（相对保费）
  const totalLossRatio = totalPremium > 0 ? totalLoss / totalPremium : 0;
  const totalHandlingFeeRatio = totalPremium > 0 ? totalHandlingFee / totalPremium : 0;
  const totalSalesPromotionRatio = totalPremium > 0 ? totalSalesPromotion / totalPremium : 0;
  const totalLaborCostRatio = totalPremium > 0 ? totalLaborCost / totalPremium : 0;
  const totalFixedCostRatio = fixedOperationRate; // 固定成本率直接使用

  return {
    car: {
      absolute: [carPremium, carLoss, carHandlingFee, carSalesPromotion, carLaborCost, carFixedCost, carProfit],
      rate: [carTotalCostRate, carLossRatio, carHandlingFeeRate, carSalesPromotionRate, carLaborCostRate, fixedOperationRate],
    },
    moto: {
      absolute: [motoPremium, motoLoss, motoHandlingFee, motoSalesPromotion, motoLaborCost, motoFixedCost, motoProfit],
      rate: [motoTotalCostRate, motoLossRatio, motoHandlingFeeRate, motoSalesPromotionRate, motoLaborCostRate, fixedOperationRate],
    },
    combined: {
      absolute: [totalPremium, totalLoss, totalHandlingFee, totalSalesPromotion, totalLaborCost, totalFixedCost, totalProfit],
      rate: [totalCostRate, totalLossRatio, totalHandlingFeeRatio, totalSalesPromotionRatio, totalLaborCostRatio, totalFixedCostRatio],
    },
  };
}

/**
 * 盈亏平衡分析
 */
export function calculateBreakEvenAnalysis(inputs: MotoCostInputs): BreakEvenAnalysis {
  const { carPremium, motoPremium, carStandardPremiumRatio, motoStandardPremiumRatio } = inputs;

  // 转换比率参数
  const carLossRatio = toRate(inputs.carLossRatio);
  const carHandlingFeeRate = toRate(inputs.carHandlingFeeRate);
  const carSalesPromotionRate = toRate(inputs.carSalesPromotionRate);
  const motoLossRatio = toRate(inputs.motoLossRatio);
  const motoWithCarFeeRate = toRate(inputs.motoWithCarFeeRate);
  const motoCardFeeRate = toRate(inputs.motoCardFeeRate);
  const motoSalesPromotionRate = toRate(inputs.motoSalesPromotionRate);
  const laborBaseRate = toRate(inputs.laborBaseRate);
  const fixedOperationRate = toRate(inputs.fixedOperationRate);

  const motoPremiumRatio = carPremium > 0 ? motoPremium / carPremium : 0;
  const motoHandlingFeeRate = (motoWithCarFeeRate + motoCardFeeRate) / 2;

  const carFixedCosts = carHandlingFeeRate + carSalesPromotionRate + (carStandardPremiumRatio * laborBaseRate);
  const motoFixedCosts = motoHandlingFeeRate + motoSalesPromotionRate + (motoStandardPremiumRatio * laborBaseRate);

  const carBreakEvenLossRatio = ((1 + motoPremiumRatio) * (1 - fixedOperationRate) - motoPremiumRatio * (motoLossRatio + motoFixedCosts) - carFixedCosts) * 100;
  const motoBreakEvenLossRatio = (((1 + motoPremiumRatio) * (1 - fixedOperationRate) - (carLossRatio + carFixedCosts)) / motoPremiumRatio - motoFixedCosts) * 100;

  const carSensitivity = -carPremium * 0.01;
  const motoSensitivity = -carPremium * motoPremiumRatio * 0.01;
  const bothSensitivity = carSensitivity + motoSensitivity;

  return {
    motoPremiumRatio: parseFloat(motoPremiumRatio.toFixed(4)),
    carBreakEvenLossRatio: parseFloat(carBreakEvenLossRatio.toFixed(1)),
    motoBreakEvenLossRatio: parseFloat(motoBreakEvenLossRatio.toFixed(1)),
    carSensitivity: parseFloat(carSensitivity.toFixed(1)),
    motoSensitivity: parseFloat(motoSensitivity.toFixed(1)),
    bothSensitivity: parseFloat(bothSensitivity.toFixed(1)),
  };
}

/**
 * 计算摩意险保费配比
 */
export function calculateMotoPremiumRatio(inputs: MotoCostInputs): number {
  const { carPremium, carAveragePremium, motoAveragePremium, motoQuantity } = inputs;
  if (carPremium <= 0 || carAveragePremium <= 0) return 0;
  const motoPremium = (motoAveragePremium * motoQuantity) / carAveragePremium * carPremium;
  return carPremium > 0 ? motoPremium / carPremium : 0;
}

/**
 * 计算摩意险手续费率
 */
export function calculateMotoHandlingFeeRate(inputs: MotoCostInputs): number {
  const motoWithCarFeeRate = toRate(inputs.motoWithCarFeeRate);
  const motoCardFeeRate = toRate(inputs.motoCardFeeRate);
  return (motoWithCarFeeRate + motoCardFeeRate) / 2;
}

/**
 * 确定颜色（用于图表）
 */
export function determineColor(value: number, config: { colorKey: string; positiveGood?: boolean; threshold?: number; higherIsWorse?: boolean }): string {
  if (config.colorKey === 'neutral') return '#8c8c8c';
  if (config.colorKey === 'accent') return '#1890ff';
  if (config.colorKey === 'conditional') {
    const positiveGood = config.positiveGood !== false;
    const threshold = config.threshold ?? 0;
    if (config.higherIsWorse) return value <= threshold ? '#52c41a' : '#ff4d4f';
    return (positiveGood ? value >= threshold : value <= threshold) ? '#52c41a' : '#ff4d4f';
  }
  return '#8c8c8c';
}
