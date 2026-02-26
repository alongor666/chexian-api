import React from 'react';

/**
 * 摩意模型页面 - iframe 嵌入外部 moto_cost 项目
 *
 * 嵌入 GitHub Pages: https://alongor666.github.io/moto_cost/
 */
export const MotoCostPage: React.FC = () => {
  return (
    <div className="h-full w-full flex flex-col">
      {/* 页面标题 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-200 bg-white">
        <h1 className="text-xl font-semibold text-neutral-800">摩意模型</h1>
        <p className="text-sm text-neutral-500 mt-1">摩托车使用成本计算器</p>
      </div>

      {/* iframe 容器 */}
      <div className="flex-1 w-full overflow-hidden">
        <iframe
          src="https://alongor666.github.io/moto_cost/"
          title="摩意模型 - 摩托车使用成本计算器"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    </div>
  );
};

export default MotoCostPage;
