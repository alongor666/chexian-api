import type { ComprehensiveBundleResponse } from '../types';
import { normalizeMetricRows } from './common';

export function adaptCostRows(response: ComprehensiveBundleResponse) {
  return normalizeMetricRows(response.cost.rows);
}

