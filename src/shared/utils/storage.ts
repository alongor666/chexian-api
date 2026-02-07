/**
 * 安全的 localStorage 访问工具
 *
 * 解决以下问题：
 * - 隐私模式浏览器阻止 localStorage 访问
 * - JSON 解析错误导致应用崩溃
 * - 存储配额超限
 * - SSR 环境下 localStorage 不存在
 */

import { createLogger } from './logger';

const logger = createLogger('storage');

/**
 * 检查 localStorage 是否可用
 */
const isLocalStorageAvailable = (): boolean => {
  try {
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

// 缓存可用性检查结果
let storageAvailable: boolean | null = null;

const checkStorageAvailable = (): boolean => {
  if (storageAvailable === null) {
    storageAvailable = isLocalStorageAvailable();
    if (!storageAvailable) {
      logger.warn('localStorage 不可用，将使用内存存储');
    }
  }
  return storageAvailable;
};

// 内存后备存储（当 localStorage 不可用时）
const memoryStorage = new Map<string, string>();

/**
 * 安全的 localStorage 封装
 *
 * 特性：
 * - 自动降级到内存存储
 * - 完善的错误处理
 * - 类型安全的 JSON 序列化
 */
export const safeStorage = {
  /**
   * 获取存储项
   * @param key 存储键名
   * @returns 存储的值，不存在则返回 null
   */
  getItem(key: string): string | null {
    try {
      if (checkStorageAvailable()) {
        return localStorage.getItem(key);
      }
      return memoryStorage.get(key) ?? null;
    } catch (error) {
      logger.warn(`读取存储项失败: ${key}`, error);
      return memoryStorage.get(key) ?? null;
    }
  },

  /**
   * 设置存储项
   * @param key 存储键名
   * @param value 存储值
   * @returns 是否设置成功
   */
  setItem(key: string, value: string): boolean {
    try {
      if (checkStorageAvailable()) {
        localStorage.setItem(key, value);
      }
      memoryStorage.set(key, value);
      return true;
    } catch (error) {
      // 可能是配额超限
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        logger.error(`存储配额已满，无法保存: ${key}`);
      } else {
        logger.warn(`设置存储项失败: ${key}`, error);
      }
      // 尝试保存到内存
      memoryStorage.set(key, value);
      return false;
    }
  },

  /**
   * 删除存储项
   * @param key 存储键名
   */
  removeItem(key: string): void {
    try {
      if (checkStorageAvailable()) {
        localStorage.removeItem(key);
      }
      memoryStorage.delete(key);
    } catch (error) {
      logger.warn(`删除存储项失败: ${key}`, error);
      memoryStorage.delete(key);
    }
  },

  /**
   * 清空所有存储（保留指定键）
   * @param keysToKeep 需要保留的键名数组
   */
  clear(keysToKeep: string[] = []): void {
    try {
      // 保存需要保留的值
      const savedValues: Record<string, string | null> = {};
      keysToKeep.forEach((key) => {
        savedValues[key] = this.getItem(key);
      });

      // 清空存储
      if (checkStorageAvailable()) {
        localStorage.clear();
      }
      memoryStorage.clear();

      // 恢复需要保留的值
      keysToKeep.forEach((key) => {
        if (savedValues[key] !== null) {
          this.setItem(key, savedValues[key]!);
        }
      });
    } catch (error) {
      logger.warn('清空存储失败', error);
      memoryStorage.clear();
    }
  },
};

/**
 * 获取 JSON 值（带类型安全）
 * @param key 存储键名
 * @param defaultValue 默认值
 * @returns 解析后的值
 */
export function getStorageJson<T>(key: string, defaultValue: T): T {
  try {
    const value = safeStorage.getItem(key);
    if (value === null) {
      return defaultValue;
    }
    return JSON.parse(value) as T;
  } catch (error) {
    logger.warn(`JSON 解析失败: ${key}`, error);
    return defaultValue;
  }
}

/**
 * 设置 JSON 值
 * @param key 存储键名
 * @param value 要存储的值
 * @returns 是否设置成功
 */
export function setStorageJson<T>(key: string, value: T): boolean {
  try {
    const serialized = JSON.stringify(value);
    return safeStorage.setItem(key, serialized);
  } catch (error) {
    logger.warn(`JSON 序列化失败: ${key}`, error);
    return false;
  }
}

/**
 * 获取布尔值
 * @param key 存储键名
 * @param defaultValue 默认值
 */
export function getStorageBoolean(key: string, defaultValue: boolean): boolean {
  const value = safeStorage.getItem(key);
  if (value === null) return defaultValue;
  return value === 'true';
}

/**
 * 设置布尔值
 * @param key 存储键名
 * @param value 布尔值
 */
export function setStorageBoolean(key: string, value: boolean): boolean {
  return safeStorage.setItem(key, String(value));
}

/**
 * 获取数值
 * @param key 存储键名
 * @param defaultValue 默认值
 */
export function getStorageNumber(key: string, defaultValue: number): number {
  const value = safeStorage.getItem(key);
  if (value === null) return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 设置数值
 * @param key 存储键名
 * @param value 数值
 */
export function setStorageNumber(key: string, value: number): boolean {
  return safeStorage.setItem(key, String(value));
}
