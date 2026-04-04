import React from 'react';
import type { DashboardSectionId, KpiCardId, KpiGroup } from '../dashboardLayoutConfig';
import { colorClasses } from '../../../shared/styles';

interface DashboardCustomizerPanelProps {
  sectionItems: Array<{ id: DashboardSectionId; label: string; visible: boolean }>;
  kpiItemsByGroup: Record<KpiGroup, Array<{ id: KpiCardId; label: string; visible: boolean }>>;
  onToggleSection: (id: DashboardSectionId) => void;
  onMoveSection: (id: DashboardSectionId, direction: 'up' | 'down') => void;
  onToggleKpi: (group: KpiGroup, id: KpiCardId) => void;
  onMoveKpi: (group: KpiGroup, id: KpiCardId, direction: 'up' | 'down') => void;
  onReset: () => void;
}

export const DashboardCustomizerPanel: React.FC<DashboardCustomizerPanelProps> = ({
  sectionItems,
  kpiItemsByGroup,
  onToggleSection,
  onMoveSection,
  onToggleKpi,
  onMoveKpi,
  onReset,
}) => {
  const kpiGroupMeta: Array<{ key: KpiGroup; label: string }> = [
    { key: 'core', label: '核心指标' },
    { key: 'focus', label: '关注指标' },
  ];

  return (
    <details className="bg-white dark:bg-neutral-800 p-3 sm:p-4 rounded shadow">
      <summary className={`cursor-pointer text-sm font-semibold ${colorClasses.text.neutral} flex items-center gap-2`}>
        <span>🎨</span>
        <span>自定义看板</span>
      </summary>
      <div className="mt-4 space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className={`text-sm font-semibold ${colorClasses.text.neutralBlack}`}>模块布局</h3>
          <button
            type="button"
            onClick={onReset}
            className={`text-xs ${colorClasses.text.primary} hover:text-primary-dark px-2 py-1 border ${colorClasses.border.primary} rounded hover:bg-primary-bg transition-colors`}
          >
            恢复默认
          </button>
        </div>
        <div className="space-y-2">
          {sectionItems.map((item, index) => (
            <div
              key={item.id}
              className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border ${colorClasses.border.neutral} rounded px-3 py-3 sm:py-2`}
            >
              <label className={`flex items-center gap-2 text-sm ${colorClasses.text.neutral} cursor-pointer`}>
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={() => onToggleSection(item.id)}
                  className={`w-4 h-4 ${colorClasses.text.primary} bg-neutral-100 border-neutral-300 rounded focus:ring-primary-400`}
                />
                {item.label}
              </label>
              <div className="flex gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => onMoveSection(item.id, 'up')}
                  disabled={index === 0}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors flex-1 sm:flex-none"
                >
                  ↑ 上移
                </button>
                <button
                  type="button"
                  onClick={() => onMoveSection(item.id, 'down')}
                  disabled={index === sectionItems.length - 1}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors flex-1 sm:flex-none"
                >
                  ↓ 下移
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className={`text-sm font-semibold ${colorClasses.text.neutralBlack} mb-2`}>KPI 指标</h3>
          <div className="space-y-4">
            {kpiGroupMeta.map((groupMeta) => {
              const items = kpiItemsByGroup[groupMeta.key];
              return (
                <div key={groupMeta.key}>
                  <h4 className={`text-xs font-semibold ${colorClasses.text.neutral} mb-2`}>{groupMeta.label}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border ${colorClasses.border.neutral} rounded px-3 py-3 sm:py-2`}
                      >
                        <label className={`flex items-center gap-2 text-sm ${colorClasses.text.neutral} cursor-pointer`}>
                          <input
                            type="checkbox"
                            checked={item.visible}
                            onChange={() => onToggleKpi(groupMeta.key, item.id)}
                            className={`w-4 h-4 ${colorClasses.text.primary} bg-neutral-100 border-neutral-300 rounded focus:ring-primary-400`}
                          />
                          {item.label}
                        </label>
                        <div className="flex gap-1 sm:gap-2">
                          <button
                            type="button"
                            onClick={() => onMoveKpi(groupMeta.key, item.id, 'up')}
                            disabled={index === 0}
                            className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors flex-1 sm:flex-none"
                          >
                            ↑ 上移
                          </button>
                          <button
                            type="button"
                            onClick={() => onMoveKpi(groupMeta.key, item.id, 'down')}
                            disabled={index === items.length - 1}
                            className="px-2 py-1 text-xs border rounded disabled:opacity-40 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors flex-1 sm:flex-none"
                          >
                            ↓ 下移
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </details>
  );
};
