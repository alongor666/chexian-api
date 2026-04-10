/**
 * 集成测试 vitest 配置
 *
 * 专门运行需要 DuckDB 原生二进制的测试（duckdb-*.test.ts / parquet-*.test.ts）。
 * CI 环境无法解析 .node 原生模块，仅本地运行。
 *
 * 用法：bun run test:integration
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'server/src/services/__tests__/duckdb-*.test.ts',
      'tests/parquet-*.test.ts',
      'tests/duckdb-*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
  },
});
