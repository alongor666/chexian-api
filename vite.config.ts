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
        // 函数形式而非对象形式（BACKLOG 2026-07-03-claude-07646e）：
        // 对象形式会把列出的模块强行并入静态构建图——生产 index.html 曾对
        // vendor-export（jspdf+html2canvas，594KB）注入 modulepreload，
        // 每个用户首屏必下载，代码里的动态 import() 按需加载收益全废。
        // 函数形式只命名分组、不改变加载关系：jspdf/html2canvas/exceljs
        // 刻意不归组，跟随各自动态 import() 边界自然分包按需加载。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // echarts-for-react / prop-types 必须与 React 同 chunk：它是 React 绑定
          // （EChartsReactCore extends React.PureComponent）。若单独归入 echarts 组，
          // Rollup 去重的 CJS interop helper（getDefaultExportFromCjs）会落在 echarts
          // chunk，导致 vendor-react ↔ echarts chunk 循环依赖 —— 运行期 React 导出在
          // TDZ 未就绪时被 extends，抛 "Class extends value undefined"（登录页白屏）。
          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom|scheduler|echarts-for-react|prop-types)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          // echarts / zrender 刻意不归组（同 jspdf/html2canvas/exceljs）：所有图表页
          // 均 React.lazy 懒加载，让 echarts 引擎（约 674KB）跟随各自动态 import() 边界
          // 自然分包为共享懒 chunk，登录首屏不再 modulepreload echarts（2026-07-05-claude-e5ef78）。
          if (/[\\/]node_modules[\\/]date-fns[\\/]/.test(id)) {
            return 'vendor-data';
          }
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return 'vendor-ui';
          }
          return undefined;
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
    deps: {
      moduleDirectories: ['node_modules', 'server/node_modules'],
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '**/.claude/**',
      'tests/e2e/**',
      // 集成测试（需原生 .node addon）— 用 bun run test:integration 单独跑
      'server/src/services/__tests__/duckdb-*.test.ts',
      // better-sqlite3 原生模块（state-db 基础设施）
      'server/src/services/__tests__/state-db.test.ts',
      'server/src/services/__tests__/access-control-store.test.ts',
      'server/src/services/__tests__/personal-access-token-store-sqlite.test.ts',
      'tests/parquet-*.test.ts',
      'tests/duckdb-*.test.ts',
      // 领域断言集成测试（需 DuckDB 原生二进制）— 用 bun run test:integration 单独跑
      'server/src/config/metric-registry/__tests__/integration/**',
    ],
    // server 端测试走 node 环境（解析 express/@duckdb/node-api），前端测试走 jsdom
    environmentMatchGlobs: [
      ['server/**/*.test.ts', 'node'],
      ['tests/api/**/*.test.ts', 'node'],
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
