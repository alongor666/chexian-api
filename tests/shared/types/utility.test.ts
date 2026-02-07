/**
 * 实用类型工具测试
 */

import { describe, it, expect } from 'vitest';
import {
  success,
  failure,
  isSuccess,
  isFailure,
  idle,
  loading,
  asyncSuccess,
  asyncError,
  createPaginatedResult,
  isNonEmptyString,
  isValidNumber,
  isNonEmptyArray,
  isValidDate,
  typedKeys,
  typedValues,
  typedEntries,
} from '../../../src/shared/types/utility';

describe('实用类型 - Result类型', () => {
  describe('success', () => {
    it('应该创建成功结果', () => {
      const result = success(42);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('应该支持任意数据类型', () => {
      const strResult = success('hello');
      expect(strResult.data).toBe('hello');

      const objResult = success({ name: 'test' });
      expect(objResult.data).toEqual({ name: 'test' });

      const arrResult = success([1, 2, 3]);
      expect(arrResult.data).toEqual([1, 2, 3]);
    });
  });

  describe('failure', () => {
    it('应该创建失败结果', () => {
      const error = new Error('test error');
      const result = failure(error);
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });

    it('应该支持自定义错误类型', () => {
      const customError = { code: 404, message: 'Not found' };
      const result = failure(customError);
      expect(result.error).toEqual(customError);
    });
  });

  describe('isSuccess', () => {
    it('应该正确识别成功结果', () => {
      const successResult = success(42);
      const failureResult = failure(new Error('test'));

      expect(isSuccess(successResult)).toBe(true);
      expect(isSuccess(failureResult)).toBe(false);
    });
  });

  describe('isFailure', () => {
    it('应该正确识别失败结果', () => {
      const successResult = success(42);
      const failureResult = failure(new Error('test'));

      expect(isFailure(successResult)).toBe(false);
      expect(isFailure(failureResult)).toBe(true);
    });
  });
});

describe('实用类型 - 异步状态', () => {
  describe('idle', () => {
    it('应该创建空闲状态', () => {
      const state = idle();
      expect(state.status).toBe('idle');
    });
  });

  describe('loading', () => {
    it('应该创建加载状态', () => {
      const state = loading();
      expect(state.status).toBe('loading');
    });
  });

  describe('asyncSuccess', () => {
    it('应该创建成功状态', () => {
      const state = asyncSuccess({ name: 'test' });
      expect(state.status).toBe('success');
      if (state.status === 'success') {
        expect(state.data).toEqual({ name: 'test' });
      }
    });
  });

  describe('asyncError', () => {
    it('应该创建错误状态', () => {
      const error = new Error('test error');
      const state = asyncError(error);
      expect(state.status).toBe('error');
      if (state.status === 'error') {
        expect(state.error).toBe(error);
      }
    });
  });
});

describe('实用类型 - 分页', () => {
  describe('createPaginatedResult', () => {
    it('应该创建分页结果', () => {
      const data = [1, 2, 3, 4, 5];
      const result = createPaginatedResult(data, 100, { page: 1, pageSize: 10 });

      expect(result.data).toEqual(data);
      expect(result.total).toBe(100);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(10);
    });

    it('应该正确计算总页数', () => {
      const result1 = createPaginatedResult([], 95, { page: 1, pageSize: 10 });
      expect(result1.totalPages).toBe(10);

      const result2 = createPaginatedResult([], 100, { page: 1, pageSize: 10 });
      expect(result2.totalPages).toBe(10);

      const result3 = createPaginatedResult([], 7, { page: 1, pageSize: 10 });
      expect(result3.totalPages).toBe(1);
    });

    it('应该处理空数据', () => {
      const result = createPaginatedResult([], 0, { page: 1, pageSize: 10 });
      expect(result.totalPages).toBe(0);
    });
  });
});

describe('实用类型 - 类型守卫', () => {
  describe('isNonEmptyString', () => {
    it('应该接受非空字符串', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString(' ')).toBe(true); // 空格也是非空
    });

    it('应该拒绝空字符串', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    it('应该拒绝非字符串', () => {
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
    });
  });

  describe('isValidNumber', () => {
    it('应该接受有效数字', () => {
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(42)).toBe(true);
      expect(isValidNumber(-100)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    it('应该拒绝非有限数', () => {
      expect(isValidNumber(NaN)).toBe(false);
      expect(isValidNumber(Infinity)).toBe(false);
      expect(isValidNumber(-Infinity)).toBe(false);
    });

    it('应该拒绝非数字', () => {
      expect(isValidNumber('42')).toBe(false);
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
    });
  });

  describe('isNonEmptyArray', () => {
    it('应该接受非空数组', () => {
      expect(isNonEmptyArray([1])).toBe(true);
      expect(isNonEmptyArray([1, 2, 3])).toBe(true);
      expect(isNonEmptyArray(['a', 'b'])).toBe(true);
    });

    it('应该拒绝空数组', () => {
      expect(isNonEmptyArray([])).toBe(false);
    });

    it('应该拒绝非数组', () => {
      expect(isNonEmptyArray('not array')).toBe(false);
      expect(isNonEmptyArray(null)).toBe(false);
      expect(isNonEmptyArray({})).toBe(false);
    });
  });

  describe('isValidDate', () => {
    it('应该接受有效日期', () => {
      expect(isValidDate(new Date())).toBe(true);
      expect(isValidDate(new Date('2024-01-15'))).toBe(true);
    });

    it('应该拒绝无效日期', () => {
      expect(isValidDate(new Date('invalid'))).toBe(false);
    });

    it('应该拒绝非Date对象', () => {
      expect(isValidDate('2024-01-15')).toBe(false);
      expect(isValidDate(1705276800000)).toBe(false);
      expect(isValidDate(null)).toBe(false);
    });
  });
});

describe('实用类型 - 对象工具', () => {
  const testObj = {
    name: 'test',
    value: 42,
    active: true,
  };

  describe('typedKeys', () => {
    it('应该返回类型安全的键数组', () => {
      const keys = typedKeys(testObj);
      expect(keys).toContain('name');
      expect(keys).toContain('value');
      expect(keys).toContain('active');
      expect(keys.length).toBe(3);
    });
  });

  describe('typedValues', () => {
    it('应该返回类型安全的值数组', () => {
      const values = typedValues(testObj);
      expect(values).toContain('test');
      expect(values).toContain(42);
      expect(values).toContain(true);
      expect(values.length).toBe(3);
    });
  });

  describe('typedEntries', () => {
    it('应该返回类型安全的条目数组', () => {
      const entries = typedEntries(testObj);
      expect(entries).toContainEqual(['name', 'test']);
      expect(entries).toContainEqual(['value', 42]);
      expect(entries).toContainEqual(['active', true]);
      expect(entries.length).toBe(3);
    });
  });
});
