import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { apiClient, FileInfo } from '../../shared/api/client';
import { RefreshCw, Upload, X, ChevronRight } from 'lucide-react';

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

  return (
    <div className="min-h-full p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* 标题行 + 操作按钮 */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-800">数据文件</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshFiles()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
              刷新
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              <Upload size={14} aria-hidden="true" />
              上传新文件
            </button>
          </div>
        </div>

        {/* 已加载数据提示 */}
        {isDataLoaded && currentFile && (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <span className="text-green-500 text-lg">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-green-800 text-sm font-medium">
                数据已加载: {currentFile.filename}
                <span className="text-green-600 font-normal ml-1">
                  ({currentFile.rowCount.toLocaleString()} 条)
                </span>
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-1 text-sm text-green-700 hover:text-green-900 font-medium whitespace-nowrap"
            >
              查看仪表盘
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

        {/* 上传区域 - 按需显示 */}
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
              className={`relative p-6 text-center transition-colors ${
                isDragging ? 'bg-blue-50' : ''
              } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <input
                type="file"
                accept=".parquet"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={isLoading}
              />
              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  {isUploading ? '正在上传...' : dataLoading ? '正在加载...' : '拖拽文件到此处或点击选择'}
                </p>
                <p className="text-xs text-gray-400">
                  .parquet 格式，最大 500MB
                </p>
                <p className="text-xs text-gray-400">
                  必需字段: policy_no, premium, org_name, salesman_name
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 服务器文件列表 */}
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
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              {dataLoading ? '加载中...' : '暂无数据文件，请上传'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {files.map((file: FileInfo) => (
                <li
                  key={file.filename}
                  className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors ${
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
