/**
 * 费用分析 Hook
 * 通过 API 获取费率分档数据，前端计算汇总 KPI
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../../../shared/api/client';
import type { FeeRuleTierData, FeeAnalysisSummary } from '../types/feeAnalysisTypes';

export interface FeeAnalysisState {
  data: FeeRuleTierData[];
  summary: FeeAnalysisSummary | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_SUMMARY: FeeAnalysisSummary = {
  total_policy_count: 0,
  total_premium: 0,
  matched_premium: 0,
  total_expected_fee: 0,
  total_performance_fee: 0,
  weighted_avg_fee_rate: 0,
  out_of_scope_count: 0,
  out_of_scope_premium: 0,
};

function computeSummary(rows: FeeRuleTierData[]): FeeAnalysisSummary {
  const outOfScope = rows.filter((r) => r.fee_rule_id === 'OUT_OF_SCOPE');
  const matched = rows.filter((r) => r.fee_rule_id !== 'OUT_OF_SCOPE');

  const totalPolicies = rows.reduce((s, r) => s + r.policy_count, 0);
  const totalPremium = rows.reduce((s, r) => s + r.total_premium, 0);
  const matchedPremium = matched.reduce((s, r) => s + r.total_premium, 0);
  const totalExpectedFee = matched.reduce((s, r) => s + (r.expected_fee ?? 0), 0);
  const totalPerfFee = rows.reduce((s, r) => s + r.performance_fee, 0);
  const weightedRate = matchedPremium > 0 ? totalExpectedFee / matchedPremium : 0;
  const oosPolicies = outOfScope.reduce((s, r) => s + r.policy_count, 0);
  const oosPremium = outOfScope.reduce((s, r) => s + r.total_premium, 0);

  return {
    total_policy_count: totalPolicies,
    total_premium: totalPremium,
    matched_premium: matchedPremium,
    total_expected_fee: totalExpectedFee,
    total_performance_fee: totalPerfFee,
    weighted_avg_fee_rate: weightedRate,
    out_of_scope_count: oosPolicies,
    out_of_scope_premium: oosPremium,
  };
}

export function useFeeAnalysis() {
  const [state, setState] = useState<FeeAnalysisState>({
    data: [],
    summary: null,
    loading: false,
    error: null,
  });

  const fetchFeeAnalysis = useCallback(async (filters?: Record<string, any>) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const rows = await apiClient.getFeeAnalysis(filters) as FeeRuleTierData[];
      const summary = computeSummary(rows);
      setState({ data: rows, summary, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取费用分析数据失败';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  return { ...state, fetchFeeAnalysis };
}
