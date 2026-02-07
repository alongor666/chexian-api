/**
 * 错误边界组件
 *
 * 捕获子组件树中的 JavaScript 错误，显示友好的错误界面
 * 特别用于处理 lazy-loaded 路由组件的加载失败
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ErrorBoundary');

interface Props {
  children: ReactNode;
  /** 自定义错误回退组件 */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * 默认错误页面组件
 */
const DefaultErrorFallback: React.FC<{
  error: Error | null;
  onRetry: () => void;
}> = ({ error, onRetry }) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
    <div className="text-center max-w-md">
      {/* 错误图标 */}
      <div className="mb-4">
        <AlertTriangle size={64} className="mx-auto text-yellow-500" aria-label="错误" />
      </div>

      {/* 错误标题 */}
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
        页面加载出错
      </h2>

      {/* 错误描述 */}
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        抱歉，页面加载时遇到了问题。这可能是网络问题或临时故障。
      </p>

      {/* 错误详情（开发模式显示） */}
      {process.env.NODE_ENV === 'development' && error && (
        <details className="mb-4 text-left">
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            查看错误详情
          </summary>
          <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs text-red-600 dark:text-red-400 overflow-auto max-h-40">
            {error.toString()}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          重新加载
        </button>
        <button
          onClick={() => window.location.href = '#/'}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          返回首页
        </button>
      </div>
    </div>
  </div>
);

/**
 * 错误边界类组件
 *
 * 必须使用类组件实现，因为 React Hooks 不支持 getDerivedStateFromError 和 componentDidCatch
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // 记录错误到控制台（生产环境可发送到错误追踪服务）
    logger.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 否则使用默认错误页面
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
