/**
 * 度量选择器组件
 */

import { useState } from 'react';
import { X, Plus, ChevronDown } from 'lucide-react';
import { MEASURE_FIELDS, PRESET_MEASURES } from './fieldConfig';
import type { SelectedMeasure, AggregateFunction } from './types';
import { cn, badgeStyles } from '../../../shared/styles';

export interface MeasureSelectorProps {
  /** 已选度量 */
  selected: SelectedMeasure[];
  /** 添加度量 */
  onAdd: (measure: SelectedMeasure) => void;
  /** 添加预设度量 */
  onAddPreset: (presetId: string) => void;
  /** 移除度量 */
  onRemove: (alias: string) => void;
}

export function MeasureSelector({ selected, onAdd, onAddPreset, onRemove }: MeasureSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customField, setCustomField] = useState('');
  const [customAggregate, setCustomAggregate] = useState<AggregateFunction>('SUM');
  const [customAlias, setCustomAlias] = useState('');

  // 检查预设是否已添加
  const addedPresets = new Set(
    selected.map((m) => {
      const preset = PRESET_MEASURES.find(
        (p) => p.field === m.field && p.aggregate === m.aggregate
      );
      return preset?.id;
    }).filter(Boolean)
  );

  // 处理自定义度量添加
  const handleAddCustom = () => {
    if (!customField || !customAlias) return;

    const fieldDef = MEASURE_FIELDS.find((f) => f.field === customField);
    if (!fieldDef) return;

    onAdd({
      field: customField,
      aggregate: customAggregate,
      alias: customAlias,
    });

    // 重置表单
    setCustomField('');
    setCustomAggregate('SUM');
    setCustomAlias('');
    setShowCustom(false);
  };

  // 当选择字段时，自动生成别名
  const handleFieldChange = (field: string) => {
    setCustomField(field);
    const fieldDef = MEASURE_FIELDS.find((f) => f.field === field);
    if (fieldDef) {
      setCustomAggregate(fieldDef.defaultAggregate || 'SUM');
      setCustomAlias(`${fieldDef.label}_${fieldDef.defaultAggregate || 'SUM'}`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-700">度量</label>
        <span className="text-xs text-neutral-500">{selected.length} 个</span>
      </div>

      {/* 已选度量 Chips */}
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {selected.map((measure) => (
          <span
            key={measure.alias}
            className={cn(
              badgeStyles.base,
              'bg-success-bg text-success-dark pl-2 pr-1 py-1 gap-1'
            )}
          >
            {measure.alias}
            <button
              onClick={() => onRemove(measure.alias)}
              className="hover:bg-success-200 rounded p-0.5"
              aria-label={`移除 ${measure.alias}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}

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
            添加度量
            <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
          </button>

          {/* 下拉选择器 */}
          {isOpen && (
            <>
              {/* 遮罩层 */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => {
                  setIsOpen(false);
                  setShowCustom(false);
                }}
              />

              {/* 下拉面板 */}
              <div className="absolute left-0 top-full mt-1 z-20 w-72 bg-white rounded-lg shadow-lg border border-neutral-200 overflow-hidden">
                {!showCustom ? (
                  <>
                    {/* 预设度量 */}
                    <div className="p-2 border-b border-neutral-100">
                      <div className="text-xs font-medium text-neutral-500 px-2 py-1">
                        快捷选择
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {PRESET_MEASURES.map((preset) => {
                          const isAdded = addedPresets.has(preset.id);
                          return (
                            <button
                              key={preset.id}
                              onClick={() => {
                                if (!isAdded) {
                                  onAddPreset(preset.id);
                                }
                              }}
                              disabled={isAdded}
                              className={cn(
                                'px-2 py-1.5 text-xs rounded text-left',
                                isAdded
                                  ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                                  : 'hover:bg-primary-50 text-neutral-700'
                              )}
                            >
                              <div className="font-medium">{preset.label}</div>
                              <div className="text-neutral-400 text-[10px]">{preset.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 自定义按钮 */}
                    <div className="p-2">
                      <button
                        onClick={() => setShowCustom(true)}
                        className="w-full px-3 py-2 text-sm text-left text-neutral-600 hover:bg-neutral-50 rounded flex items-center gap-2"
                      >
                        <Plus size={14} />
                        自定义度量...
                      </button>
                    </div>
                  </>
                ) : (
                  /* 自定义度量表单 */
                  <div className="p-3 space-y-3">
                    <div className="text-sm font-medium text-neutral-700">自定义度量</div>

                    {/* 字段选择 */}
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-600">字段</label>
                      <select
                        value={customField}
                        onChange={(e) => handleFieldChange(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                      >
                        <option value="">选择字段...</option>
                        {MEASURE_FIELDS.map((field) => (
                          <option key={field.field} value={field.field}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 聚合函数 */}
                    {customField && (
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-600">聚合函数</label>
                        <select
                          value={customAggregate}
                          onChange={(e) => {
                            const agg = e.target.value as AggregateFunction;
                            setCustomAggregate(agg);
                            const fieldDef = MEASURE_FIELDS.find((f) => f.field === customField);
                            if (fieldDef) {
                              setCustomAlias(`${fieldDef.label}_${agg}`);
                            }
                          }}
                          className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                        >
                          {MEASURE_FIELDS.find((f) => f.field === customField)?.aggregates?.map(
                            (agg) => (
                              <option key={agg} value={agg}>
                                {agg}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    )}

                    {/* 别名 */}
                    {customField && (
                      <div className="space-y-1">
                        <label className="text-xs text-neutral-600">别名</label>
                        <input
                          type="text"
                          value={customAlias}
                          onChange={(e) => setCustomAlias(e.target.value)}
                          placeholder="输入显示名称"
                          className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
                        />
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowCustom(false)}
                        className="flex-1 px-3 py-1.5 text-sm border border-neutral-200 rounded hover:bg-neutral-50"
                      >
                        返回
                      </button>
                      <button
                        onClick={handleAddCustom}
                        disabled={!customField || !customAlias}
                        className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        添加
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      {selected.length === 0 && (
        <p className="text-xs text-danger">请至少选择一个度量</p>
      )}
    </div>
  );
}
