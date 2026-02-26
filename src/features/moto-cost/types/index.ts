/**
 * 摩意模型 - 类型定义
 * 完全对齐原版 moto_cost
 */

// 输入参数（存储百分比形式的原始值）
export interface MotoCostInputs {
  // 管理成本
  laborBaseRate: number;          // 人力成本基数 (%) - 如 2.8
  fixedOperationRate: number;     // 固定运营成本率 (%) - 如 7.21

  // 摩意险保费配比计算因子
  carAveragePremium: number;      // 摩托车单均保费 (元) - 如 120
  motoAveragePremium: number;     // 摩意险件均保费 (元) - 如 100
  motoQuantity: number;           // 摩意险份数 - 如 2

  // 车险参数
  carPremium: number;             // 车险保费 (万元) - 如 1000
  carLossRatio: number;           // 车险赔付率 (%) - 如 104.2
  carHandlingFeeRate: number;     // 车险手续费率 (%) - 如 0
  carSalesPromotionRate: number;  // 车险销推费用率 (%) - 如 0.3
  carStandardPremiumRatio: number; // 车险标保系数 - 如 0.5

  // 摩意险参数
  motoPremium: number;            // 摩意险保费 (万元) - 如 1667
  motoLossRatio: number;          // 摩意险赔付率 (%) - 如 4
  motoWithCarFeeRate: number;     // 随车业务费用率 (%) - 如 65
  motoCardFeeRate: number;        // 卡单费用率 (%) - 如 85
  motoSalesPromotionRate: number; // 摩意险销推费用率 (%) - 如 0.9
  motoStandardPremiumRatio: number; // 摩意险标保系数 - 如 1.8
}

// 计算结果 - 单项
export interface CalculationResult {
  absolute: number[]; // [保费, 赔款, 手续费, 销推, 人力成本, 固定成本, 利润]
  rate: number[];     // [综合成本率, 赔付率, 手续费率, 销推率, 人力成本率, 固定成本率]
}

// 完整计算结果
export interface MotoCostCalculation {
  car: CalculationResult;
  moto: CalculationResult;
  combined: CalculationResult;
}

// 盈亏平衡分析
export interface BreakEvenAnalysis {
  motoPremiumRatio: number;        // 摩意险保费配比
  carBreakEvenLossRatio: number;   // 车险赔付率平衡点
  motoBreakEvenLossRatio: number;  // 摩意险赔付率平衡点
  carSensitivity: number;          // 车险赔付率上浮1%利润影响
  motoSensitivity: number;         // 摩意险赔付率上浮1%利润影响
  bothSensitivity: number;         // 两者同时上浮1%利润影响
}

// 预设方案
export interface Scheme {
  key: string;
  label: string;
  carLossRatio: number;
  color: string;
}

// 分析 Tab 类型
export type AnalysisTab = 'combined' | 'car' | 'moto';

// 默认输入值 - 完全对齐原版 SCHEMES['104.2']
export const DEFAULT_INPUTS: MotoCostInputs = {
  laborBaseRate: 2.8,
  fixedOperationRate: 7.21,
  carAveragePremium: 120,
  motoAveragePremium: 100,
  motoQuantity: 2,
  carPremium: 1000,
  carLossRatio: 104.2,
  carHandlingFeeRate: 0,
  carSalesPromotionRate: 0.3,
  carStandardPremiumRatio: 0.5,
  motoPremium: 1667,
  motoLossRatio: 4,
  motoWithCarFeeRate: 65,
  motoCardFeeRate: 85,
  motoSalesPromotionRate: 0.9,
  motoStandardPremiumRatio: 1.8,
};

// 预设方案
export const SCHEMES: Scheme[] = [
  { key: '90.8', label: '盈利', carLossRatio: 90.8, color: '#34c759' },
  { key: '104.2', label: '保本', carLossRatio: 104.2, color: '#007aff' },
  { key: '117.5', label: '微亏', carLossRatio: 117.5, color: '#ff9500' },
  { key: '130.8', label: '巨亏', carLossRatio: 130.8, color: '#d70015' },
];
