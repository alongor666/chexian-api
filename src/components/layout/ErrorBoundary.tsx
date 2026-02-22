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
        <AlertTriangle size={64} className="mx-auto text-warning dark:text-warning-light" aria-label="错误" />
      </div>

      {/* 错误标题 */}
      <h2 className="text-xl font-semibold tracking-tight text-neutral-800 dark:text-neutral-100 mb-2">
        页面加载出错
      </h2>

      {/* 错误描述 */}
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
        抱歉，页面加载时遇到了问题。这可能是网络问题或临时故障。
      </p>

      {/* 错误详情（开发模式显示） */}
      {process.env.NODE_ENV === 'development' && error && (
        <details className="mb-6 text-left">
          <summary className="cursor-pointer text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
            查看错误详情
          </summary>
          <pre className="mt-3 p-4 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-xs font-mono text-danger dark:text-danger-light overflow-auto max-h-40 border border-neutral-200 dark:border-neutral-700">
            {error.toString()}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={onRetry}
          className="px-5 py-2.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-light transition-colors shadow-sm focus:ring-2 focus:ring-primary-400 focus:ring-offset-2"
        >
          重新加载
        </button>
        <button
          onClick={() => window.location.href = '#/'}
          className="px-5 py-2.5 text-sm font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors shadow-sm"
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
