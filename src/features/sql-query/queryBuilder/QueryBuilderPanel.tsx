/**
 * 查询构建器主面板
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Play, RotateCcw, Code2 } from 'lucide-react';
import { DimensionSelector } from './DimensionSelector';
import { MeasureSelector } from './MeasureSelector';
import { FilterBuilder } from './FilterBuilder';
import { useQueryBuilder } from './useQueryBuilder';
import type { SortDirection } from './types';
import { cn, cardStyles, buttonStyles, textStyles } from '../../../shared/styles';

export interface QueryBuilderPanelProps {
  /** 生成 SQL 后的回调 */
  onSqlGenerated: (sql: string) => void;
  /** 执行查询 */
  onExecute?: (sql: string) => void;
}

export function QueryBuilderPanel({ onSqlGenerated, onExecute }: QueryBuilderPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  const {
    state,
    addDimension,
    removeDimension,
    addMeasure,
    addPresetMeasure,
    removeMeasure,
    addFilter,
    updateFilter,
    removeFilter,
    setOrderBy,
    setLimit,
    reset,
    generatedSql,
    validation,
    sortableFields,
  } = useQueryBuilder();

  // 处理生成 SQL
  const handleGenerate = () => {
    if (validation.valid) {
      onSqlGenerated(generatedSql);
    }
  };

  // 处理执行查询
  const handleExecute = () => {
    if (validation.valid && onExecute) {
      onExecute(generatedSql);
    }
  };

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      {/* 标题栏 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-neutral-50 hover:bg-neutral-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Code2 size={18} className="text-primary" />
          <span className={textStyles.titleSmall}>可视化查询构建器</span>
          <span className="text-xs text-neutral-500">
            {state.dimensions.length} 维度 · {state.measures.length} 度量
          </span>
        </div>
        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* 维度选择器 */}
          <DimensionSelector
            selected={state.dimensions}
            onAdd={addDimension}
            onRemove={removeDimension}
          />

          {/* 度量选择器 */}
          <MeasureSelector
            selected={state.measures}
            onAdd={addMeasure}
            onAddPreset={addPresetMeasure}
            onRemove={removeMeasure}
          />

          {/* 筛选条件 */}
          <FilterBuilder
            filters={state.filters}
            onAdd={addFilter}
            onUpdate={updateFilter}
            onRemove={removeFilter}
          />

          {/* 排序和限制 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 排序 */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-neutral-700">排序</label>
              <div className="flex gap-2">
                <select
                  value={state.orderBy?.field || ''}
                  onChange={(e) => {
                    const field = e.target.value;
                    if (field) {
                      setOrderBy({
                        field,
                        direction: state.orderBy?.direction || 'DESC',
                      });
                    } else {
                      setOrderBy(null);
                    }
                  }}
                  className="flex-1 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                >
                  <option value="">自动（按第一个度量）</option>
                  {sortableFields.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                {state.orderBy && (
                  <select
                    value={state.orderBy.direction}
                    onChange={(e) =>
                      setOrderBy({
                        ...state.orderBy!,
                        direction: e.target.value as SortDirection,
                      })
                    }
                    className="w-20 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                  >
                    <option value="DESC">降序</option>
                    <option value="ASC">升序</option>
                  </select>
                )}
              </div>
            </div>

            {/* 限制 */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-neutral-700">结果限制</label>
              <input
                type="number"
                value={state.limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 1000)}
                min={1}
                max={10000}
                className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            </div>
          </div>

          {/* 验证错误 */}
          {!validation.valid && (
            <div className="p-3 bg-danger-bg border border-danger-border rounded-lg">
              <ul className="text-sm text-danger list-disc list-inside">
                {validation.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* SQL 预览 */}
          {showPreview && (
            <div className="p-3 bg-neutral-900 rounded-lg overflow-x-auto">
              <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
                {generatedSql}
              </pre>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
            <div className="flex gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  buttonStyles.base,
                  buttonStyles.ghost,
                  buttonStyles.sizeSmall
                )}
              >
                {showPreview ? '隐藏预览' : 'SQL 预览'}
              </button>
              <button
                onClick={reset}
                className={cn(
                  buttonStyles.base,
                  buttonStyles.ghost,
                  buttonStyles.sizeSmall,
                  'gap-1'
                )}
              >
                <RotateCcw size={14} />
                重置
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={!validation.valid}
                className={cn(
                  buttonStyles.base,
                  buttonStyles.secondary,
                  buttonStyles.sizeSmall
                )}
              >
                生成 SQL
              </button>
              {onExecute && (
                <button
                  onClick={handleExecute}
                  disabled={!validation.valid}
                  className={cn(
                    buttonStyles.base,
                    buttonStyles.primary,
                    buttonStyles.sizeSmall,
                    'gap-1'
                  )}
                >
                  <Play size={14} />
                  执行查询
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
