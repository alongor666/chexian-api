/**
 * AI SQL 配置存储
 *
 * 优先级：localStorage > 环境变量 > 默认值
 * 安全特性：API Key 使用 XOR + Base64 混淆存储
 */

import { DEFAULT_MODEL } from './types';
import { encryptApiKey, decryptApiKey } from './crypto';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ConfigStore');

const STORAGE_KEY = 'zhipu_sql_config';

// 从环境变量读取预设配置
const ENV_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY || '';
const ENV_MODEL = import.meta.env.VITE_ZHIPU_MODEL || DEFAULT_MODEL;

export interface StoredConfig {
  apiKey: string;
  model: string;
}

/**
 * 获取存储的配置
 * 优先级：localStorage > 环境变量 > 默认值
 */
export function getStoredConfig(): StoredConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 解密 API Key
      const decryptedKey = parsed.apiKey ? decryptApiKey(parsed.apiKey) : '';
      return {
        apiKey: decryptedKey || ENV_API_KEY,
        model: parsed.model || ENV_MODEL,
      };
    }
  } catch (e) {
    logger.error('[ConfigStore] Failed to load config:', e);
  }

  // 返回环境变量配置（如果有）
  return {
    apiKey: ENV_API_KEY,
    model: ENV_MODEL,
  };
}

/**
 * 保存配置
 * API Key 会自动加密
 */
export function saveConfig(config: Partial<StoredConfig>): void {
  try {
    const current = getStoredConfig();
    const updated = { ...current, ...config };

    // 加密 API Key
    const toStore = {
      ...updated,
      apiKey: updated.apiKey ? encryptApiKey(updated.apiKey) : '',
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    logger.error('[ConfigStore] Failed to save config:', e);
  }
}

/**
 * 清除配置
 */
export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    logger.error('[ConfigStore] Failed to clear config:', e);
  }
}

/**
 * 检查是否已配置 API Key
 * 检查 localStorage 或环境变量
 */
export function hasApiKey(): boolean {
  const config = getStoredConfig();
  return !!config.apiKey;
}

/**
 * 检查是否使用环境变量预设的 API Key
 */
export function isUsingEnvKey(): boolean {
  return !!ENV_API_KEY;
}
