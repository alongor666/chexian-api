/**
 * 导出上下文 — 连接页面数据与全局 ExportModal
 *
 * 各页面/Tab 通过 useRegisterExport() 注册导出处理器，
 * ExportModal 通过 useExportContext() 消费。
 * 仅保留最后注册的处理器（活跃 Tab），卸载自动清理。
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';

export interface ExportHandler {
  /** 页面/Tab 标识，用于文件名 */
  pageName: string;
  /** 执行导出（format: 'csv' | 'xlsx'） */
  handler: (format: 'csv' | 'xlsx') => Promise<void> | void;
}

interface ExportContextValue {
  /** 当前注册的导出处理器 */
  currentExport: ExportHandler | null;
  /** 注册导出处理器（页面/Tab 调用） */
  registerExport: (exp: ExportHandler) => void;
  /** 注销导出处理器（页面/Tab 卸载时调用） */
  unregisterExport: (pageName: string) => void;
}

const ExportContext = createContext<ExportContextValue>({
  currentExport: null,
  registerExport: () => {},
  unregisterExport: () => {},
});

export function ExportProvider({ children }: { children: ReactNode }) {
  const [currentExport, setCurrentExport] = useState<ExportHandler | null>(null);

  const registerExport = useCallback((exp: ExportHandler) => {
    setCurrentExport(exp);
  }, []);

  const unregisterExport = useCallback((pageName: string) => {
    setCurrentExport(prev => (prev?.pageName === pageName ? null : prev));
  }, []);

  // memoize：避免每次渲染造新 value 对象触发所有消费者重渲染
  const value = useMemo(
    () => ({ currentExport, registerExport, unregisterExport }),
    [currentExport, registerExport, unregisterExport],
  );

  return (
    <ExportContext.Provider value={value}>
      {children}
    </ExportContext.Provider>
  );
}

/** ExportModal 消费：获取当前可导出状态 */
export function useExportContext() {
  return useContext(ExportContext);
}

/**
 * 页面/Tab 注册导出处理器
 *
 * @param pageName 标识（用于文件名前缀）
 * @param handler  导出执行函数
 *
 * 组件卸载时自动注销。handler 引用变化时重新注册。
 */
export function useRegisterExport(
  pageName: string,
  handler: (format: 'csv' | 'xlsx') => Promise<void> | void,
) {
  const { registerExport, unregisterExport } = useContext(ExportContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    registerExport({
      pageName,
      handler: (format) => handlerRef.current(format),
    });
    return () => unregisterExport(pageName);
  }, [pageName, registerExport, unregisterExport]);
}
