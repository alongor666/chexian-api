/**
 * 保费达成下钻面板组件
 *
 * 此功能尚未适配 API 模式，需要后端实现对应的查询接口。
 */

import React from 'react';

interface PremiumPlanPanelProps {
  planYear: number;
}

export const PremiumPlanPanel: React.FC<PremiumPlanPanelProps> = () => {
  return (
    <div className="bg-white p-8 rounded shadow text-center text-gray-500">
      <p className="text-lg">保费达成下钻分析功能尚未适配 API 模式，敬请期待。</p>
    </div>
  );
};
