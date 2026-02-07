/**
 * 筛选条件构建器组件
 */

import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { ALL_FIELDS, FILTER_OPERATORS, getFieldDefinition } from './fieldConfig';
import type { FilterCondition, FilterOperator } from './types';
import { cn } from '../../../shared/styles';
import { apiClient } from '../../../shared/api/client';
import { generateDistinctValuesSql } from './sqlGenerator';

import { Logger } from '@/shared/utils/logger';

const logger = new Logger('FilterBuilder');

export interface FilterBuilderProps {
  filters: FilterCondition[];
  onAdd: (field: string) => void;
  onUpdate: (id: string, updates: Partial<FilterCondition>) => void;
  onRemove: (id: string) => void;
}

/**
 * 单个筛选条件行
 */
function FilterRow({
  filter,
  onUpdate,
  onRemove,
}: {
  filter: FilterCondition;
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const [fieldOptions, setFieldOptions] = useState<string[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);

  const fieldDef = getFieldDefinition(filter.field);
  const dataType = fieldDef?.dataType || 'string';
  const operators = FILTER_OPERATORS[dataType] || FILTER_OPERATORS.string;

  // 加载字段选项（用于 IN/NOT IN）
  useEffect(() => {
    if (
      (filter.operator === 'IN' || filter.operator === 'NOT IN') &&
      filter.field &&
      dataType === 'string'
    ) {
      setIsLoadingOptions(true);
      const sql = generateDistinctValuesSql(filter.field, 50);
      apiClient.executeCustomQuery(sql)
        .then((rows) => {
          const values = rows.map((row: any) =>
            String(row[filter.field] || '')
          );
          setFieldOptions(values);
        })
        .catch((err: Error) => {
          logger.error('Failed to load field options:', err);
          setFieldOptions([]);
        })
        .finally(() => {
          setIsLoadingOptions(false);
        });
    }
  }, [filter.field, filter.operator, dataType]);

  const needsValue = !['IS NULL', 'IS NOT NULL'].includes(filter.operator);
  const needsSecondValue = filter.operator === 'BETWEEN';

  return (
    <div className="flex items-start gap-2 p-2 bg-neutral-50 rounded-lg">
      {/* 字段选择 */}
      <select
        value={filter.field}
        onChange={(e) => onUpdate({ field: e.target.value, value: null, value2: undefined })}
        className="w-32 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
      >
        <option value="">选择字段</option>
        {ALL_FIELDS.map((field) => (
          <option key={field.field} value={field.field}>
            {field.label}
          </option>
        ))}
      </select>

      {/* 操作符选择 */}
      <select
        value={filter.operator}
        onChange={(e) => {
          const op = e.target.value as FilterOperator;
          const updates: Partial<FilterCondition> = { operator: op };
          if (['IS NULL', 'IS NOT NULL'].includes(op)) {
            updates.value = null;
            updates.value2 = undefined;
          }
          onUpdate(updates);
        }}
        className="w-28 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {/* 值输入 */}
      {needsValue && (
        <>
          {filter.operator === 'IN' || filter.operator === 'NOT IN' ? (
            <div className="flex-1 relative">
              <select
                multiple
                value={Array.isArray(filter.value) ? filter.value : []}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, (opt) => opt.value);
                  onUpdate({ value: values });
                }}
                className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400 min-h-[60px]"
              >
                {isLoadingOptions ? (
                  <option disabled>加载中...</option>
                ) : fieldOptions.length > 0 ? (
                  fieldOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))
                ) : (
                  <option disabled>无可用选项</option>
                )}
              </select>
              <div className="text-xs text-neutral-400 mt-1">
                按住 Ctrl/Cmd 多选
              </div>
            </div>
          ) : dataType === 'boolean' ? (
            <select
              value={filter.value as string || ''}
              onChange={(e) => onUpdate({ value: e.target.value })}
              className="w-24 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              <option value="">选择</option>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ) : dataType === 'date' ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filter.value as string || ''}
                onChange={(e) => onUpdate({ value: e.target.value })}
                className="px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              {needsSecondValue && (
                <>
                  <span className="text-neutral-500">至</span>
                  <input
                    type="date"
                    value={filter.value2 || ''}
                    onChange={(e) => onUpdate({ value2: e.target.value })}
                    className="px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </>
              )}
            </div>
          ) : dataType === 'number' ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={filter.value as string || ''}
                onChange={(e) => onUpdate({ value: e.target.value })}
                placeholder="输入数值"
                className="w-24 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              {needsSecondValue && (
                <>
                  <span className="text-neutral-500">至</span>
                  <input
                    type="number"
                    value={filter.value2 || ''}
                    onChange={(e) => onUpdate({ value2: e.target.value })}
                    placeholder="输入数值"
                    className="w-24 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </>
              )}
            </div>
          ) : (
            <input
              type="text"
              value={filter.value as string || ''}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder={filter.operator === 'LIKE' ? '输入匹配模式' : '输入值'}
              className="flex-1 px-2 py-1.5 text-sm border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          )}
        </>
      )}

      {/* 删除按钮 */}
      <button
        onClick={onRemove}
        className="p-1.5 text-neutral-400 hover:text-danger hover:bg-danger-bg rounded"
        aria-label="删除筛选条件"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function FilterBuilder({ filters, onAdd, onUpdate, onRemove }: FilterBuilderProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-700">筛选条件</label>
        <span className="text-xs text-neutral-500">{filters.length} 条</span>
      </div>

      {filters.length > 0 && (
        <div className="space-y-2">
          {filters.map((filter) => (
            <FilterRow
              key={filter.id}
              filter={filter}
              onUpdate={(updates) => onUpdate(filter.id, updates)}
              onRemove={() => onRemove(filter.id)}
            />
          ))}
        </div>
      )}

      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded',
            'border border-dashed border-neutral-300',
            'text-neutral-600 hover:bg-neutral-50 hover:border-neutral-400',
            'transition-colors'
          )}
        >
          <Plus size={12} />
          添加筛选条件
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-20 w-48 bg-white rounded-lg shadow-lg border border-neutral-200 overflow-hidden max-h-64 overflow-y-auto">
              {ALL_FIELDS.map((field) => (
                <button
                  key={field.field}
                  onClick={() => {
                    onAdd(field.field);
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-primary-50 flex items-center justify-between"
                >
                  <span>{field.label}</span>
                  <span className="text-xs text-neutral-400">{field.dataType}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {filters.length === 0 && (
        <p className="text-xs text-neutral-500">
          可选：添加条件筛选数据
        </p>
      )}
    </div>
  );
}
