import React from 'react';
import type { DashboardSectionId, KpiCardId } from '../dashboardLayoutConfig';

interface DashboardCustomizerPanelProps {
  sectionItems: Array<{ id: DashboardSectionId; label: string; visible: boolean }>;
  kpiItems: Array<{ id: KpiCardId; label: string; visible: boolean }>;
  onToggleSection: (id: DashboardSectionId) => void;
  onMoveSection: (id: DashboardSectionId, direction: 'up' | 'down') => void;
  onToggleKpi: (id: KpiCardId) => void;
  onMoveKpi: (id: KpiCardId, direction: 'up' | 'down') => void;
  onReset: () => void;
}

export const DashboardCustomizerPanel: React.FC<DashboardCustomizerPanelProps> = ({
  sectionItems,
  kpiItems,
  onToggleSection,
  onMoveSection,
  onToggleKpi,
  onMoveKpi,
  onReset,
}) => {
  return (
    <details className="bg-white p-3 sm:p-4 rounded shadow">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2">
        <span>🎨</span>
        <span>自定义看板</span>
      </summary>
      <div className="mt-4 space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-gray-800">模块布局</h3>
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 border border-blue-200 rounded hover:bg-blue-50 transition-colors"
          >
            恢复默认
          </button>
        </div>
        <div className="space-y-2">
          {sectionItems.map((item, index) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-gray-200 rounded px-3 py-3 sm:py-2"
            >
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={() => onToggleSection(item.id)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                />
                {item.label}
              </label>
              <div className="flex gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => onMoveSection(item.id, 'up')}
                  disabled={index === 0}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors flex-1 sm:flex-none"
                >
                  ↑ 上移
                </button>
                <button
                  type="button"
                  onClick={() => onMoveSection(item.id, 'down')}
                  disabled={index === sectionItems.length - 1}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors flex-1 sm:flex-none"
                >
                  ↓ 下移
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">KPI 指标</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {kpiItems.map((item, index) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-gray-200 rounded px-3 py-3 sm:py-2"
              >
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.visible}
                    onChange={() => onToggleKpi(item.id)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  {item.label}
                </label>
                <div className="flex gap-1 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => onMoveKpi(item.id, 'up')}
                    disabled={index === 0}
                    className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors flex-1 sm:flex-none"
                  >
                    ↑ 上移
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveKpi(item.id, 'down')}
                    disabled={index === kpiItems.length - 1}
                    className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50 transition-colors flex-1 sm:flex-none"
                  >
                    ↓ 下移
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
};
