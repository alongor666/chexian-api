/**
 * 费用率发展数据获取 Hook
 */
import { useState, useCallback } from 'react';
import { apiClient } from '@/shared/api/client';

interface ExpenseDevRow {
  cohort_year: number;
  dev_month: number;
  total_policies: number;
  total_premium_wan: number;
  dev_policies: number;
  dev_premium_wan: number;
  dev_fee_wan: number;
  expense_ratio_pct: number;
  avg_fee_per_policy_yuan: number;
  coverage_pct: number;
}

interface ExpenseDevState {
  data: ExpenseDevRow[];
  loading: boolean;
  error: string | null;
}

export function useExpenseDevelopment() {
  const [state, setState] = useState<ExpenseDevState>({
    data: [],
    loading: false,
    error: null,
  });

  const fetchData = useCallback(async (params?: Record<string, string>) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const resp = await apiClient.getExpenseRatioDev(params);
      setState({ data: resp ?? [], loading: false, error: null });
    } catch (err: any) {
      setState({ data: [], loading: false, error: err.message ?? '加载失败' });
    }
  }, []);

  return { expenseDev: state, fetchExpenseDev: fetchData };
}
