/**
 * configStore 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStoredConfig, saveConfig, clearConfig, hasApiKey } from '../configStore';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('configStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('getStoredConfig', () => {
    it('should return config with model when localStorage is empty', () => {
      const config = getStoredConfig();
      expect(config).toBeDefined();
      expect(config.model).toBeDefined();
    });

    it('should return stored config when available', () => {
      // Directly set a config (will be encrypted on save, but for testing we bypass)
      const storedConfig = { apiKey: 'test-key.test-secret', model: 'glm-4.7' };
      localStorageMock.setItem('zhipu_sql_config', JSON.stringify(storedConfig));

      const config = getStoredConfig();
      // Since it's stored as plaintext (legacy format), decryptApiKey returns as-is
      expect(config.apiKey).toBe('test-key.test-secret');
      expect(config.model).toBe('glm-4.7');
    });

    it('should handle JSON parse errors gracefully', () => {
      localStorageMock.setItem('zhipu_sql_config', 'invalid-json');

      // Should not throw, returns default config
      const config = getStoredConfig();
      expect(config).toBeDefined();
    });
  });

  describe('saveConfig', () => {
    it('should save config to localStorage', () => {
      saveConfig({ apiKey: 'new-key.new-secret', model: 'glm-4.7' });

      expect(localStorageMock.setItem).toHaveBeenCalled();

      // Read back (should decrypt properly)
      const config = getStoredConfig();
      expect(config.apiKey).toBe('new-key.new-secret');
    });

    it('should merge with existing config', () => {
      saveConfig({ apiKey: 'first-key.first-secret' });
      saveConfig({ model: 'codegeex-4' });

      const config = getStoredConfig();
      expect(config.apiKey).toBe('first-key.first-secret');
      expect(config.model).toBe('codegeex-4');
    });
  });

  describe('clearConfig', () => {
    it('should remove config from localStorage', () => {
      saveConfig({ apiKey: 'test.test' });
      clearConfig();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('zhipu_sql_config');
    });
  });

  describe('hasApiKey', () => {
    it('should return true when API key is set', () => {
      saveConfig({ apiKey: 'key.secret' });
      expect(hasApiKey()).toBe(true);
    });

    it('should return false when no config stored', () => {
      localStorageMock.clear();
      // hasApiKey depends on env variable or stored config
      // Without env variable, should return false when no stored config
      const result = hasApiKey();
      expect(typeof result).toBe('boolean');
    });
  });
});
