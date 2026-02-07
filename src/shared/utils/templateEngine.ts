/**
 * SQL 模板引擎
 *
 * 提供 SQL 模板的占位符插值、条件逻辑处理和防注入转义
 *
 * 支持的语法：
 * - 变量插值：{{param_name}}
 * - 条件逻辑：{{#if param_name}}...{{/if}}
 * - 条件取反：{{#unless param_name}}...{{/unless}}
 *
 * 安全机制：
 * - 所有值自动转义（防 SQL 注入）
 * - 支持白名单验证
 * - 参数类型验证
 */

import type { QueryParameter } from '../types/sql-query';

/**
 * SQL 值转义（防注入）
 *
 * @param value - 待转义的值
 * @returns 转义后的 SQL 安全字符串
 */
export function escapeSQLValue(value: any): string {
  // NULL 值
  if (value === null || value === undefined) {
    return 'NULL';
  }

  // 数字类型
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error(`Invalid number value: ${value}`);
    }
    return String(value);
  }

  // 布尔类型
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  // 数组类型（用于 IN 子句）
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error('Array parameter cannot be empty for SQL IN clause');
    }
    return `(${value.map((v) => escapeSQLValue(v)).join(', ')})`;
  }

  // 日期类型
  if (value instanceof Date) {
    const dateStr = value.toISOString().split('T')[0]; // YYYY-MM-DD
    return `'${dateStr}'`;
  }

  // 字符串类型：单引号转义
  const str = String(value);
  // 检测潜在的注入攻击模式
  if (/[\x00\x08\x09\x1a\n\r"'\\\%]/g.test(str)) {
    // 转义特殊字符
    const escaped = str
      .replace(/\\/g, '\\\\') // 反斜杠
      .replace(/'/g, "''") // 单引号
      .replace(/"/g, '\\"') // 双引号
      .replace(/\x00/g, '\\0') // NULL
      .replace(/\x08/g, '\\b') // Backspace
      .replace(/\x09/g, '\\t') // Tab
      .replace(/\x1a/g, '\\z') // Ctrl+Z
      .replace(/\n/g, '\\n') // 换行
      .replace(/\r/g, '\\r'); // 回车
    return `'${escaped}'`;
  }

  // 普通字符串
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * 验证参数值是否符合参数定义
 *
 * @param value - 参数值
 * @param param - 参数定义
 * @throws Error 如果验证失败
 */
export function validateParameterValue(value: any, param: QueryParameter): void {
  // 必填验证
  if (param.required && (value === null || value === undefined || value === '')) {
    throw new Error(`参数 "${param.label}" 是必填项`);
  }

  // 如果值为空且非必填，跳过其他验证
  if (!param.required && (value === null || value === undefined || value === '')) {
    return;
  }

  // 类型验证
  switch (param.type) {
    case 'number':
      if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`参数 "${param.label}" 必须是有效的数字`);
      }
      // 范围验证
      if (param.validation) {
        if (param.validation.min !== undefined && value < param.validation.min) {
          throw new Error(
            param.validation.message ||
              `参数 "${param.label}" 不能小于 ${param.validation.min}`
          );
        }
        if (param.validation.max !== undefined && value > param.validation.max) {
          throw new Error(
            param.validation.message ||
              `参数 "${param.label}" 不能大于 ${param.validation.max}`
          );
        }
      }
      break;

    case 'date':
      // 接受字符串或 Date 对象
      if (typeof value === 'string') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error(`参数 "${param.label}" 必须是 YYYY-MM-DD 格式的日期`);
        }
      } else if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error(`参数 "${param.label}" 必须是有效的日期`);
      }
      break;

    case 'text':
      if (typeof value !== 'string') {
        throw new Error(`参数 "${param.label}" 必须是字符串`);
      }
      // 正则验证
      if (param.validation?.pattern) {
        const regex = new RegExp(param.validation.pattern);
        if (!regex.test(value)) {
          throw new Error(
            param.validation.message || `参数 "${param.label}" 格式不正确`
          );
        }
      }
      break;

    case 'select':
    case 'multiselect':
      // 选项验证（如果提供了静态选项）
      if (param.options && param.options.length > 0) {
        const validValues = param.options.map((opt) => opt.value);
        const valuesToCheck = Array.isArray(value) ? value : [value];
        const invalidValues = valuesToCheck.filter((v) => !validValues.includes(v));
        if (invalidValues.length > 0) {
          throw new Error(
            `参数 "${param.label}" 包含无效的选项: ${invalidValues.join(', ')}`
          );
        }
      }
      break;
  }
}

