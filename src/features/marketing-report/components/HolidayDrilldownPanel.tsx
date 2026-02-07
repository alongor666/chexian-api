/**
 * 假日营销下钻面板组件
 *
 * 此功能尚未适配 API 模式，需要后端实现对应的查询接口。
 */

import React from 'react';
import type { AdvancedFilterState } from '../../../shared/types/data';

interface HolidayDrilldownPanelProps {
  filters: AdvancedFilterState;
  startDate: string;
  endDate: string;
}

export const HolidayDrilldownPanel: React.FC<HolidayDrilldownPanelProps> = () => {
  return (
    <div className="bg-white p-8 rounded shadow text-center text-gray-500">
      <p className="text-lg">假日营销下钻分析功能尚未适配 API 模式，敬请期待。</p>
    </div>
  );
};
