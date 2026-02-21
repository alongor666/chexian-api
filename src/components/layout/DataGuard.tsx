import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { BarChart3, FolderOpen } from 'lucide-react';

interface DataGuardProps {
  children: React.ReactNode;
}

/**
 * 数据路由守卫
 *
 * 功能：
 * - 检查数据是否已加载
 * - 未加载数据时重定向到首页
 * - 已加载数据时正常渲染子组件
 */
export const DataGuard: React.FC<DataGuardProps> = ({ children }) => {
  const { isDataLoaded } = useDataStatus();
  const location = useLocation();

  if (!isDataLoaded) {
    // 保存原始路径，以便导入数据后可以返回
    return (
      <Navigate
        to="/"
        state={{ from: location.pathname }}
        replace
      />
    );
  }

  return <>{children}</>;
};

/**
 * 无数据提示页面
 *
 * 用于需要数据但未加载时显示的提示
 */
export const NoDataPlaceholder: React.FC = () => {
  return (
    <div className="min-h-[400px] flex items-center justify-center">
      <div className="text-center">
        <BarChart3 size={64} className="mx-auto mb-4 text-neutral-300 dark:text-neutral-600" aria-hidden="true" />
        <h2 className="text-xl font-semibold tracking-tight text-neutral-700 dark:text-neutral-200 mb-2">暂无数据</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">请先在首页导入数据文件</p>
        <a
          href="#/"
          className="inline-flex items-center px-4 py-2 font-medium bg-primary text-white rounded-lg hover:bg-primary-light transition-colors shadow-sm"
        >
          <FolderOpen size={16} className="mr-2" aria-hidden="true" />
          去导入数据
        </a>
      </div>
    </div>
  );
};
