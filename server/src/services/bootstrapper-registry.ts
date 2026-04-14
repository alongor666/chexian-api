/**
 * bootstrapper-registry.ts — DataBootstrapper 全局注册中心
 *
 * 解决循环依赖问题：
 *   app.ts → query/*.ts → shared.ts → app.ts（循环！）
 *
 * 方案：用独立注册中心隔离 bootstrapper 实例，app.ts 启动时注入，
 * shared.ts 从此处取用，不直接依赖 app.ts。
 *
 * 依赖链（无循环）：
 *   app.ts → bootstrapper-registry.ts ← shared.ts
 */

import type { DataBootstrapper } from './data-bootstrapper.js';

let _bootstrapper: DataBootstrapper | null = null;

/**
 * 注册 bootstrapper 实例（由 app.ts 在 startServer() 中调用）
 */
export function registerBootstrapper(instance: DataBootstrapper): void {
  _bootstrapper = instance;
}

/**
 * 获取已注册的 bootstrapper 实例（供 shared.ts 中间件使用）
 * 若未注册（测试环境）则返回 null，中间件会跳过惰性加载
 */
export function getBootstrapper(): DataBootstrapper | null {
  return _bootstrapper;
}
