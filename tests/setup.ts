/**
 * Vitest 测试环境配置
 *
 * 注意：vitest.config 已设置 environment: 'jsdom'
 * 无需手动创建 JSDOM 实例，vitest 会自动注入 DOM 全局变量
 */
import { setDefaultLoggerConfig } from '../src/shared/utils/logger';

// 配置日志级别，减少测试输出噪音
setDefaultLoggerConfig({
  level: 'warn',
});

// 模拟 matchMedia（jsdom 不支持）
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => { },
      removeListener: () => { },
      addEventListener: () => { },
      removeEventListener: () => { },
      dispatchEvent: () => false,
    }),
  });

  // 模拟 ResizeObserver（jsdom 不支持）
  class ResizeObserverMock {
    observe() { }
    unobserve() { }
    disconnect() { }
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  });
}
