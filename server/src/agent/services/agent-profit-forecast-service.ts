import type {
  ProfitScenarioRequest,
  ProfitScenarioResponse,
  ProfitSegmentRequest,
  ProfitSegmentResponse,
  ProfitSegmentScenario,
} from '../schemas/agent-forecast.schema.js';

const FORBIDDEN_INTERPRETATIONS = ['财务报表利润', '法定承保利润', '审计利润', '承保利润'];

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

export function calculateProfitScenario(input: ProfitScenarioRequest): ProfitScenarioResponse {
  const ultimateCombinedCostRatio = roundRatio(
    input.ultimateVariableCostRatio + input.ultimateFixedCostRatio
  );
  const forecastOperatingProfitMargin = roundRatio(100 - ultimateCombinedCostRatio);

  const perPeriodForecast = input.earningSchedule.map((item) => ({
    period: item.period,
    earnedRatio: item.earnedRatio,
    forecastOperatingProfit: roundCurrency(
      input.premium * (item.earnedRatio / 100) * (forecastOperatingProfitMargin / 100)
    ),
  }));

  const onePctSensitivity = input.earningSchedule.map((item) => ({
    period: item.period,
    sensitivity: roundCurrency(input.premium * (item.earnedRatio / 100) * 0.01),
  }));

  const warnings = [
    'forecast 是基于调用方假设的情景计算结果，不是财务报表利润、法定承保利润或审计利润。',
    '已赚率切分仅按调用方提供的 earningSchedule 分摊，不做自动跨期插值。',
  ];
  if (input.assumptionSource === 'caller_provided') {
    warnings.push('终极成本率假设由调用方提供，请确保已与定价/精算口径校验。');
  }

  return {
    success: true,
    data: {
      scenarioName: input.scenarioName,
      ultimateCombinedCostRatio,
      forecastOperatingProfitMargin,
      perPeriodForecast,
      fullCycleForecastOperatingProfit: roundCurrency(input.premium * (forecastOperatingProfitMargin / 100)),
      onePctSensitivity,
      warnings,
      forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
      assumptionSource: input.assumptionSource,
    },
  };
}

function calculateOneSegment(segment: ProfitSegmentScenario): ProfitSegmentResponse['data']['segments'][number] {
  const ultimateCombinedCostRatio = roundRatio(
    segment.ultimateVariableCostRatio + segment.ultimateFixedCostRatio
  );
  const forecastOperatingProfitMargin = roundRatio(100 - ultimateCombinedCostRatio);

  const perPeriodForecast = segment.earningSchedule.map((item) => ({
    period: item.period,
    earnedRatio: item.earnedRatio,
    forecastOperatingProfit: roundCurrency(
      segment.premium * (item.earnedRatio / 100) * (forecastOperatingProfitMargin / 100)
    ),
  }));

  const onePctSensitivity = segment.earningSchedule.map((item) => ({
    period: item.period,
    sensitivity: roundCurrency(segment.premium * (item.earnedRatio / 100) * 0.01),
  }));

  return {
    dimensionLabel: segment.dimensionLabel,
    ultimateCombinedCostRatio,
    forecastOperatingProfitMargin,
    perPeriodForecast,
    fullCycleForecastOperatingProfit: roundCurrency(segment.premium * (forecastOperatingProfitMargin / 100)),
    onePctSensitivity,
    assumptionSource: segment.assumptionSource,
  };
}

export function calculateProfitSegment(input: ProfitSegmentRequest): ProfitSegmentResponse {
  const segments = input.segments.map(calculateOneSegment);

  const totalPremium = roundCurrency(
    input.segments.reduce((sum, segment) => sum + segment.premium, 0)
  );
  const totalFullCycleForecastOperatingProfit = roundCurrency(
    segments.reduce((sum, segment) => sum + segment.fullCycleForecastOperatingProfit, 0)
  );
  const weightedUltimateCombinedCostRatio = totalPremium > 0
    ? roundRatio(
        input.segments.reduce(
          (sum, segment) => sum + (segment.ultimateVariableCostRatio + segment.ultimateFixedCostRatio) * segment.premium,
          0
        ) / totalPremium
      )
    : 0;

  const hasCallerProvided = input.segments.some((segment) => segment.assumptionSource === 'caller_provided');
  const warnings = [
    'forecast 是基于调用方假设的情景计算结果，不是财务报表利润、法定承保利润或审计利润。',
    '已赚率切分仅按调用方提供的 earningSchedule 分摊，不做自动跨期插值。',
    '分群预测仅做加总聚合，不做跨分群插值或自动归一化。',
  ];
  if (hasCallerProvided) {
    warnings.push('部分分群的终极成本率假设由调用方提供，请确保已与定价/精算口径校验。');
  }

  return {
    success: true,
    data: {
      scenarioName: input.scenarioName,
      dimension: input.dimension,
      segments,
      aggregate: {
        totalPremium,
        totalFullCycleForecastOperatingProfit,
        weightedUltimateCombinedCostRatio,
      },
      warnings,
      forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    },
  };
}
