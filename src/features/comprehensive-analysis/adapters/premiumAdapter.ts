import type { ComprehensiveBundleResponse } from '../types';
import { normalizeMetricRows } from './common';

export function adaptPremiumRows(response: ComprehensiveBundleResponse) {
  return normalizeMetricRows(response.premium.rows);
}

