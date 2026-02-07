/**
 * crypto 单元测试
 */

import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey, isEncrypted } from '../crypto';

// Mock navigator and screen for consistent fingerprint
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 TestBrowser',
    language: 'zh-CN',
  },
  writable: true,
});

Object.defineProperty(globalThis, 'screen', {
  value: {
    colorDepth: 24,
  },
  writable: true,
});

describe('crypto', () => {
  describe('encryptApiKey / decryptApiKey', () => {
    it('should encrypt and decrypt API key correctly', () => {
      const originalKey = 'abc123.xyz789secret';
      const encrypted = encryptApiKey(originalKey);
      const decrypted = decryptApiKey(encrypted);

      expect(encrypted).not.toBe(originalKey);
      expect(encrypted).toContain('zhipu_v1_');
      expect(decrypted).toBe(originalKey);
    });

    it('should handle empty string', () => {
      expect(encryptApiKey('')).toBe('');
      expect(decryptApiKey('')).toBe('');
    });

    it('should return original for non-encrypted input (legacy support)', () => {
      // Legacy plaintext storage
      const plaintext = 'my-api-key.my-secret';
      expect(decryptApiKey(plaintext)).toBe(plaintext);
    });

    it('should produce different encrypted values for different keys', () => {
      const key1 = 'key1.secret1';
      const key2 = 'key2.secret2';

      const encrypted1 = encryptApiKey(key1);
      const encrypted2 = encryptApiKey(key2);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle special characters', () => {
      const specialKey = 'api-key!@#$%.secret+=';
      const encrypted = encryptApiKey(specialKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(specialKey);
    });

    it('should handle long API keys', () => {
      const longKey = 'a'.repeat(100) + '.' + 'b'.repeat(100);
      const encrypted = encryptApiKey(longKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(longKey);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted strings', () => {
      const encrypted = encryptApiKey('test.key');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext strings', () => {
      expect(isEncrypted('plain-api-key.secret')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for partial prefix', () => {
      expect(isEncrypted('zhipu_')).toBe(false);
      expect(isEncrypted('zhipu_v')).toBe(false);
    });
  });

  describe('encryption robustness', () => {
    it('should produce base64-safe output', () => {
      const encrypted = encryptApiKey('test-api-key.test-secret');

      // Base64 characters only (after prefix)
      const base64Part = encrypted.replace('zhipu_v1_', '');
      expect(base64Part).toMatch(/^[A-Za-z0-9+/=]*$/);
    });

    it('should be deterministic for same input', () => {
      const key = 'same-key.same-secret';
      const encrypted1 = encryptApiKey(key);
      const encrypted2 = encryptApiKey(key);

      // Same browser fingerprint should produce same result
      expect(encrypted1).toBe(encrypted2);
    });

    it('should not reveal original key in encrypted output', () => {
      const key = 'visible-secret.hidden-password';
      const encrypted = encryptApiKey(key);

      expect(encrypted).not.toContain('visible');
      expect(encrypted).not.toContain('secret');
      expect(encrypted).not.toContain('hidden');
      expect(encrypted).not.toContain('password');
    });
  });
});
