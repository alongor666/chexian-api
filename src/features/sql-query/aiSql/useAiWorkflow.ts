/**
 * AI SQL 生成工作流 Hook
 *
 * 可视化工作流：解析需求 → 生成SQL → 验证语法 → 完成
 */

import { useState, useCallback, useRef } from 'react';
import type { WorkflowStep, WorkflowState, AISqlResult } from './types';
import { generateSqlWithZhipu } from './zhipuClient';
import { getStoredConfig } from './configStore';
import { validateWithDuckDB, quickSyntaxCheck } from './sqlValidator';

const INITIAL_STEPS: WorkflowStep[] = [
  { id: 'parse', name: '解析需求', status: 'pending' },
  { id: 'generate', name: '生成 SQL', status: 'pending' },
  { id: 'validate', name: '验证语法', status: 'pending' },
  { id: 'complete', name: '完成', status: 'pending' },
];

export interface UseAiWorkflowResult {
  workflow: WorkflowState;
  sql: string;
  error: string | null;
  isRunning: boolean;
  tokens: { prompt: number; completion: number } | null;
  run: (query: string) => Promise<AISqlResult>;
  reset: () => void;
}

export function useAiWorkflow(): UseAiWorkflowResult {
  const [workflow, setWorkflow] = useState<WorkflowState>({
    steps: INITIAL_STEPS.map((s) => ({ ...s })),
  });
  const [sql, setSql] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [tokens, setTokens] = useState<{ prompt: number; completion: number } | null>(null);

  const startTimeRef = useRef<number>(0);
  const stepTimesRef = useRef<Record<string, number>>({});

  // 更新步骤状态
  const updateStep = useCallback(
    (stepId: string, status: WorkflowStep['status'], message?: string) => {
      const now = performance.now();
      const duration = stepTimesRef.current[stepId]
        ? Math.round(now - stepTimesRef.current[stepId])
        : undefined;

      setWorkflow((prev) => ({
        ...prev,
        steps: prev.steps.map((step) =>
          step.id === stepId ? { ...step, status, message, duration } : step
        ),
        totalDuration: Math.round(now - startTimeRef.current),
      }));
    },
    []
  );

  // 开始步骤计时
  const startStep = useCallback((stepId: string) => {
    stepTimesRef.current[stepId] = performance.now();
    updateStep(stepId, 'running');
  }, [updateStep]);

  // 重置工作流
  const reset = useCallback(() => {
    setWorkflow({
      steps: INITIAL_STEPS.map((s) => ({ ...s })),
    });
    setSql('');
    setError(null);
    setTokens(null);
  }, []);

  // 运行工作流
  const run = useCallback(
    async (query: string): Promise<AISqlResult> => {
      // 重置状态
      reset();
      setIsRunning(true);
      startTimeRef.current = performance.now();
      stepTimesRef.current = {};

      const config = getStoredConfig();

      try {
        // Step 1: 解析需求
        startStep('parse');
        await new Promise((r) => setTimeout(r, 50)); // 短暂延迟让 UI 更新

        if (!query.trim()) {
          updateStep('parse', 'error', '请输入查询需求');
          throw new Error('请输入查询需求');
        }

        if (!config.apiKey) {
          updateStep('parse', 'error', '未配置 API Key');
          throw new Error('请先配置智谱 API Key');
        }

        updateStep('parse', 'success', `"${query.slice(0, 20)}${query.length > 20 ? '...' : ''}"`);

        // Step 2: 生成 SQL
        startStep('generate');
        const result = await generateSqlWithZhipu(query, {
          apiKey: config.apiKey,
          model: config.model,
        });

        if (!result.success) {
          updateStep('generate', 'error', result.error);
          throw new Error(result.error || '生成失败');
        }

        if (result.tokens) {
          setTokens({ prompt: result.tokens.prompt, completion: result.tokens.completion });
        }

        updateStep('generate', 'success', `${result.sql.length} 字符`);

        // Step 3: 验证语法
        startStep('validate');

        // 快速检查
        const quickResult = quickSyntaxCheck(result.sql);
        if (!quickResult.valid) {
          updateStep('validate', 'error', quickResult.error);
          throw new Error(quickResult.error + (quickResult.suggestion ? ` (${quickResult.suggestion})` : ''));
        }

        // DuckDB 验证
        const validation = await validateWithDuckDB(result.sql);
        if (!validation.valid) {
          updateStep('validate', 'error', validation.error);
          // 不抛出错误，允许用户查看和编辑
          setSql(result.sql);
          setError(`SQL 验证警告: ${validation.error}${validation.suggestion ? ` - ${validation.suggestion}` : ''}`);

          // 继续到完成步骤，但标记为警告
          updateStep('complete', 'success', '有警告');

          return {
            success: true,
            sql: result.sql,
            error: validation.error,
            tokens: result.tokens,
          };
        }

        updateStep('validate', 'success', '语法正确');

        // Step 4: 完成
        updateStep('complete', 'success', `耗时 ${Math.round(performance.now() - startTimeRef.current)}ms`);

        setSql(result.sql);
        setError(null);

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误';
        setError(errorMessage);

        return {
          success: false,
          sql: '',
          error: errorMessage,
        };
      } finally {
        setIsRunning(false);
        setWorkflow((prev) => ({
          ...prev,
          totalDuration: Math.round(performance.now() - startTimeRef.current),
        }));
      }
    },
    [reset, startStep, updateStep]
  );

  return {
    workflow,
    sql,
    error,
    isRunning,
    tokens,
    run,
    reset,
  };
}
