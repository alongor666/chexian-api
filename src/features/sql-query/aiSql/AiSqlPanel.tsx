/**
 * AI SQL 生成面板
 *
 * 使用智谱 GLM 将自然语言转换为 SQL
 * 工作流可视化 + SQL 验证
 */

import { useState, useCallback } from 'react';
import { Sparkles, Send, Settings2, Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { validateApiKey } from './zhipuClient';
import { getStoredConfig, saveConfig, hasApiKey, isUsingEnvKey } from './configStore';
import { AVAILABLE_MODELS, DEFAULT_MODEL } from './types';
import { useAiWorkflow } from './useAiWorkflow';
import { WorkflowSteps } from './WorkflowSteps';
import { cn, cardStyles, buttonStyles, inputStyles } from '../../../shared/styles';

export interface AiSqlPanelProps {
  /** SQL 生成后的回调 */
  onSqlGenerated: (sql: string) => void;
  /** 执行查询 */
  onExecute?: (sql: string) => void;
}

export function AiSqlPanel({ onSqlGenerated, onExecute }: AiSqlPanelProps) {
  const [query, setQuery] = useState('');
  const [showConfig, setShowConfig] = useState(!hasApiKey());
  const [apiKey, setApiKey] = useState(() => getStoredConfig().apiKey);
  const [selectedModel, setSelectedModel] = useState(() => getStoredConfig().model || DEFAULT_MODEL);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // 工作流 Hook
  const { workflow, error, isRunning, tokens, run, reset } = useAiWorkflow();

  // 保存配置
  const handleSaveConfig = useCallback(async () => {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      setConfigError('请输入 API Key');
      return;
    }

    // 验证 API Key 格式: {id}.{secret}
    const parts = trimmedKey.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setConfigError('API Key 格式错误，应为 {id}.{secret} 格式');
      setValidationResult(false);
      return;
    }

    setIsValidating(true);
    setValidationResult(null);
    setConfigError(null);

    const isValid = await validateApiKey(trimmedKey, selectedModel);

    setIsValidating(false);
    setValidationResult(isValid);

    if (isValid) {
      saveConfig({ apiKey: trimmedKey, model: selectedModel });
      setShowConfig(false);
      setConfigError(null);
    } else {
      setConfigError('API Key 验证失败，请检查密钥是否正确或已过期');
    }
  }, [apiKey, selectedModel]);

  // 生成 SQL
  const handleGenerate = useCallback(async () => {
    if (!query.trim()) return;

    reset();
    const result = await run(query.trim());

    if (result.success && result.sql) {
      onSqlGenerated(result.sql);
    }
  }, [query, run, reset, onSqlGenerated]);

  // 生成并执行
  const handleGenerateAndExecute = useCallback(async () => {
    if (!query.trim() || !onExecute) return;

    reset();
    const result = await run(query.trim());

    if (result.success && result.sql) {
      onSqlGenerated(result.sql);
      onExecute(result.sql);
    }
  }, [query, run, reset, onSqlGenerated, onExecute]);

  // 快捷键处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey && onExecute) {
        handleGenerateAndExecute();
      } else {
        handleGenerate();
      }
    }
  };

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === selectedModel);

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      {/* 标题栏 */}
      <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-neutral-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" />
          <span className="font-medium text-neutral-800">AI 查询助手</span>
          {isUsingEnvKey() && (
            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">预设</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 当前模型 */}
          {currentModel && (
            <span className="text-xs text-neutral-500 flex items-center gap-1">
              <Zap size={12} className="text-yellow-500" />
              {currentModel.name}
            </span>
          )}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={cn(
              'p-1.5 rounded hover:bg-white/50 transition-colors',
              showConfig && 'bg-white/50'
            )}
            title="设置"
          >
            <Settings2 size={16} className="text-neutral-600" />
          </button>
        </div>
      </div>

      {/* 配置面板 */}
      {showConfig && (
        <div className="p-4 bg-neutral-50 border-b border-neutral-200 space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-neutral-700">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setValidationResult(null);
              }}
              placeholder="格式: xxxxxxxx.xxxxxxxxxxxxxxxx"
              className={cn(inputStyles.base, inputStyles.default)}
            />
            <p className="text-xs text-neutral-500">
              获取地址：
              <a
                href="https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline ml-1"
              >
                open.bigmodel.cn
              </a>
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-neutral-700">模型</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className={cn(inputStyles.base, inputStyles.default)}
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} - {m.description}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveConfig}
              disabled={isValidating || !apiKey.trim()}
              className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
            >
              {isValidating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  验证中...
                </>
              ) : (
                '保存配置'
              )}
            </button>
            {validationResult === true && (
              <span className="text-success text-sm flex items-center gap-1">
                <CheckCircle2 size={14} />
                验证成功
              </span>
            )}
            {validationResult === false && (
              <span className="text-danger text-sm flex items-center gap-1">
                <AlertCircle size={14} />
                验证失败
              </span>
            )}
          </div>

          {configError && (
            <div className="flex items-start gap-2 p-2 bg-danger-bg rounded text-sm text-danger">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{configError}</span>
            </div>
          )}
        </div>
      )}

      {/* 输入区域 */}
      <div className="p-4 space-y-3">
        <div className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="用自然语言描述你的查询需求...&#10;&#10;例如：&#10;• 2025年起保、分客户类别的交三业务保单件数&#10;• 各机构的续保率排名&#10;• 最近30天保费趋势"
            className={cn(
              inputStyles.base,
              inputStyles.default,
              'min-h-[100px] resize-none'
            )}
            disabled={isRunning}
          />
        </div>

        {/* 工作流可视化 */}
        <WorkflowSteps workflow={workflow} />

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 p-2 bg-danger-bg rounded text-sm text-danger">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Token 使用情况 */}
        {tokens && (
          <div className="text-xs text-neutral-500 flex items-center gap-2">
            <span>Token: {tokens.prompt} + {tokens.completion} = {tokens.prompt + tokens.completion}</span>
            {workflow.totalDuration && (
              <span className="text-green-600 font-medium">
                {workflow.totalDuration}ms
              </span>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            ⌘+Enter 生成 · ⌘+⇧+Enter 执行
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={isRunning || !query.trim()}
              className={cn(
                buttonStyles.base,
                buttonStyles.secondary,
                buttonStyles.sizeSmall,
                'gap-1'
              )}
            >
              {isRunning ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              生成 SQL
            </button>
            {onExecute && (
              <button
                onClick={handleGenerateAndExecute}
                disabled={isRunning || !query.trim()}
                className={cn(
                  buttonStyles.base,
                  buttonStyles.primary,
                  buttonStyles.sizeSmall,
                  'gap-1'
                )}
              >
                {isRunning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                生成并执行
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
