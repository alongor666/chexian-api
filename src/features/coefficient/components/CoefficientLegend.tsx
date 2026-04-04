/**
 * 系数监控图例组件
 */

import { memo } from 'react';
import { colorClasses } from '../../../shared/styles';

/**
 * 系数监控图例
 */
export const CoefficientLegend = memo(function CoefficientLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 sm:gap-6 mb-4 text-sm">
      <div className="flex items-center">
        <span
          className="w-4 h-4 rounded mr-1"
          style={{ backgroundColor: '#fff3cd' }}
          aria-hidden="true"
        />
        <span>成都（同城聚合）</span>
      </div>
      <div className="flex items-center">
        <span
          className="w-4 h-4 rounded mr-1"
          style={{ backgroundColor: '#e0f2fe' }}
          aria-hidden="true"
        />
        <span>全省聚合</span>
      </div>
      <div className="flex items-center">
        <span className={`${colorClasses.text.success} font-bold mr-1`} aria-hidden="true">
          ●
        </span>
        <span>合规</span>
      </div>
      <div className="flex items-center">
        <span className={`${colorClasses.text.danger} font-bold mr-1`} aria-hidden="true">
          ●
        </span>
        <span>超限</span>
      </div>
      <div className="flex items-center">
        <span className={`${colorClasses.text.neutralMuted} italic mr-1`} aria-hidden="true">
          -
        </span>
        <span>待定</span>
      </div>
    </div>
  );
});
