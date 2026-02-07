/**
 * Logger 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger, log } from '../src/shared/utils/logger';

describe('Logger', () => {
  // Mock console methods
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    console.debug = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('基本日志输出', () => {
    it('应该输出 debug 日志', () => {
      const testLogger = createLogger('Test', { level: 'debug' });
      testLogger.debug('debug message');
      expect(console.debug).toHaveBeenCalled();
    });

    it('应该输出 info 日志', () => {
      const testLogger = createLogger('Test', { level: 'info' });
      testLogger.info('info message');
      expect(console.info).toHaveBeenCalled();
    });

    it('应该输出 warn 日志', () => {
      const testLogger = createLogger('Test', { level: 'warn' });
      testLogger.warn('warn message');
      expect(console.warn).toHaveBeenCalled();
    });

    it('应该输出 error 日志', () => {
      const testLogger = createLogger('Test', { level: 'error' });
      testLogger.error('error message');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('日志级别过滤', () => {
    it('warn 级别应该过滤 debug 和 info', () => {
      const testLogger = createLogger('Test', { level: 'warn' });
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });

    it('error 级别应该只输出 error', () => {
      const testLogger = createLogger('Test', { level: 'error' });
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('none 级别应该不输出任何日志', () => {
      const testLogger = createLogger('Test', { level: 'none' });
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('上下文管理', () => {
    it('应该包含正确的上下文标识', () => {
      const testLogger = createLogger('TestContext', { level: 'info' });
      testLogger.info('test message');

      const calls = (console.info as any).mock.calls;
      expect(calls[0][0]).toContain('[TestContext]');
    });

    it('child logger 应该继承父 logger 配置', () => {
      const parentLogger = createLogger('Parent', { level: 'warn' });
      const childLogger = parentLogger.child('Child');

      childLogger.info('info message');
      childLogger.warn('warn message');

      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();

      const calls = (console.warn as any).mock.calls;
      expect(calls[0][0]).toContain('[Parent:Child]');
    });
  });

  describe('便捷方法', () => {
    it('log 对象应该提供快捷方法', () => {
      log.info('test message');
      expect(console.info).toHaveBeenCalled();
    });
  });

  describe('配置更新', () => {
    it('应该允许动态更新日志级别', () => {
      const testLogger = createLogger('Test', { level: 'warn' });
      testLogger.info('should not log');
      expect(console.info).not.toHaveBeenCalled();

      testLogger.setConfig({ level: 'info' });
      testLogger.info('should log');
      expect(console.info).toHaveBeenCalled();
    });
  });

  describe('默认单例', () => {
    it('logger 应该是可用的单例', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });
  });
});
