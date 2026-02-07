/**
 * 维度选择器组件
 */

import { useState } from 'react';
import { X, Plus, ChevronDown } from 'lucide-react';
import { DIMENSION_FIELDS, GROUP_ORDER } from './fieldConfig';
import type { SelectedDimension } from './types';
import { cn, badgeStyles } from '../../../shared/styles';

export interface DimensionSelectorProps {
  /** 已选维度 */
  selected: SelectedDimension[];
  /** 添加维度 */
  onAdd: (field: string) => void;
  /** 移除维度 */
  onRemove: (field: string) => void;
}

export function DimensionSelector({ selected, onAdd, onRemove }: DimensionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedFields = new Set(selected.map((d) => d.field));

  // 过滤未选中的字段
  const availableFields = DIMENSION_FIELDS.filter(
    (f) =>
      !selectedFields.has(f.field) &&
      (f.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.field.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-700">维度</label>
        <span className="text-xs text-neutral-500">{selected.length}/14</span>
      </div>

      {/* 已选维度 Chips */}
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {selected.map((dim) => {
          const fieldDef = DIMENSION_FIELDS.find((f) => f.field === dim.field);
          return (
            <span
              key={dim.field}
              className={cn(
                badgeStyles.base,
                'bg-primary-bg text-primary-dark pl-2 pr-1 py-1 gap-1'
              )}
            >
              {fieldDef?.label || dim.field}
              <button
                onClick={() => onRemove(dim.field)}
                className="hover:bg-primary-200 rounded p-0.5"
                aria-label={`移除 ${fieldDef?.label || dim.field}`}
              >
                <X size={12} />
              </button>
            </span>
          );
        })}

        {/* 添加按钮 */}
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full',
              'border border-dashed border-neutral-300',
              'text-neutral-600 hover:bg-neutral-50 hover:border-neutral-400',
              'transition-colors'
            )}
          >
            <Plus size={12} />
            添加维度
            <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
          </button>

          {/* 下拉选择器 */}
          {isOpen && (
            <>
              {/* 遮罩层 */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsOpen(false)}
              />

              {/* 下拉面板 */}
              <div className="absolute left-0 top-full mt-1 z-20 w-64 bg-white rounded-lg shadow-lg border border-neutral-200 overflow-hidden">
                {/* 搜索框 */}
                <div className="p-2 border-b border-neutral-100">
                  <input
                    type="text"
                    placeholder="搜索维度..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                    autoFocus
                  />
                </div>

                {/* 字段列表 */}
                <div className="max-h-64 overflow-y-auto">
                  {availableFields.length === 0 ? (
                    <div className="p-4 text-center text-sm text-neutral-500">
                      {searchTerm ? '未找到匹配的维度' : '所有维度已选择'}
                    </div>
                  ) : (
                    GROUP_ORDER.map((group) => {
                      const groupFields = availableFields.filter((f) => f.group === group);
                      if (groupFields.length === 0) return null;

                      return (
                        <div key={group}>
                          <div className="px-3 py-1.5 text-xs font-medium text-neutral-500 bg-neutral-50">
                            {group}
                          </div>
                          {groupFields.map((field) => (
                            <button
                              key={field.field}
                              onClick={() => {
                                onAdd(field.field);
                                setSearchTerm('');
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-primary-50 flex items-center justify-between group"
                            >
                              <span>{field.label}</span>
                              <span className="text-xs text-neutral-400 group-hover:text-primary">
                                {field.field}
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      {selected.length === 0 && (
        <p className="text-xs text-neutral-500">
          不选择维度将返回全局汇总
        </p>
      )}
    </div>
  );
}
