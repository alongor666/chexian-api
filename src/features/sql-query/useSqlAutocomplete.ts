/**
 * SQL 自动补全 Hook
 *
 * 为 Monaco 编辑器提供字段、函数、关键字的智能补全
 *
 * 功能：
 * - PolicyFact/PolicyFactRenewal 字段补全
 * - SQL 聚合函数补全
 * - SQL 关键字补全
 * - 上下文感知（根据当前位置提供不同建议）
 */

import { useEffect } from 'react';
import type { languages, editor } from 'monaco-editor';

/**
 * PolicyFact 视图字段定义
 */
const POLICY_FACT_FIELDS = [
  { name: 'policy_no', type: 'VARCHAR', comment: '保单号（禁止在 SELECT 中使用）' },
  { name: 'premium', type: 'DECIMAL', comment: '签单保费（元）' },
  { name: 'policy_date', type: 'DATE', comment: '签单日期' },
  { name: 'insurance_start_date', type: 'DATE', comment: '保险起期' },
  { name: 'salesman_name', type: 'VARCHAR', comment: '业务员姓名' },
  { name: 'org_level_3', type: 'VARCHAR', comment: '三级机构' },
  { name: 'customer_category', type: 'VARCHAR', comment: '客户类别' },
  { name: 'insurance_type', type: 'VARCHAR', comment: '险类' },
  { name: 'coverage_combination', type: 'VARCHAR', comment: '险别组合' },
  { name: 'is_renewal', type: 'INTEGER', comment: '是否续保（0/1）' },
  { name: 'is_new_car', type: 'INTEGER', comment: '是否新车（0/1）' },
  { name: 'is_transfer', type: 'INTEGER', comment: '是否过户（0/1）' },
  { name: 'is_nev', type: 'INTEGER', comment: '是否新能源（0/1）' },
  { name: 'is_telemarketing', type: 'INTEGER', comment: '是否电销（0/1）' },
  { name: 'tonnage_segment', type: 'VARCHAR', comment: '吨位分段' },
];

/**
 * PolicyFactRenewal 视图额外字段
 */
const RENEWAL_ONLY_FIELDS = [
  { name: 'renewal_policy_no', type: 'VARCHAR', comment: '续保单号' },
  { name: 'is_commercial_insure', type: 'INTEGER', comment: '是否交商统保（0/1）' },
];

/**
 * SQL 聚合函数
 */
const AGGREGATE_FUNCTIONS = [
  { name: 'COUNT', detail: '聚合函数：计数', example: 'COUNT(*)' },
  { name: 'SUM', detail: '聚合函数：求和', example: 'SUM(premium)' },
  { name: 'AVG', detail: '聚合函数：平均值', example: 'AVG(premium)' },
  { name: 'MAX', detail: '聚合函数：最大值', example: 'MAX(premium)' },
  { name: 'MIN', detail: '聚合函数：最小值', example: 'MIN(premium)' },
  { name: 'COUNT_DISTINCT', detail: '聚合函数：去重计数', example: 'COUNT(DISTINCT salesman_name)' },
];

/**
 * SQL 日期函数
 */
const DATE_FUNCTIONS = [
  { name: 'CAST', detail: '类型转换', example: "CAST(policy_date AS DATE)" },
  { name: 'YEAR', detail: '提取年份', example: 'YEAR(policy_date)' },
  { name: 'MONTH', detail: '提取月份', example: 'MONTH(policy_date)' },
  { name: 'DAY', detail: '提取日期', example: 'DAY(policy_date)' },
  { name: 'CURRENT_DATE', detail: '当前日期', example: 'CURRENT_DATE' },
  { name: 'DATE_TRUNC', detail: '日期截断', example: "DATE_TRUNC('month', policy_date)" },
  { name: 'STRFTIME', detail: '日期格式化', example: "STRFTIME(policy_date, '%Y-%m')" },
];

/**
 * SQL 字符串函数
 */
const STRING_FUNCTIONS = [
  { name: 'CONCAT', detail: '字符串连接', example: "CONCAT(org_level_3, '-', salesman_name)" },
  { name: 'UPPER', detail: '转大写', example: 'UPPER(customer_category)' },
  { name: 'LOWER', detail: '转小写', example: 'LOWER(customer_category)' },
  { name: 'TRIM', detail: '去除空格', example: 'TRIM(salesman_name)' },
  { name: 'LENGTH', detail: '字符串长度', example: 'LENGTH(customer_category)' },
];

/**
 * SQL 数学函数
 */
const MATH_FUNCTIONS = [
  { name: 'ROUND', detail: '四舍五入', example: 'ROUND(premium / 10000, 2)' },
  { name: 'FLOOR', detail: '向下取整', example: 'FLOOR(premium / 10000)' },
  { name: 'CEIL', detail: '向上取整', example: 'CEIL(premium / 10000)' },
  { name: 'ABS', detail: '绝对值', example: 'ABS(premium)' },
];

