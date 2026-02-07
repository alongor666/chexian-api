/**
 * 系统设置组件
 *
 * 提供系统相关设置：
 * - 缓存管理
 * - 数据管理
 * - 性能设置
 */

import React, { useState, useCallback } from 'react';
import {
  safeStorage,
  getStorageBoolean,
  setStorageBoolean,
} from '../../shared/utils/storage';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('SystemSettings');

/**
 * 系统设置组件
 */
export const SystemSettings: React.FC = () => {
  const [isClearing, setIsClearing] = useState(false);
  const [autoSave, setAutoSave] = useState(() => {
    return getStorageBoolean('auto-save', true);
  });
  const [showDebug, setShowDebug] = useState(() => {
    return getStorageBoolean('show-debug', false);
  });

  const handleClearCache = useCallback(async () => {
    setIsClearing(true);
    try {
      // 清除 localStorage（保留关键设置）
      const keysToKeep = ['theme-mode', 'auto-save', 'show-debug'];
      safeStorage.clear(keysToKeep);

      // 模拟清除延迟
      await new Promise((resolve) => setTimeout(resolve, 500));

      alert('缓存已清除');
    } catch (error) {
      logger.error('Clear cache failed:', error);
      alert('清除缓存失败');
    } finally {
      setIsClearing(false);
    }
  }, []);

  const handleToggleAutoSave = useCallback((value: boolean) => {
    setAutoSave(value);
    setStorageBoolean('auto-save', value);
  }, []);

  const handleToggleDebug = useCallback((value: boolean) => {
    setShowDebug(value);
    setStorageBoolean('show-debug', value);
  }, []);

  const handleExportSettings = useCallback(() => {
    const settings = {
      'theme-mode': safeStorage.getItem('theme-mode'),
      'auto-save': safeStorage.getItem('auto-save'),
      'show-debug': safeStorage.getItem('show-debug'),
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">系统设置</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          管理应用程序的系统级设置
        </p>
      </div>

      {/* 开关设置 */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">常规设置</h4>

        {/* 自动保存 */}
        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <div className="font-medium text-gray-900 dark:text-white">自动保存筛选器</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              自动记住您的筛选条件选择
            </p>
          </div>
          <button
            onClick={() => handleToggleAutoSave(!autoSave)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoSave ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoSave ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 调试模式 */}
        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <div className="font-medium text-gray-900 dark:text-white">开发者模式</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              显示调试信息和性能指标
            </p>
          </div>
          <button
            onClick={() => handleToggleDebug(!showDebug)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showDebug ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showDebug ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">数据管理</h4>

        {/* 清除缓存 */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">清除缓存</div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                清除本地存储的临时数据
              </p>
            </div>
            <button
              onClick={handleClearCache}
              disabled={isClearing}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                isClearing
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'
              }`}
            >
              {isClearing ? '清除中...' : '清除'}
            </button>
          </div>
        </div>

        {/* 导出设置 */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">导出设置</div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                导出当前设置为 JSON 文件
              </p>
            </div>
            <button
              onClick={handleExportSettings}
              className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
            >
              导出
            </button>
          </div>
        </div>
      </div>

      {/* 系统信息 */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">系统信息</h4>

        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">版本</span>
            <span className="font-mono text-gray-900 dark:text-white">v2.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">数据库引擎</span>
            <span className="font-mono text-gray-900 dark:text-white">DuckDB-WASM</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">构建环境</span>
            <span className="font-mono text-gray-900 dark:text-white">Vite + React</span>
          </div>
        </div>
      </div>
    </div>
  );
};
