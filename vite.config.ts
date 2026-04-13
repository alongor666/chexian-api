/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { compression } from 'vite-plugin-compression2'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Pre-compress assets — Nginx serves .gz files directly (gzip_static on)
    compression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
    // Brotli for browsers that support it (typically 15-25% smaller than gzip)
    compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
    // Bundle analyzer — generates baseline report for chunk size observability
    visualizer({
      filename: '.planning/phases/03-code-structure/bundle-baseline.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],

  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'echarts',
      'echarts-for-react',
      'date-fns',
      'lucide-react',
      'zod',
    ],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'size-sensor': path.resolve(__dirname, './src/shared/utils/size-sensor.ts'),
    },
    // server 端依赖装在 server/node_modules/，vitest 需要搜索两处
    modules: ['node_modules', 'server/node_modules'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-echarts': ['echarts', 'echarts-for-react'],

          'vendor-data': ['date-fns', 'exceljs'],
          'vendor-export': ['jspdf', 'html2canvas'],
          'vendor-ui': ['lucide-react'],
        },
      },
    },

    sourcemap: false,
    target: 'es2020',
    minify: 'esbuild',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '**/.claude/**',
      'tests/e2e/**',
      // 集成测试（需 DuckDB 原生二进制 .node addon）— 用 bun run test:integration 单独跑
      'server/src/services/__tests__/duckdb-*.test.ts',
      'tests/parquet-*.test.ts',
      'tests/duckdb-*.test.ts',
    ],
    // server 端测试走 node 环境（解析 express/@duckdb/node-api），前端测试走 jsdom
    environmentMatchGlobs: [
      ['server/**/*.test.ts', 'node'],
    ],
    browser: {
      enabled: false,
      provider: 'playwright',
      headless: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '**/*.config.*',
        'scripts/',
      ],
    },
  },
})