/**
 * SQL 关键字
 */
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
  'DISTINCT', 'ASC', 'DESC', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'WITH', 'JOIN', 'LEFT JOIN', 'INNER JOIN',
];

/**
 * SQL 自动补全 Hook
 *
 * @param monaco - Monaco 编辑器实例（可选）
 * @returns 清理函数
 */
export function useSqlAutocomplete(monaco?: typeof import('monaco-editor'), enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const monacoInstance =
      monaco ?? (typeof window !== 'undefined' ? ((window as any).monaco as typeof import('monaco-editor') | undefined) : undefined);
    if (!monacoInstance) {
      return;
    }

    /**
     * 注册自动补全提供器
     */
    const disposable = monacoInstance.languages.registerCompletionItemProvider('sql', {
      /**
       * 提供补全建议
       */
      provideCompletionItems: (
        model: editor.ITextModel,
        position: { lineNumber: number; column: number }
      ): languages.CompletionList => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: languages.CompletionItem[] = [];

        // 上下文分析
        const isAfterSelect = /SELECT\s+[^;]*$/i.test(textBeforeCursor) && !/FROM/i.test(textBeforeCursor);
        const isAfterFrom = /FROM\s+\w*$/i.test(textBeforeCursor);
        const isAfterWhere = /WHERE\s+[^;]*$/i.test(textBeforeCursor);
        const isAfterGroupBy = /GROUP\s+BY\s+[^;]*$/i.test(textBeforeCursor);

        // 1. 字段补全（SELECT 后、WHERE 后、GROUP BY 后）
        if (isAfterSelect || isAfterWhere || isAfterGroupBy) {
          POLICY_FACT_FIELDS.forEach((field) => {
            suggestions.push({
              label: field.name,
              kind: monacoInstance.languages.CompletionItemKind.Field,
              detail: `${field.type} - ${field.comment}`,
              documentation: field.comment,
              insertText: field.name,
              range,
            });
          });

          // 如果使用 PolicyFactRenewal 视图，添加额外字段
          if (/PolicyFactRenewal/i.test(model.getValue())) {
            RENEWAL_ONLY_FIELDS.forEach((field) => {
              suggestions.push({
                label: field.name,
                kind: monacoInstance.languages.CompletionItemKind.Field,
                detail: `${field.type} - ${field.comment} (仅 PolicyFactRenewal)`,
                documentation: field.comment,
                insertText: field.name,
                range,
              });
            });
          }
        }

        // 2. 聚合函数补全（SELECT 后）
        if (isAfterSelect) {
          AGGREGATE_FUNCTIONS.forEach((func) => {
            suggestions.push({
              label: func.name,
              kind: monacoInstance.languages.CompletionItemKind.Function,
              detail: func.detail,
              documentation: `示例: ${func.example}`,
              insertText: `${func.name}($0)`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            });
          });

          // 日期函数
          DATE_FUNCTIONS.forEach((func) => {
            suggestions.push({
              label: func.name,
              kind: monacoInstance.languages.CompletionItemKind.Function,
              detail: func.detail,
              documentation: `示例: ${func.example}`,
              insertText: func.name === 'CURRENT_DATE' ? func.name : `${func.name}($0)`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            });
          });

          // 字符串函数
          STRING_FUNCTIONS.forEach((func) => {
            suggestions.push({
              label: func.name,
              kind: monacoInstance.languages.CompletionItemKind.Function,
              detail: func.detail,
              documentation: `示例: ${func.example}`,
              insertText: `${func.name}($0)`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            });
          });

          // 数学函数
          MATH_FUNCTIONS.forEach((func) => {
            suggestions.push({
              label: func.name,
              kind: monacoInstance.languages.CompletionItemKind.Function,
              detail: func.detail,
              documentation: `示例: ${func.example}`,
              insertText: `${func.name}($0)`,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            });
          });
        }

        // 3. 表名补全（FROM 后）
        if (isAfterFrom) {
          suggestions.push(
            {
              label: 'PolicyFact',
              kind: monacoInstance.languages.CompletionItemKind.Class,
              detail: '保单事实表（已去重）',
              documentation: '包含签单保费、日期、机构、业务员等核心字段',
              insertText: 'PolicyFact',
              range,
            },
            {
              label: 'PolicyFactRenewal',
              kind: monacoInstance.languages.CompletionItemKind.Class,
              detail: '保单事实表（含续保信息）',
              documentation: '在 PolicyFact 基础上新增续保单号、是否交商统保字段',
              insertText: 'PolicyFactRenewal',
              range,
            }
          );
        }

        // 4. SQL 关键字补全
        SQL_KEYWORDS.forEach((keyword) => {
          suggestions.push({
            label: keyword,
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            detail: 'SQL 关键字',
            insertText: keyword,
            range,
          });
        });

        return { suggestions };
      },
    });

    // 清理函数
    return () => {
      disposable.dispose();
    };
  }, [monaco, enabled]);
}
