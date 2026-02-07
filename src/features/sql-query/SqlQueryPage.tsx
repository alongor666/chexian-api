/**
 * SqlQueryPage 组件
 *
 * SQL 查询功能主页面
 */

import { useState } from 'react';
import { EnhancedSqlEditor } from './EnhancedSqlEditor';
import { TemplateLibrary } from './TemplateLibrary';
import { QueryResults } from './QueryResults';
import { ParameterForm } from './ParameterForm';
import { QueryBuilderPanel } from './queryBuilder';
import { AiSqlPanel } from './aiSql';
import { useQueryExecutor } from './useQueryExecutor';
import { generateSQL } from '../../shared/utils/templateEngine';
import type { QueryTemplate } from '../../shared/types/sql-query';
import { LayoutTemplate, Blocks, Sparkles } from 'lucide-react';
import { cn } from '../../shared/styles';
import { Logger } from '@/shared/utils/logger';
import { useDataStatus } from '../../shared/contexts/DataContext';

const logger = new Logger('SqlQueryPage');

/** 左侧面板模式 */
type LeftPanelMode = 'ai' | 'builder' | 'templates';

/**
 * SQL 查询页面
 */
export function SqlQueryPage() {
  const [sql, setSql] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<QueryTemplate | null>(null);
  const [showParameterForm, setShowParameterForm] = useState(false);
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>('ai');
  const { result, status, error, executeQuery, reset } = useQueryExecutor();
  const { isDataLoaded } = useDataStatus();

  /**
   * 选择模板
   */
  const handleSelectTemplate = (template: QueryTemplate) => {
    setSelectedTemplate(template);
    reset();

    if (template.parameters && template.parameters.length > 0) {
      setShowParameterForm(true);
    } else {
      if (typeof template.sql === 'string') {
        setSql(template.sql);
      } else {
        try {
          const generatedSQL = generateSQL(template.sql, template.parameters, {}, undefined);
          setSql(generatedSQL);
        } catch (err) {
          logger.error('Failed to generate SQL:', err);
          setSql('-- 生成 SQL 失败，请查看控制台错误信息');
        }
      }
      setShowParameterForm(false);
    }
  };

  /**
   * 参数表单生成 SQL
   */
  const handleParameterFormGenerate = (generatedSQL: string) => {
    setSql(generatedSQL);
    setShowParameterForm(false);
  };

  /**
   * 取消参数表单
   */
  const handleParameterFormCancel = () => {
    setShowParameterForm(false);
    setSelectedTemplate(null);
  };

  /**
   * 执行查询
   */
  const handleExecute = () => {
    if (!sql.trim()) {
      return;
    }
    executeQuery(sql);
  };

  /**
   * 清空编辑器
   */
  const handleClear = () => {
    setSql('');
    reset();
  };

  /**
   * 查询构建器生成SQL后的回调
   */
  const handleBuilderSqlGenerated = (generatedSql: string) => {
    setSql(generatedSql);
    reset();
  };

  /**
   * 查询构建器直接执行
   */
  const handleBuilderExecute = (generatedSql: string) => {
    setSql(generatedSql);
    executeQuery(generatedSql);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex">
      {/* 左侧面板 */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white border-r border-gray-200">
        {/* 模式切换标签 */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setLeftPanelMode('ai')}
            className={cn(
              'flex-1 px-3 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors',
              leftPanelMode === 'ai'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            )}
          >
            <Sparkles size={15} />
            AI
          </button>
          <button
            onClick={() => setLeftPanelMode('builder')}
            className={cn(
              'flex-1 px-3 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors',
              leftPanelMode === 'builder'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            )}
          >
            <Blocks size={15} />
            构建器
          </button>
          <button
            onClick={() => setLeftPanelMode('templates')}
            className={cn(
              'flex-1 px-3 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors',
              leftPanelMode === 'templates'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            )}
          >
            <LayoutTemplate size={15} />
            模板
          </button>
        </div>

        {/* 面板内容 */}
        <div className="flex-1 overflow-hidden">
          {leftPanelMode === 'ai' ? (
            <div className="h-full overflow-y-auto p-3">
              <AiSqlPanel
                onSqlGenerated={handleBuilderSqlGenerated}
                onExecute={handleBuilderExecute}
              />
            </div>
          ) : leftPanelMode === 'builder' ? (
            <div className="h-full overflow-y-auto p-3">
              <QueryBuilderPanel
                onSqlGenerated={handleBuilderSqlGenerated}
                onExecute={handleBuilderExecute}
              />
            </div>
          ) : (
            <TemplateLibrary onSelectTemplate={handleSelectTemplate} />
          )}
        </div>
      </div>

      {/* 右侧:编辑器 + 结果 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 参数表单（如果有） */}
          {showParameterForm && selectedTemplate && (
            <ParameterForm
              template={selectedTemplate}
              globalFilters={undefined}
              onGenerate={handleParameterFormGenerate}
              onCancel={handleParameterFormCancel}
            />
          )}

          {/* 编辑器区域 */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900">SQL 编辑器</h2>
              <div className="flex gap-2">
                <button
                  onClick={handleClear}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  清空
                </button>
                <button
                  onClick={handleExecute}
                  disabled={status === 'running' || !sql.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'running' ? '执行中...' : '执行查询'}
                </button>
              </div>
            </div>

            <EnhancedSqlEditor
              value={sql}
              onChange={setSql}
              onExecute={handleExecute}
              placeholder="-- 输入 SQL 查询语句，或从左侧选择模板/使用构建器
-- 按 Ctrl+Enter (Mac: Cmd+Enter) 执行查询
-- 按 Ctrl+Space 触发智能补全
SELECT COUNT(*) FROM PolicyFact"
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-red-400 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">查询失败</h3>
                  <div className="mt-2 text-sm text-red-700">{error}</div>
                </div>
              </div>
            </div>
          )}

          {/* 加载中提示 */}
          {status === 'running' && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex items-center">
                <svg
                  className="animate-spin h-5 w-5 text-blue-600"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span className="ml-3 text-sm font-medium text-blue-800">正在执行查询...</span>
              </div>
            </div>
          )}

          {/* 查询结果 */}
          {status === 'success' && result && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">查询结果</h2>
              <QueryResults result={result} />
            </div>
          )}

          {/* 空状态 */}
          {status === 'idle' && !error && (
            <div className="bg-gray-50 border border-gray-200 rounded-md p-12 text-center">
              {!isDataLoaded && (
                <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-md p-4">
                  <div className="flex">
                    <svg
                      className="w-5 h-5 text-yellow-400 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">数据未加载</h3>
                      <div className="mt-2 text-sm text-yellow-700">
                        请先在首页加载数据文件
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                {isDataLoaded ? '开始查询' : 'SQL 查询'}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {isDataLoaded
                  ? '使用左侧构建器或选择模板'
                  : '数据加载后可执行查询'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
