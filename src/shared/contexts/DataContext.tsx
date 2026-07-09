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
  const refreshReadinessPromiseRef = useRef<Promise<void> | null>(null);
  const loadingCounterRef = useRef(0);

  const beginLoading = useCallback(() => {
    loadingCounterRef.current += 1;
    setIsLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    loadingCounterRef.current = Math.max(0, loadingCounterRef.current - 1);
    if (loadingCounterRef.current === 0) {
      setIsLoading(false);
    }
  }, []);

  // 刷新文件列表
  const refreshFiles = useCallback(async () => {
    if (!apiClient.isAuthenticated()) {
      return;
    }
    if (refreshFilesPromiseRef.current) {
      return refreshFilesPromiseRef.current;
    }

    beginLoading();
    const task = (async () => {
      try {
        const fileList = await apiClient.data.files();
        setFiles(fileList);

        const current = fileList.find((f) => f.isCurrent);
        if (current) {
          setIsDataLoaded(true);
          setCurrentFile(prev => {
            if (prev) return prev; // 已有文件信息，保持不变
            return {
              filename: current.filename,
              rowCount: 0,
              fileSizeMB: current.sizeMB,
            };
          });
          // 日志放在 setState 外部，避免 Strict Mode 双调用副作用
          logger.info('[DataContext] 检测到后端已加载文件:', current.filename);
        }
      } catch (err) {
        if (!isRequestAbortError(err)) {
          logger.error('[DataContext] 获取文件列表失败:', err);
        }
      } finally {
        refreshFilesPromiseRef.current = null;
        endLoading();
      }
    })();

    refreshFilesPromiseRef.current = task;
    return task;
  }, [beginLoading, endLoading]);

  // 探测后端数据就绪状态（角色无关）
  //
  // 用 GET /data/metadata 派生全局 isDataLoaded：该接口无 requireRole，仅经
  // permissionMiddleware 行级过滤，三级机构用户（org_user）也返回 200（PolicyFact
  // 存在即可）。判据 = "metadata 返回 200"，不看行级过滤后的 rowCount（org_user
  // 某机构可能 0 行仍算"后端已加载数据"）。
  //
  // 对比 refreshFiles()：后者调 GET /data/files（requireRole=BRANCH_ADMIN），
  // org_user 恒 403 → 被 catch 吞掉 → isDataLoaded 永为 false → 除首页外全部功能页
  // 被 DataGuard 重定向到 /data-import。这是本次修复的根因（backlog
  // 2026-07-09-claude-00954e / PR #988）。后端 /data/files 的 requireRole
  // 安全收敛（f1683517）保持不动，不给 org_user 开任何跨机构文件名/数据口子。
  const refreshDataReadiness = useCallback(async () => {
    if (!apiClient.isAuthenticated()) {
      return;
    }
    if (refreshReadinessPromiseRef.current) {
      return refreshReadinessPromiseRef.current;
    }

    beginLoading();
    const task = (async () => {
      try {
        const meta = await apiClient.data.metadata();
        // metadata 200 即代表后端已加载数据（PolicyFact 存在）
        setIsDataLoaded(true);
        setCurrentFile(prev => {
          if (prev) return prev; // 已有文件信息，保持不变
          return {
            filename: meta.file.filename,
            rowCount: meta.file.rowCount,
            fileSizeMB: meta.file.fileSizeMB ?? 0,
          };
        });
        // 日志放在 setState 外部，避免 Strict Mode 双调用副作用
        logger.info('[DataContext] 后端数据已就绪（metadata 200）:', meta.file.filename);
      } catch (err) {
        // 404（未加载数据）/ 网络错误等：保持未就绪，由 DataGuard 引导到数据导入页。
        if (!isRequestAbortError(err)) {
          logger.error('[DataContext] 数据就绪探测失败:', err);
        }
      } finally {
        refreshReadinessPromiseRef.current = null;
        endLoading();
      }
    })();

    refreshReadinessPromiseRef.current = task;
    return task;
  }, [beginLoading, endLoading]);

  // 加载文件
  const loadFile = useCallback(async (filename: string) => {
    beginLoading();
    setError(null);

    try {
      const result = await apiClient.data.load(filename);
      setCurrentFile(result);
      setIsDataLoaded(true);
      window.dispatchEvent(new Event('data-loaded'));
      logger.info('[DataContext] 文件加载成功:', filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
      throw err;
    } finally {
      endLoading();
    }
  }, [beginLoading, endLoading]);

  // 上传文件
  const uploadFile = useCallback(async (file: File) => {
    beginLoading();
    setError(null);

    try {
      const result = await apiClient.data.upload(file);
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
      endLoading();
    }
  }, [beginLoading, endLoading, refreshFiles]);

  // 兼容旧接口
  const setDataLoaded = useCallback((loaded: boolean) => {
    setIsDataLoaded(loaded);
  }, []);

  const refreshDataStatus = useCallback(() => {
    refreshDataReadiness();
  }, [refreshDataReadiness]);

  // 认证后自动探测数据就绪状态（角色无关，走 /data/metadata，非 /data/files）
  useEffect(() => {
    if (apiClient.isAuthenticated()) {
      refreshDataReadiness();
    }
  }, [refreshDataReadiness]);

  // 监听登录事件
  useEffect(() => {
    const handleLogin = () => {
      refreshDataReadiness();
      logger.debug('[DataContext] 登录成功，探测数据就绪状态');
    };
    window.addEventListener('auth-login', handleLogin);
    return () => window.removeEventListener('auth-login', handleLogin);
  }, [refreshDataReadiness]);

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