/**
 * 占位符插值
 *
 * 支持以下语法：
 * - {{param_name}} - 变量插值
 * - {{#if param_name}}...{{/if}} - 条件判断（真值检测）
 * - {{#unless param_name}}...{{/unless}} - 条件取反
 *
 * @param template - SQL 模板字符串
 * @param params - 参数对象
 * @param options - 配置选项
 * @returns 插值后的 SQL 字符串
 */
export function interpolateSQL(
  template: string,
  params: Record<string, any>,
  options: { escape: boolean } = { escape: true }
): string {
  let sql = template;

  // 1. 处理条件逻辑 {{#if param}}...{{/if}}
  sql = sql.replace(/\{\{#if\s+(\w+)\}\}(.*?)\{\{\/if\}\}/gs, (_match, paramName, content) => {
    const value = params[paramName];
    // 真值检测：非 null、undefined、false、0、''
    const isTruthy = value !== null && value !== undefined && value !== false && value !== 0 && value !== '';
    return isTruthy ? content : '';
  });

  // 2. 处理条件取反 {{#unless param}}...{{/unless}}
  sql = sql.replace(
    /\{\{#unless\s+(\w+)\}\}(.*?)\{\{\/unless\}\}/gs,
    (_match, paramName, content) => {
      const value = params[paramName];
      const isFalsy = value === null || value === undefined || value === false || value === 0 || value === '';
      return isFalsy ? content : '';
    }
  );

  // 3. 替换变量 {{param_name}}
  sql = sql.replace(/\{\{(\w+)\}\}/g, (_match, paramName) => {
    if (!(paramName in params)) {
      throw new Error(`缺少必需的参数: ${paramName}`);
    }

    const value = params[paramName];

    // 如果禁用转义（谨慎使用！）
    if (!options.escape) {
      return String(value);
    }

    // 默认转义
    return escapeSQLValue(value);
  });

  return sql;
}

/**
 * 从全局筛选器中提取参数值
 *
 * 根据模板参数的 globalFilterKey 配置，从全局筛选器中提取对应的值
 *
 * @param parameters - 参数定义列表
 * @param globalFilters - 全局筛选器对象
 * @returns 提取的参数对象
 */
export function extractGlobalFilters(
  parameters: QueryParameter[] | undefined,
  globalFilters: any
): Record<string, any> {
  if (!parameters || parameters.length === 0) {
    return {};
  }

  const extracted: Record<string, any> = {};

  for (const param of parameters) {
    // 只处理配置了继承全局筛选器的参数
    if (param.inheritsGlobalFilter !== false && param.globalFilterKey) {
      const globalValue = globalFilters[param.globalFilterKey];
      if (globalValue !== undefined && globalValue !== null) {
        extracted[param.name] = globalValue;
      }
    }
  }

  return extracted;
}

/**
 * 生成 SQL（综合处理）
 *
 * 支持字符串模板和函数两种形式，自动处理参数验证、全局筛选器继承、占位符插值
 *
 * @param sqlTemplate - SQL 模板（字符串或函数）
 * @param parameters - 参数定义列表
 * @param paramValues - 用户提供的参数值
 * @param globalFilters - 全局筛选器（可选）
 * @returns 生成的 SQL 字符串
 */
export function generateSQL(
  sqlTemplate: string | ((params: Record<string, any>, globalFilters?: any) => string),
  parameters: QueryParameter[] | undefined,
  paramValues: Record<string, any>,
  globalFilters?: any
): string {
  // 1. 验证参数
  if (parameters) {
    for (const param of parameters) {
      const value = paramValues[param.name];
      try {
        validateParameterValue(value, param);
      } catch (error) {
        throw new Error(`参数验证失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 2. 合并全局筛选器和用户参数
  const globalParams = extractGlobalFilters(parameters, globalFilters || {});
  const mergedParams = {
    ...globalParams, // 全局筛选器优先级较低
    ...paramValues, // 用户参数优先级较高（可覆盖全局筛选器）
  };

  // 3. 生成 SQL
  if (typeof sqlTemplate === 'function') {
    // 函数形式：直接调用
    return sqlTemplate(mergedParams, globalFilters);
  } else {
    // 字符串模板：占位符插值
    return interpolateSQL(sqlTemplate, mergedParams, { escape: true });
  }
}
