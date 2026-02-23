/**
 * useQueryExecutor Hook
 *
 * 封装 SQL 查询执行逻辑:
 * - SQL 验证
 * - 通过后端 API 执行查询
 * - 超时控制
 * - 执行时间统计
 * - 错误处理
 */

import { useState, useCallback, useRef } from 'react';
import { apiClient } from '../../shared/api/client';
import { validateSQL } from '../../shared/utils/sql-validator';
import { SECURITY_LIMITS } from '../../shared/utils/security';
import type { QueryResult, QueryStatus } from '../../shared/types/sql-query';
import { createLogger } from '../../shared/utils/logger';
import { formatCount } from '../../shared/utils/formatters';

const logger = createLogger('useQueryExecutor');

/**
 * 不存在字段的友好提示
 */
const FIELD_SUGGESTIONS: Record<string, string> = {
  endorsement_no: '批单号不在 PolicyFact 视图中，请查询原始数据表',
  endorsement_type: '批改类型不在 PolicyFact 视图中',
  new_vehicle_price: '新车购置价不在 PolicyFact 视图中',
  commercial_premium: "商业险保费请用 WHERE insurance_type='商业保险' 筛选",
  compulsory_premium: "交强险保费请用 WHERE insurance_type='交强险' 筛选",
  org_level_4: '四级机构请用 salesman_name 或 org_level_3',
  team_name: '团队名称请用 salesman_name',
  insurance_end_date: '保险止期不可用，请用 insurance_start_date',
  vehicle_type: '车辆类型请用 customer_category',
  plate_type: '车牌类型不可用',
  renewal_policy_no: '续保单号仅在 PolicyFactRenewal 视图可用',
};

/**
 * 将 DuckDB 错误转换为友好提示
 */
function friendlyErrorMessage(error: string): string {
  const columnMatch = error.match(/column\s+"?(\w+)"?\s+(?:not found|does not exist)/i)
    || error.match(/Referenced column\s+"?(\w+)"?\s+not found/i);

  if (columnMatch) {
    const field = columnMatch[1].toLowerCase();
    const suggestion = FIELD_SUGGESTIONS[field];
    if (suggestion) {
      return `字段 "${field}" 不存在 - ${suggestion}`;
    }
    return `字段 "${field}" 不存在，请检查 PolicyFact 视图可用字段`;
  }

  if (error.includes('syntax error')) {
    return 'SQL 语法错误，请检查括号、引号是否匹配';
  }

  if (error.includes('Table') && error.includes('not found')) {
    return '表不存在，请使用 PolicyFact 视图';
  }

  return error;
}

export interface UseQueryExecutorReturn {
  result: QueryResult | null;
  status: QueryStatus;
  error: string | null;
  executeQuery: (sql: string) => Promise<void>;
  reset: () => void;
}

/**
 * SQL 查询执行 Hook
 */
export function useQueryExecutor(config?: {
  timeout?: number;
  maxRows?: number;
}): UseQueryExecutorReturn {
  const timeout = config?.timeout ?? SECURITY_LIMITS.QUERY_TIMEOUT;
  const maxRows = config?.maxRows ?? SECURITY_LIMITS.MAX_RESULT_ROWS;

  const [status, setStatus] = useState<QueryStatus>('idle');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const batchRef = useRef(0);

  /**
   * 执行 SQL 查询（通过后端 API）
   */
  const executeQuery = useCallback(
    async (sql: string) => {
      // 1. 验证 SQL
      const validation = validateSQL(sql);
      if (!validation.valid) {
        setStatus('error');
        setError(validation.error || 'SQL 验证失败');
        setResult(null);
        return;
      }

      // 2. 开始新批次
      const currentBatch = ++batchRef.current;

      // 3. 更新状态为执行中
      setStatus('running');
      setError(null);
      setResult(null);

      const startTime = Date.now();

      try {
        // 4. 通过 API 执行查询（带超时控制）
        const apiPromise = apiClient.executeCustomQuery(sql);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`查询超时 (超过 ${timeout / 1000} 秒)`));
          }, timeout);
        });

        const rows: any[] = await Promise.race([apiPromise, timeoutPromise]);

        // 5. 检查批次是否仍然有效
        if (batchRef.current !== currentBatch) {
          logger.debug(`Batch ${currentBatch} expired, discarding results`);
          return;
        }

        // 6. 统计执行时间
        const executionTime = Date.now() - startTime;

        // 7. 检查结果行数限制
        const rowCount = rows.length;
        const columnCount = rowCount > 0 ? Object.keys(rows[0]).length : 0;

        if (rowCount > maxRows) {
          setStatus('error');
          setError(
            `查询结果行数过多 (${formatCount(rowCount)} 行)，建议添加 LIMIT 子句限制在 ${formatCount(maxRows)} 行以内`
          );
          return;
        }

        // 8. 构建结果对象
        const queryResult: QueryResult = {
          data: rows,
          rowCount,
          columnCount,
          executionTime,
          status: 'success',
          sql,
          timestamp: Date.now(),
        };

        setResult(queryResult);
        setStatus('success');
        setError(null);
      } catch (err) {
        if (batchRef.current !== currentBatch) {
          logger.debug('Batch expired during error handling, ignoring error');
          return;
        }

        const rawError = err instanceof Error ? err.message : '查询执行失败';
        const errorMessage = friendlyErrorMessage(rawError);
        setStatus('error');
        setError(errorMessage);
        setResult(null);
      }
    },
    [timeout, maxRows]
  );

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    status,
    error,
    executeQuery,
    reset,
  };
}
