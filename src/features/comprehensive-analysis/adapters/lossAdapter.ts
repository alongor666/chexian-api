import type { ComprehensiveBundleResponse } from '../types';
import { normalizeLossTrendRows, normalizeMetricRows } from './common';

export function adaptLossQuadrantRows(response: ComprehensiveBundleResponse) {
  return normalizeMetricRows(response.loss.quadrantRows);
}

export function adaptLossTrendRows(response: ComprehensiveBundleResponse) {
  return normalizeLossTrendRows(response.loss.trendRows);
}

