/**
 * bootstrapper-registry.ts — 单例注册中心单元测试
 *
 * 验证 registerBootstrapper / getBootstrapper 单例行为。
 * 使用类型 mock 替代真实 DataBootstrapper 实例，零 DuckDB 依赖。
 */
import { describe, it, expect, beforeEach } from 'vitest';

// 为防止模块缓存跨测试污染，每个测试重新操作注册表的内部状态
// 注意：bootstrapper-registry 用模块级变量 _bootstrapper，需要手动重置
import { registerBootstrapper, getBootstrapper } from '../bootstrapper-registry.js';
import type { DataBootstrapper } from '../data-bootstrapper.js';

// 最简 mock，仅满足类型约束（DataBootstrapper 是一个类，这里用类型断言）
function makeMockBootstrapper(id: string): DataBootstrapper {
  return { _testId: id } as unknown as DataBootstrapper;
}

describe('bootstrapper-registry — 单例注册中心', () => {
  // 每个测试前重置注册表（将模块级变量清空）
  beforeEach(() => {
    // 注入 null 以重置状态（registerBootstrapper 不接受 null，用 undefined 强转）
    // 利用 getBootstrapper 先检验 null 状态：测试独立运行时可能已有状态
    // 用第一个测试保证"未注册时为 null"成立，后续测试先重置
    registerBootstrapper(null as unknown as DataBootstrapper);
  });

  // BR-01: 未注册前 getBootstrapper 返回 null
  it('BR-01: 未注册时 getBootstrapper 返回 null', () => {
    const result = getBootstrapper();
    expect(result).toBeNull();
  });

  // BR-02: 注册后 getBootstrapper 返回同一实例
  it('BR-02: registerBootstrapper 后 getBootstrapper 返回同一实例', () => {
    const instance = makeMockBootstrapper('mock-A');
    registerBootstrapper(instance);
    const retrieved = getBootstrapper();
    expect(retrieved).toBe(instance);
  });

  // BR-03: 重新注册覆盖旧实例
  it('BR-03: 二次 registerBootstrapper 覆盖前一个实例', () => {
    const first = makeMockBootstrapper('mock-first');
    const second = makeMockBootstrapper('mock-second');

    registerBootstrapper(first);
    expect(getBootstrapper()).toBe(first);

    registerBootstrapper(second);
    expect(getBootstrapper()).toBe(second);
    expect(getBootstrapper()).not.toBe(first);
  });
});
