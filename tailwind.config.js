/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 颜色系统
      colors: {
        // 主色调 - 蓝色系
        primary: {
          DEFAULT: '#1890ff',
          light: '#40a9ff',
          dark: '#096dd9',
          bg: '#e6f7ff',
          border: '#91d5ff',
          50: '#e6f7ff',
          100: '#bae7ff',
          200: '#91d5ff',
          300: '#69c0ff',
          400: '#40a9ff',
          500: '#1890ff',
          600: '#096dd9',
          700: '#0050b3',
          800: '#003a8c',
          900: '#002766',
        },
        // 成功色 - 绿色系
        success: {
          DEFAULT: '#52c41a',
          light: '#73d13d',
          dark: '#389e0d',
          bg: '#f6ffed',
          border: '#b7eb8f',
        },
        // 警告色 - 橙色系
        warning: {
          DEFAULT: '#faad14',
          light: '#ffc53d',
          dark: '#d48806',
          bg: '#fffbe6',
          border: '#ffe58f',
        },
        // 危险色 - 红色系
        danger: {
          DEFAULT: '#ff4d4f',
          light: '#ff7875',
          dark: '#d9363e',
          bg: '#fff1f0',
          border: '#ffccc7',
        },
        // 中性色 - 灰色系
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e8e8e8',
          300: '#d9d9d9',
          400: '#bfbfbf',
          500: '#8c8c8c',
          600: '#595959',
          700: '#434343',
          800: '#262626',
          900: '#1f1f1f',
        },
      },
      // 间距系统
      spacing: {
        'xs': '0.25rem',   // 4px
        'sm': '0.5rem',    // 8px
        'md': '1rem',      // 16px
        'lg': '1.5rem',    // 24px
        'xl': '2rem',      // 32px
        '2xl': '3rem',     // 48px
        '3xl': '4rem',     // 64px
      },
      // 字体系统
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
            '"SF Pro Text"',
          '"Segoe UI"',
            '"PingFang SC"',
            '"Hiragino Sans GB"',
            '"Microsoft YaHei"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
            '"Noto Sans SC"',
            '"Noto Sans CJK SC"',
            '"Source Han Sans SC"',
          '"Noto Sans"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
        ],
        mono: [
          'SFMono-Regular',
          'Consolas',
          '"Liberation Mono"',
          'Menlo',
          'Courier',
          'monospace',
        ],
      },
      // 字号系统
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],      // 12px
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],  // 14px
        'base': ['1rem', { lineHeight: '1.5rem' }],     // 16px
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],  // 18px
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],   // 20px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
      },
      // 阴影系统
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        'card': '0 2px 8px rgba(0, 0, 0, 0.09)',
        'dropdown': '0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 6px 16px 0 rgba(0, 0, 0, 0.08)',
      },
      // 圆角系统
      borderRadius: {
        'sm': '0.125rem',  // 2px
        'md': '0.375rem',  // 6px
        'lg': '0.5rem',    // 8px
        'xl': '0.75rem',   // 12px
        '2xl': '1rem',     // 16px
        'full': '9999px',
      },
      // 响应式断点
      screens: {
        'xs': '375px',   // 小屏手机
        'sm': '640px',   // 手机
        'md': '768px',   // 平板
        'lg': '1024px',  // 桌面
        'xl': '1280px',  // 大桌面
        '2xl': '1536px', // 超大屏
      },
      // 动画
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
