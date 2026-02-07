import React from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';

interface RenewalDrilldownPanelProps {
  filters: AdvancedFilterState;
  targetYear: number;
  cutoffDate?: string;
  bundleOnly: boolean;
  setBundleOnly: (v: boolean) => void;
  selfRenewalOnly: boolean;
  setSelfRenewalOnly: (v: boolean) => void;
  selectedDueMonth: number | null;
  setSelectedDueMonth: (v: number | null) => void;
}

export const RenewalDrilldownPanel: React.FC<RenewalDrilldownPanelProps> = () => {
  return (
    <div className="bg-white p-8 rounded shadow text-center text-gray-500">
      <p className="text-lg">续保下钻分析功能尚未适配 API 模式，敬请期待。</p>
    </div>
  );
};
