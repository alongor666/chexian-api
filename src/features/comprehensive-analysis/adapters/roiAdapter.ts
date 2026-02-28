import type { ComprehensiveBundleResponse } from '../types';
import { normalizeRoiRows } from './common';

export function adaptRoiRows(response: ComprehensiveBundleResponse) {
  return normalizeRoiRows(response.roi.rows);
}

