/**
 * ParameterForm 组件
 *
 * 根据查询模板的参数定义动态渲染表单
 *
 * 功能：
 * - 支持多种参数类型（date、number、text、select、multiselect）
 * - 防重复筛选：继承全局筛选器值
 * - 参数验证
 * - 动态选项加载（通过 API 查询）
 */

import { useState, useEffect } from 'react';
import type { QueryTemplate, QueryParameter } from '../../shared/types/sql-query';
import { generateSQL } from '../../shared/utils/templateEngine';
import { apiClient } from '../../shared/api/client';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ParameterForm');

export interface ParameterFormProps {
  template: QueryTemplate;
  globalFilters?: any;
  onGenerate: (sql: string) => void;
  onCancel: () => void;
}

/**
 * 参数表单组件
 */
export function ParameterForm({ template, globalFilters, onGenerate, onCancel }: ParameterFormProps) {
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, Array<{ label: string; value: any }>>>({});
  const [loadingOptions, setLoadingOptions] = useState<Set<string>>(new Set());

  // 初始化默认值
  useEffect(() => {
    if (!template.parameters) return;

    const initialValues: Record<string, any> = {};
    for (const param of template.parameters) {
      if (param.inheritsGlobalFilter !== false && param.globalFilterKey && globalFilters) {
        const globalValue = globalFilters[param.globalFilterKey];
        if (globalValue !== undefined && globalValue !== null) {
          initialValues[param.name] = globalValue;
          continue;
        }
      }

      if (param.defaultValue !== undefined) {
        initialValues[param.name] = param.defaultValue;
      }
    }

    setParamValues(initialValues);
  }, [template.parameters, globalFilters]);

  // 加载动态选项
  useEffect(() => {
    if (!template.parameters) return;

    for (const param of template.parameters) {
      if (param.dynamicOptions && !dynamicOptions[param.name]) {
        loadDynamicOptions(param);
      }
    }
  }, [template.parameters]);

  /**
   * 加载动态选项（通过 API 执行查询）
   */
  const loadDynamicOptions = async (param: QueryParameter) => {
    if (!param.dynamicOptions) return;

    setLoadingOptions((prev) => new Set(prev).add(param.name));

    try {
      const rows = await apiClient.executeCustomQuery(param.dynamicOptions.query);
      const options = rows.map((row: any) => ({
        value: row[param.dynamicOptions!.valueColumn],
        label: param.dynamicOptions!.labelColumn
          ? row[param.dynamicOptions!.labelColumn]
          : row[param.dynamicOptions!.valueColumn],
      }));

      setDynamicOptions((prev) => ({ ...prev, [param.name]: options }));
    } catch (error) {
      logger.error(`Failed to load options for ${param.name}:`, error);
      setErrors((prev) => ({
        ...prev,
        [param.name]: `选项加载失败: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setLoadingOptions((prev) => {
        const next = new Set(prev);
        next.delete(param.name);
        return next;
      });
    }
  };

  /**
   * 过滤掉已被全局筛选器覆盖的参数
   */
  const getVisibleParameters = (): QueryParameter[] => {
    if (!template.parameters) return [];

    return template.parameters.filter((param) => {
      if (param.inheritsGlobalFilter === false) return true;
      if (!param.globalFilterKey) return true;
      if (!globalFilters) return true;
      const globalValue = globalFilters[param.globalFilterKey];
      return globalValue === undefined || globalValue === null;
    });
  };

  /**
   * 更新参数值
   */
  const handleChange = (paramName: string, value: any) => {
    setParamValues((prev) => ({ ...prev, [paramName]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[paramName];
      return next;
    });
  };

  /**
   * 生成 SQL
   */
  const handleGenerate = () => {
    try {
      const sql = generateSQL(template.sql, template.parameters, paramValues, globalFilters);
      onGenerate(sql);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const paramMatch = errorMessage.match(/参数.*?"(.+?)"/);
      if (paramMatch) {
        setErrors({ [paramMatch[1]]: errorMessage });
      } else {
        setErrors({ _general: errorMessage });
      }
    }
  };

  /**
   * 渲染参数输入控件
   */
  const renderParameter = (param: QueryParameter) => {
    const value = paramValues[param.name];
    const error = errors[param.name];
    const isLoading = loadingOptions.has(param.name);

    const options = param.options || dynamicOptions[param.name] || [];

    return (
      <div key={param.name} className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">
          {param.label}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>

        {param.type === 'text' && (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => handleChange(param.name, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              error ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            placeholder={param.helpText}
          />
        )}

        {param.type === 'number' && (
          <input
            type="number"
            value={value ?? ''}
            onChange={(e) => handleChange(param.name, e.target.value ? Number(e.target.value) : null)}
            min={param.validation?.min}
            max={param.validation?.max}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              error ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            placeholder={param.helpText}
          />
        )}

        {param.type === 'date' && (
          <input
            type="date"
            value={value || ''}
            onChange={(e) => handleChange(param.name, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              error ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        )}

        {param.type === 'select' && (
          <select
            value={value || ''}
            onChange={(e) => handleChange(param.name, e.target.value)}
            disabled={isLoading}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              error ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100`}
          >
            <option value="">
              {isLoading ? '加载选项中...' : param.required ? '请选择' : '不限'}
            </option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}

        {param.type === 'multiselect' && (
          <select
            multiple
            value={Array.isArray(value) ? value : []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
              handleChange(param.name, selected);
            }}
            disabled={isLoading}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              error ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100`}
            size={Math.min(options.length, 5)}
          >
            {isLoading ? (
              <option disabled>加载选项中...</option>
            ) : (
              options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>
        )}

        {param.helpText && !error && (
          <p className="text-xs text-gray-500">{param.helpText}</p>
        )}

        {param.inheritsGlobalFilter !== false &&
          param.globalFilterKey &&
          globalFilters &&
          globalFilters[param.globalFilterKey] !== undefined &&
          globalFilters[param.globalFilterKey] !== null && (
            <p className="text-xs text-blue-600">
              ✓ 已继承全局筛选器的值: {String(globalFilters[param.globalFilterKey])}
            </p>
          )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  };

  const visibleParameters = getVisibleParameters();

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">参数设置</h3>
          <p className="text-xs text-gray-500 mt-1">
            {template.name} - {template.description}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
          title="取消"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {visibleParameters.length === 0 ? (
        <div className="text-center py-4 text-sm text-gray-500">
          无需设置参数（已继承全局筛选器）
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleParameters.map((param) => renderParameter(param))}
        </div>
      )}

      {errors._general && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {errors._general}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={handleGenerate}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
        >
          生成 SQL
        </button>
      </div>
    </div>
  );
}
