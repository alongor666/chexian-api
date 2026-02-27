/**
 * 数据上下文（API 版）
 *
 * 纯 API 模式：用户登录后使用后端 DuckDB，数据全部通过 API 获取
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { apiClient, FileInfo, LoadResult, isRequestAbortError } from '../api/client';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('DataContext');

interface DataContextValue {
  /** 数据是否已加载（后端有当前文件） */
  isDataLoaded: boolean;
  /** 当前加载的文件信息 */
  currentFile: LoadResult | null;
  /** 可用文件列表 */
  files: FileInfo[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新文件列表 */
  refreshFiles: () => Promise<void>;
  /** 加载指定文件 */
  loadFile: (filename: string) => Promise<void>;
  /** 上传并加载文件 */
  uploadFile: (file: File) => Promise<void>;
  /** 设置数据已加载（兼容旧接口） */
  setDataLoaded: (loaded: boolean) => void;
  /** 刷新数据状态（兼容旧接口） */
  refreshDataStatus: () => void;

  // ========== 数据源标识（固定 API 模式）==========
  /** 当前数据源（固定为 'api'） */
  dataSource: 'api';
  /** 是否使用 API 模式（固定为 true） */
  isApiMode: true;
  /** 是否使用本地模式（固定为 false） */
  isLocalMode: false;
}

const DataContext = createContext<DataContextValue>({
  isDataLoaded: false,
  currentFile: null,
  files: [],
  isLoading: false,
  error: null,
  refreshFiles: async () => {},
  loadFile: async () => {},
  uploadFile: async () => {},
  setDataLoaded: () => {},
  refreshDataStatus: () => {},
  dataSource: 'api',
  isApiMode: true,
  isLocalMode: false,
});

/**
 * 数据状态 Hook
 */
export const useDataStatus = () => useContext(DataContext);

interface DataProviderProps {
  children: ReactNode;
}

/**
 * 数据状态 Provider（API 版）
 */
export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [currentFile, setCurrentFile] = useState<LoadResult | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshFilesPromiseRef = useRef<Promise<void> | null>(null);

  // 刷新文件列表
  const refreshFiles = useCallback(async () => {
    if (!apiClient.isAuthenticated()) {
      return;
    }
    if (refreshFilesPromiseRef.current) {
      return refreshFilesPromiseRef.current;
    }

    const task = (async () => {
      try {
        const fileList = await apiClient.getFiles();
        setFiles(fileList);

        const current = fileList.find((f) => f.isCurrent);
        if (current) {
          setIsDataLoaded(true);
          if (!currentFile) {
            setCurrentFile({
              filename: current.filename,
              rowCount: 0,
              fileSizeMB: current.sizeMB,
            });
            logger.info('[DataContext] 检测到后端已加载文件:', current.filename);
          }
        }
      } catch (err) {
        if (!isRequestAbortError(err)) {
          logger.error('[DataContext] 获取文件列表失败:', err);
        }
      } finally {
        refreshFilesPromiseRef.current = null;
      }
    })();

    refreshFilesPromiseRef.current = task;
    return task;
  }, [currentFile]);

  // 加载文件
  const loadFile = useCallback(async (filename: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.loadFile(filename);
      setCurrentFile(result);
      setIsDataLoaded(true);
      window.dispatchEvent(new Event('data-loaded'));
      logger.info('[DataContext] 文件加载成功:', filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 上传文件
  const uploadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiClient.uploadFile(file);
      setCurrentFile(result);
      setIsDataLoaded(true);
      await refreshFiles();
      window.dispatchEvent(new Event('data-loaded'));
      logger.debug('[DataContext] 文件上传成功:', result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [refreshFiles]);

  // 兼容旧接口
  const setDataLoaded = useCallback((loaded: boolean) => {
    setIsDataLoaded(loaded);
  }, []);

  const refreshDataStatus = useCallback(() => {
    refreshFiles();
  }, [refreshFiles]);

  // 认证后自动刷新文件列表
  useEffect(() => {
    if (apiClient.isAuthenticated()) {
      refreshFiles();
    }
  }, [refreshFiles]);

  // 监听登录事件
  useEffect(() => {
    const handleLogin = () => {
      refreshFiles();
      logger.debug('[DataContext] 登录成功，刷新文件列表');
    };
    window.addEventListener('auth-login', handleLogin);
    return () => window.removeEventListener('auth-login', handleLogin);
  }, [refreshFiles]);

  const contextValue = useMemo(
    () => ({
      isDataLoaded,
      currentFile,
      files,
      isLoading,
      error,
      refreshFiles,
      loadFile,
      uploadFile,
      setDataLoaded,
      refreshDataStatus,
      dataSource: 'api' as const,
      isApiMode: true as const,
      isLocalMode: false as const,
    }),
    [
      isDataLoaded,
      currentFile,
      files,
      isLoading,
      error,
      refreshFiles,
      loadFile,
      uploadFile,
      setDataLoaded,
      refreshDataStatus,
    ]
  );

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};
