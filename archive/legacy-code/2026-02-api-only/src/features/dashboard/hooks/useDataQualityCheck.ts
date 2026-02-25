import { useState, useCallback } from 'react';

export interface UseDataQualityCheckResult {
  warnings: string[];
  runCheck: () => void;
}

export const useDataQualityCheck = (): UseDataQualityCheckResult => {
  const [warnings] = useState<string[]>([]);

  const runCheck = useCallback(() => {
    // Data quality checks are handled server-side in API mode
  }, []);

  return {
    warnings,
    runCheck,
  };
};
