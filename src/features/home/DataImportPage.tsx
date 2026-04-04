import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { FileInfo } from '../../shared/api/client';
import { formatAverage, formatCount } from '../../shared/utils/formatters';
import { RefreshCw, Upload, X, ChevronRight, FileUp, Database, FileText, ShieldCheck } from 'lucide-react';
import { resolveRedirectPath } from '../../shared/utils/redirect-state';
import { Logger } from '../../shared/utils/logger';
import { colorClasses, cardStyles, buttonStyles, cn } from '../../shared/styles';

const logger = new Logger('DataImportPage');

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
  const fromPath = resolveRedirectPath(location.state, '/dashboard');

  // 后端已加载数据时自动跳转到仪表盘
  useEffect(() => {
    if (isDataLoaded && currentFile && !dataLoading) {
      const targetPath = fromPath || '/dashboard';
      logger.debug('Data ready, navigate to target path', { targetPath, currentFile: currentFile.filename });
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
    if (mb < 1) return `${formatCount(mb * 1024)} KB`;
    return `${formatAverage(mb)} MB`;
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
            <h1 className={cn('text-2xl font-semibold', colorClasses.text.neutralBlack)}>数据导入</h1>
            <p className={cn('text-sm mt-1', colorClasses.text.neutral)}>上传 Parquet 文件后自动进入分析看板</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => refreshFiles()}
              disabled={isLoading}
              className={cn(buttonStyles.secondary, buttonStyles.sizeSmall, 'flex items-center gap-1.5 transition-colors disabled:opacity-50')}
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
              刷新
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className={cn(buttonStyles.primary, buttonStyles.sizeSmall, 'flex items-center gap-1.5 transition-colors')}
            >
              <Upload size={14} aria-hidden="true" />
              {showUpload ? '收起上传' : '上传新文件'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={cn(cardStyles.base, 'px-4 py-3')}>
            <div className={cn('flex items-center gap-2 text-xs', colorClasses.text.neutral)}>
              <Database size={14} />
              服务器文件
            </div>
            <div className={cn('mt-1 text-lg font-semibold', colorClasses.text.neutralBlack)}>{formatCount(files.length)}</div>
          </div>
          <div className={cn(cardStyles.base, 'px-4 py-3')}>
            <div className={cn('flex items-center gap-2 text-xs', colorClasses.text.neutral)}>
              <FileText size={14} />
              当前加载
            </div>
            <div className={cn('mt-1 text-sm font-medium truncate', colorClasses.text.neutralBlack)}>
              {currentFile ? currentFile.filename : '未加载'}
            </div>
            {currentFile && (
              <div className={cn('text-xs mt-0.5', colorClasses.text.neutralMuted)}>
                {formatCount(currentFile.rowCount)} 条
              </div>
            )}
          </div>
          <div className={cn(cardStyles.base, 'px-4 py-3')}>
            <div className={cn('flex items-center gap-2 text-xs', colorClasses.text.neutral)}>
              <ShieldCheck size={14} />
              最近更新
            </div>
            <div className={cn('mt-1 text-sm font-medium', colorClasses.text.neutralBlack)}>
              {latestFile ? formatTime(latestFile.modifiedTime) : '暂无'}
            </div>
            {latestFile && (
              <div className={cn('text-xs mt-0.5 truncate', colorClasses.text.neutralMuted)}>
                {latestFile.filename}
              </div>
            )}
          </div>
        </div>

        {isDataLoaded && currentFile && (
          <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg px-4 py-3 border', colorClasses.bg.success, colorClasses.border.success)}>
            <div className="flex items-center gap-3">
              <span className={cn('text-lg', colorClasses.text.success)}>✓</span>
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-medium', colorClasses.text.success)}>
                数据已加载: {currentFile.filename}
                <span className={cn('font-normal ml-1', colorClasses.text.success)}>
                  ({formatCount(currentFile.rowCount)} 条)
                </span>
              </p>
            </div>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className={cn('flex items-center gap-1 text-sm font-medium whitespace-nowrap', colorClasses.text.success)}
            >
              进入仪表盘
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className={cn('flex items-center gap-3 rounded-lg px-4 py-3 border', colorClasses.bg.danger, colorClasses.border.danger)}>
            <span className={colorClasses.text.danger}>!</span>
            <p className={cn('text-sm flex-1', colorClasses.text.danger)}>{error}</p>
            <button onClick={() => setError(null)} className={colorClasses.text.danger}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {showUpload && (
          <div className={cn(cardStyles.base, 'overflow-hidden')}>
            <div className={cn('flex items-center justify-between px-4 py-2.5 border-b', colorClasses.border.neutral)}>
              <span className={cn('text-sm font-medium', colorClasses.text.neutral)}>上传文件</span>
              <button
                onClick={() => setShowUpload(false)}
                className={cn('p-1 rounded transition-colors', colorClasses.text.neutralMuted)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'relative p-8 text-center transition-colors border-2 border-dashed',
                isDragging ? cn(colorClasses.bg.primary, colorClasses.border.primary) : colorClasses.border.neutral,
                isLoading && 'opacity-50 pointer-events-none'
              )}
            >
              <input
                type="file"
                accept=".parquet"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={isLoading}
              />
              <div className="space-y-3">
                <div className={cn('mx-auto w-12 h-12 rounded-full flex items-center justify-center', colorClasses.bg.primary)}>
                  <FileUp size={20} className={colorClasses.text.primary} aria-hidden="true" />
                </div>
                <p className={cn('text-sm', colorClasses.text.neutral)}>
                  {isUploading ? '正在上传...' : dataLoading ? '正在加载...' : '拖拽文件到此处或点击选择'}
                </p>
                <div className="flex items-center justify-center">
                  <span className={cn(buttonStyles.primary, buttonStyles.sizeSmall, 'inline-flex items-center rounded-full text-xs')}>
                    点击上传
                  </span>
                </div>
                <p className={cn('text-xs', colorClasses.text.neutralMuted)}>.parquet 格式，最大 500MB</p>
                <p className={cn('text-xs', colorClasses.text.neutralMuted)}>必需字段: policy_no, premium, org_name, salesman_name</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={cn('flex items-center gap-2 text-sm font-medium', colorClasses.text.neutralBlack)}>
              <FileText size={16} className={colorClasses.text.primary} />
              文件格式
            </div>
            <p className={cn('text-xs mt-2', colorClasses.text.neutral)}>仅支持 Parquet，建议上传最近一个月的数据</p>
          </div>
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={cn('flex items-center gap-2 text-sm font-medium', colorClasses.text.neutralBlack)}>
              <Database size={16} className={colorClasses.text.success} />
              数据字段
            </div>
            <p className={cn('text-xs mt-2', colorClasses.text.neutral)}>核心字段需完整，缺失会影响图表展示</p>
          </div>
          <div className={cn(cardStyles.base, 'p-4')}>
            <div className={cn('flex items-center gap-2 text-sm font-medium', colorClasses.text.neutralBlack)}>
              <ShieldCheck size={16} className={colorClasses.text.purple} />
              安全提示
            </div>
            <p className={cn('text-xs mt-2', colorClasses.text.neutral)}>数据仅在内网使用，不会上传至外部</p>
          </div>
        </div>

        <div className={cardStyles.base}>
          <div className={cn('px-4 py-3 border-b', colorClasses.border.neutral)}>
            <h2 className={cn('text-sm font-medium', colorClasses.text.neutral)}>
              服务器数据文件
              {files.length > 0 && (
                <span className={cn('ml-1.5 font-normal', colorClasses.text.neutralMuted)}>({files.length})</span>
              )}
            </h2>
          </div>

          {files.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className={cn('text-sm', colorClasses.text.neutralMuted)}>{dataLoading ? '加载中...' : '暂无数据文件，请上传'}</div>
              {!dataLoading && (
                <button
                  onClick={() => setShowUpload(true)}
                  className={cn('mt-3 inline-flex items-center gap-1.5 text-sm', colorClasses.text.primary)}
                >
                  <Upload size={14} />
                  打开上传区域
                </button>
              )}
            </div>
          ) : (
            <ul className={cn('divide-y', colorClasses.border.neutral)}>
              {files.map((file: FileInfo) => (
                <li
                  key={file.filename}
                  className={cn(
                    'flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between',
                    colorClasses.bg.neutral.replace('bg-', 'hover:bg-'),
                    file.isCurrent ? 'border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-medium truncate', colorClasses.text.neutral)}>{file.filename}</span>
                      {file.isCurrent && (
                        <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0', colorClasses.bg.primary, colorClasses.text.primary)}>
                          当前加载
                        </span>
                      )}
                    </div>
                    <p className={cn('text-xs mt-0.5', colorClasses.text.neutralMuted)}>
                      {formatFileSize(file.sizeMB)} · {formatTime(file.modifiedTime)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleLoadFile(file.filename)}
                    disabled={isLoading}
                    className={cn(buttonStyles.primary, 'ml-3 px-3 py-1 text-xs font-medium rounded transition-colors flex-shrink-0 disabled:opacity-50')}
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
