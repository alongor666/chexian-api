import type { ComprehensiveBundleResponse } from '../types';
import { normalizeExpenseSurplusRows, normalizeMetricRows } from './common';

export function adaptExpenseRows(response: ComprehensiveBundleResponse) {
  return normalizeMetricRows(response.expense.rows);
}

export function adaptExpenseSurplusRows(response: ComprehensiveBundleResponse) {
  return normalizeExpenseSurplusRows(response.expense.surplusRows);
}

