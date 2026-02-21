import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { apiClient, FileInfo } from '../../shared/api/client';
import { RefreshCw, Upload, X, ChevronRight, FileUp, Database, FileText, ShieldCheck } from 'lucide-react';

/**
 * 首页 - 数据文件管理器
 *
 * 功能：
 * - 显示后端可用文件列表（全宽焦点）
 * - 上传区域按需显示（按钮触发）
 * - 加载后端文件进行分析
 */
export const DataImportPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDataLoaded, currentFile, files, isLoading: dataLoading, loadFile, uploadFile, refreshFiles } = useDataStatus();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // 获取原始路径（从路由守卫重定向过来时携带）
  const fromPath = (location.state as { from?: string })?.from;

  // 初始化加载文件列表
  useEffect(() => {
    if (apiClient.isAuthenticated()) {
      refreshFiles();
    }
  }, [refreshFiles]);

  // 后端已加载数据时自动跳转到仪表盘
  useEffect(() => {
    if (isDataLoaded && currentFile && !dataLoading) {
      const targetPath = fromPath || '/dashboard';
      navigate(targetPath, { replace: true });
    }
  }, [isDataLoaded, currentFile, dataLoading, navigate, fromPath]);

  // 无文件时自动展开上传区域
  useEffect(() => {
    if (files.length === 0 && !dataLoading) {
      setShowUpload(true);
    }
  }, [files.length, dataLoading]);

  // 处理文件上传
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.parquet')) {
        setError('只支持 .parquet 格式文件');
        return;
      }

      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        setError('文件过大，最大支持 500MB');
        return;
      }

      try {
        setError(null);
        setIsUploading(true);
        await uploadFile(file);
        const targetPath = fromPath || '/dashboard';
        navigate(targetPath, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : '上传失败');
      } finally {
        setIsUploading(false);
      }
    },
    [navigate, uploadFile, fromPath]
  );

  // 处理加载已有文件
  const handleLoadFile = useCallback(
    async (filename: string) => {
      try {
        setError(null);
        await loadFile(filename);
        const targetPath = fromPath || '/dashboard';
        navigate(targetPath, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    },
    [navigate, loadFile, fromPath]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const formatFileSize = (mb: number) => {
    if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
    return `${mb.toFixed(1)} MB`;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString();
  };

  const isLoading = dataLoading || isUploading;
  const latestFile = files.reduce<FileInfo | null>((latest, file) => {
    if (!latest) return file;
    return new Date(file.modifiedTime).getTime() > new Date(latest.modifiedTime).getTime() ? file : latest;
  }, null);

  return (
    <div className="min-h-full p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">数据导入</h1>
            <p className="text-sm text-gray-500 mt-1">上传 Parquet 文件后自动进入分析看板</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => refreshFiles()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 bg-white border border-gray-200"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
              刷新
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              <Upload size={14} aria-hidden="true" />
              {showUpload ? '收起上传' : '上传新文件'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <Database size={14} />
              服务器文件
            </div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{files.length}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <FileText size={14} />
              当前加载
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900 truncate">
              {currentFile ? currentFile.filename : '未加载'}
            </div>
            {currentFile && (
              <div className="text-xs text-gray-400 mt-0.5">
                {currentFile.rowCount.toLocaleString()} 条
              </div>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <ShieldCheck size={14} />
              最近更新
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {latestFile ? formatTime(latestFile.modifiedTime) : '暂无'}
            </div>
            {latestFile && (
              <div className="text-xs text-gray-400 mt-0.5 truncate">
                {latestFile.filename}
              </div>
            )}
          </div>
        </div>

        {isDataLoaded && currentFile && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-green-500 text-lg">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-green-800 text-sm font-medium">
                数据已加载: {currentFile.filename}
                <span className="text-green-600 font-normal ml-1">
                  ({currentFile.rowCount.toLocaleString()} 条)
                </span>
              </p>
            </div>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-1 text-sm text-green-700 hover:text-green-900 font-medium whitespace-nowrap"
            >
              进入仪表盘
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <span className="text-red-500">!</span>
            <p className="text-red-700 text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {showUpload && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-700">上传文件</span>
              <button
                onClick={() => setShowUpload(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative p-8 text-center transition-colors border-2 border-dashed ${
                isDragging ? 'bg-blue-50 border-blue-300' : 'border-gray-200'
              } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <input
                type="file"
                accept=".parquet"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={isLoading}
              />
              <div className="space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
                  <FileUp size={20} className="text-blue-600" aria-hidden="true" />
                </div>
                <p className="text-sm text-gray-600">
                  {isUploading ? '正在上传...' : dataLoading ? '正在加载...' : '拖拽文件到此处或点击选择'}
                </p>
                <div className="flex items-center justify-center">
                  <span className="inline-flex items-center px-3 py-1.5 text-xs rounded-full bg-blue-600 text-white">
                    点击上传
                  </span>
                </div>
                <p className="text-xs text-gray-400">.parquet 格式，最大 500MB</p>
                <p className="text-xs text-gray-400">必需字段: policy_no, premium, org_name, salesman_name</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <FileText size={16} className="text-blue-500" />
              文件格式
            </div>
            <p className="text-xs text-gray-500 mt-2">仅支持 Parquet，建议上传最近一个月的数据</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <Database size={16} className="text-green-500" />
              数据字段
            </div>
            <p className="text-xs text-gray-500 mt-2">核心字段需完整，缺失会影响图表展示</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <ShieldCheck size={16} className="text-purple-500" />
              安全提示
            </div>
            <p className="text-xs text-gray-500 mt-2">数据仅在内网使用，不会上传至外部</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-700">
              服务器数据文件
              {files.length > 0 && (
                <span className="ml-1.5 text-gray-400 font-normal">({files.length})</span>
              )}
            </h2>
          </div>

          {files.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-sm text-gray-400">{dataLoading ? '加载中...' : '暂无数据文件，请上传'}</div>
              {!dataLoading && (
                <button
                  onClick={() => setShowUpload(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                >
                  <Upload size={14} />
                  打开上传区域
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {files.map((file: FileInfo) => (
                <li
                  key={file.filename}
                  className={`flex flex-col gap-2 px-4 py-3 hover:bg-gray-50 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    file.isCurrent ? 'border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 truncate">{file.filename}</span>
                      {file.isCurrent && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-medium rounded flex-shrink-0">
                          当前加载
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatFileSize(file.sizeMB)} · {formatTime(file.modifiedTime)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleLoadFile(file.filename)}
                    disabled={isLoading}
                    className="ml-3 px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white text-xs font-medium rounded transition-colors flex-shrink-0"
                  >
                    {isLoading ? '加载中...' : '加载'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
