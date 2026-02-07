/**
 * API 客户端单元测试
 * Tests for src/shared/api/client.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Import after mocking
import { API_BASE } from '../../src/shared/api/client';

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('API_BASE', () => {
    it('should have default value for development', () => {
      expect(API_BASE).toBe('http://localhost:3000/api');
    });

    it('should be a valid URL format', () => {
      expect(API_BASE).toMatch(/^https?:\/\/.+/);
    });
  });

  describe('Token Management', () => {
    it('should store token in localStorage when set', async () => {
      // 这里需要动态导入以便可以测试 setToken
      const { apiClient } = await import('../../src/shared/api/client');

      // Mock successful login response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZXhwIjoxNzA5OTk5OTk5fQ.test',
            user: { username: 'admin', displayName: '管理员', role: 'admin' }
          }
        }),
      });

      await apiClient.login('admin', 'password');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_token',
        expect.stringContaining('eyJ')
      );
    });

    it('should clear token on logout', async () => {
      const { apiClient } = await import('../../src/shared/api/client');
      apiClient.logout();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token');
    });

    it('should return false for isAuthenticated when no token', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const { apiClient } = await import('../../src/shared/api/client');

      expect(apiClient.isAuthenticated()).toBe(false);
    });
  });

  describe('API Requests', () => {
    it('should include Authorization header when token exists', async () => {
      const testToken = 'test-jwt-token';
      localStorageMock.getItem.mockReturnValue(testToken);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });

      const { apiClient } = await import('../../src/shared/api/client');

      // Force token reload
      (apiClient as any).token = testToken;
      (apiClient as any).tokenExpiry = Date.now() + 10000;

      await apiClient.getFiles();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/data/files'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${testToken}`,
          }),
        })
      );
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          success: false,
          error: { message: '认证失败', statusCode: 401 }
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');

      await expect(apiClient.getFiles()).rejects.toThrow('认证失败');
    });
  });

  describe('File Operations', () => {
    it('should call correct endpoint for getFiles', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [
            { filename: 'test.parquet', sizeMB: 10, modifiedTime: new Date().toISOString(), isCurrent: false }
          ]
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');
      const files = await apiClient.getFiles();

      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe('test.parquet');
    });

    it('should call correct endpoint for loadFile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { filename: 'test.parquet', rowCount: 1000, fileSizeMB: 10 }
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');
      const result = await apiClient.loadFile('test.parquet');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/data/load/test.parquet'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.rowCount).toBe(1000);
    });

    it('should encode filename in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { filename: 'test file.parquet', rowCount: 1000, fileSizeMB: 10 }
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');
      await apiClient.loadFile('test file.parquet');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/data/load/test%20file.parquet'),
        expect.anything()
      );
    });
  });

  describe('Query Operations', () => {
    it('should call KPI endpoint with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { total_premium: 1000000, policy_count: 500 }
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');
      const kpi = await apiClient.getKpi({ org: '乐山', year: 2026 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/query\/kpi\?.*org=.*year=/),
        expect.anything()
      );
      expect(kpi.total_premium).toBe(1000000);
    });

    it('should call trend endpoint with granularity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [{ period: '2026-01', premium: 100000, count: 50 }]
        }),
      });

      const { apiClient } = await import('../../src/shared/api/client');
      const trend = await apiClient.getTrend('month');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('granularity=month'),
        expect.anything()
      );
      expect(trend).toHaveLength(1);
    });
  });
});
