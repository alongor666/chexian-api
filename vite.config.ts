/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import viteCompression from 'vite-plugin-compression'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Pre-compress assets — Nginx serves .gz files directly (gzip_static on)
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
    // Brotli for browsers that support it (typically 15-25% smaller than gzip)
    viteCompression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
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
      'clsx',
      'tailwind-merge',
      'zod',
    ],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'size-sensor': path.resolve(__dirname, './src/shared/utils/size-sensor.ts'),
    },
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
          'vendor-monaco': ['@monaco-editor/react'],
          'vendor-data': ['date-fns', 'exceljs'],
          'vendor-export': ['jspdf', 'html2canvas'],
          'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
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
      // ─────────────────────────────────────────────────────────────
      // DuckDB 集成测试 — 原生二进制模块，CI 无法解析
      // @duckdb/node-api 是 .node 原生 addon，vitest/jsdom 无法处理
      // 本地运行: bun run test:integration
      // 详见: memory/feedback_native_module_ci.md
      // ─────────────────────────────────────────────────────────────
      'server/src/services/__tests__/duckdb-*.test.ts',
      'tests/parquet-processing.test.ts',
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
