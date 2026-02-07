/**
 * 统一日志服务
 *
 * 提供分级日志记录功能，支持开发/生产环境配置
 * 用于替代分散的 console.log 调用
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

interface LoggerConfig {
  level: LogLevel;
  enableTimestamp: boolean;
  enableStackTrace: boolean;
}

let defaultConfig: Partial<LoggerConfig> = {};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

class Logger {
  private config: LoggerConfig;
  private context: string;

  constructor(context: string = 'App', config?: Partial<LoggerConfig>) {
    this.context = context;
    this.config = {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
      enableTimestamp: true,
      enableStackTrace: false,
      ...defaultConfig,
      ...config,
    };
  }

  /**
   * 检查是否应该输出该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * 格式化日志前缀
   */
  private formatPrefix(level: LogLevel): string {
    const timestamp = this.config.enableTimestamp
      ? new Date().toISOString().split('T')[1].slice(0, -1)
      : '';
    const prefix = `[${this.context}][${level.toUpperCase()}]`;
    return timestamp ? `${timestamp} ${prefix}` : prefix;
  }

  /**
   * 输出日志
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const prefix = this.formatPrefix(level);
    const fullMessage = `${prefix} ${message}`;

    switch (level) {
      case 'debug':
        console.debug(fullMessage, ...args);
        break;
      case 'info':
        console.info(fullMessage, ...args);
        break;
      case 'warn':
        console.warn(fullMessage, ...args);
        break;
      case 'error':
        console.error(fullMessage, ...args);
        if (this.config.enableStackTrace && args[0] instanceof Error) {
          console.error(args[0].stack);
        }
        break;
    }
  }

  /**
   * 调试信息 - 仅开发环境
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  /**
   * 一般信息
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  /**
   * 警告信息
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  /**
   * 错误信息
   */
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  /**
   * 创建子 Logger（继承配置但使用不同上下文）
   */
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, this.config);
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// 默认导出单例
export const logger = new Logger('App');

// 为不同模块创建专用 logger
export const createLogger = (context: string, config?: Partial<LoggerConfig>): Logger => {
  return new Logger(context, config);
};

export const setDefaultLoggerConfig = (config: Partial<LoggerConfig>): void => {
  defaultConfig = { ...defaultConfig, ...config };
};

// 便捷方法 - 用于快速替换现有的 console 调用
export const log = {
  debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
};
