/**
 * zhipuClient 单元测试
 *
 * 测试 JWT 生成和 SQL 提取逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSqlWithZhipu, validateApiKey } from '../zhipuClient';

// Mock fetch for API tests
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock crypto.subtle for JWT tests
Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      sign: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
  writable: true,
});

describe('zhipuClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('generateSqlWithZhipu', () => {
    it('should return error when API key is empty', async () => {
      const result = await generateSqlWithZhipu('查询保费', { apiKey: '', model: 'glm-4.7-flashx' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Key');
    });

    it('should call Zhipu API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'SELECT SUM(premium) FROM PolicyFact' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      });

      const result = await generateSqlWithZhipu('查询总保费', {
        apiKey: 'test-id.test-secret',
        model: 'glm-4.7-flashx',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('open.bigmodel.cn'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result.success).toBe(true);
      expect(result.sql).toContain('SELECT');
    });

    it('should handle API error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":{"message":"Invalid API key"}}'),
      });

      const result = await generateSqlWithZhipu('查询', {
        apiKey: 'invalid.key',
        model: 'glm-4.7-flashx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await generateSqlWithZhipu('查询', {
        apiKey: 'test.key',
        model: 'glm-4.7-flashx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle empty response content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '' } }],
        }),
      });

      const result = await generateSqlWithZhipu('查询', {
        apiKey: 'test.key',
        model: 'glm-4.7-flashx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('为空');
    });

    it('should extract SQL from code blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '这是SQL：\n```sql\nSELECT * FROM PolicyFact\n```\n完成。',
            },
          }],
        }),
      });

      const result = await generateSqlWithZhipu('查询', {
        apiKey: 'test.key',
        model: 'glm-4.7-flashx',
      });

      expect(result.success).toBe(true);
      expect(result.sql).toBe('SELECT * FROM PolicyFact');
      expect(result.sql).not.toContain('```');
    });

    it('should return token usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'SELECT 1 FROM PolicyFact' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
        }),
      });

      const result = await generateSqlWithZhipu('查询', {
        apiKey: 'test.key',
        model: 'glm-4.7-flashx',
      });

      expect(result.tokens).toEqual({
        prompt: 100,
        completion: 20,
        total: 120,
      });
    });
  });

  describe('validateApiKey', () => {
    it('should return false for invalid format', async () => {
      const result = await validateApiKey('invalid-key-format');

      expect(result).toBe(false);
      // Should not call fetch for invalid format
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return true for valid key', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await validateApiKey('valid-id.valid-secret');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return false when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await validateApiKey('test.secret');

      expect(result).toBe(false);
    });

    it('should use provided model for validation', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await validateApiKey('test.secret', 'glm-4.7');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('glm-4.7'),
        })
      );
    });
  });
});
