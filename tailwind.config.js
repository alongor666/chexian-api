/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ================================================================
      // 颜色系统 — 语义色走 CSS 变量（自动适配 dark mode）
      //           中性色保持静态值（手动 dark: 前缀）
      // ================================================================
      colors: {
        // 主色调 - 蓝色系
        primary: {
          DEFAULT: 'var(--c-primary)',
          light: 'var(--c-primary-light)',
          dark: 'var(--c-primary-dark)',
          bg: 'var(--c-primary-bg)',
          border: 'var(--c-primary-border)',
          solid: 'var(--c-primary-solid)',
          50: 'var(--c-primary-50)',
          100: 'var(--c-primary-100)',
          200: 'var(--c-primary-200)',
          300: 'var(--c-primary-300)',
          400: 'var(--c-primary-400)',
          500: 'var(--c-primary-500)',
          600: 'var(--c-primary-600)',
          700: 'var(--c-primary-700)',
          800: 'var(--c-primary-800)',
          900: 'var(--c-primary-900)',
        },
        // 成功色 - 绿色系
        success: {
          DEFAULT: 'var(--c-success)',
          light: 'var(--c-success-light)',
          dark: 'var(--c-success-dark)',
          bg: 'var(--c-success-bg)',
          border: 'var(--c-success-border)',
          solid: 'var(--c-success-solid)',
        },
        // 警告色 - 橙色系
        warning: {
          DEFAULT: 'var(--c-warning)',
          light: 'var(--c-warning-light)',
          dark: 'var(--c-warning-dark)',
          bg: 'var(--c-warning-bg)',
          border: 'var(--c-warning-border)',
          solid: 'var(--c-warning-solid)',
        },
        // 危险色 - 红色系
        danger: {
          DEFAULT: 'var(--c-danger)',
          light: 'var(--c-danger-light)',
          dark: 'var(--c-danger-dark)',
          bg: 'var(--c-danger-bg)',
          border: 'var(--c-danger-border)',
          solid: 'var(--c-danger-solid)',
        },
        // 紫色系 - 角色/身份
        purple: {
          DEFAULT: 'var(--c-purple)',
          light: 'var(--c-purple-light)',
          bg: 'var(--c-purple-bg)',
          border: 'var(--c-purple-border)',
          solid: 'var(--c-purple-solid)',
        },
        // 靛蓝色系 - 高级功��
        indigo: {
          DEFAULT: 'var(--c-indigo)',
          light: 'var(--c-indigo-light)',
          bg: 'var(--c-indigo-bg)',
          border: 'var(--c-indigo-border)',
          solid: 'var(--c-indigo-solid)',
        },
        // 天蓝色系 - 信息/提示
        sky: {
          DEFAULT: 'var(--c-sky)',
          light: 'var(--c-sky-light)',
          bg: 'var(--c-sky-bg)',
          border: 'var(--c-sky-border)',
        },
        // 橙色系 - 费用/成本
        orange: {
          DEFAULT: 'var(--c-orange)',
          light: 'var(--c-orange-light)',
          bg: 'var(--c-orange-bg)',
          border: 'var(--c-orange-border)',
          solid: 'var(--c-orange-solid)',
        },
        // 琥珀色系 - 次级警告
        amber: {
          DEFAULT: 'var(--c-amber)',
          light: 'var(--c-amber-light)',
          bg: 'var(--c-amber-bg)',
          border: 'var(--c-amber-border)',
        },
        // 中性色 - 灰色系（静态值，dark mode 手动 dark: 前缀）
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
        // Dark mode 表面层级（走 CSS 变量，仅 dark 模式有效）
        surface: {
          0: 'var(--surface-0, #ffffff)',
          1: 'var(--surface-1, #ffffff)',
          2: 'var(--surface-2, #fafafa)',
          3: 'var(--surface-3, #f5f5f5)',
        },
      },
      // Dark mode 边框（走 CSS 变量）
      borderColor: {
        'subtle': 'var(--border-subtle, rgba(0, 0, 0, 0.06))',
        'default-var': 'var(--border-default, rgba(0, 0, 0, 0.10))',
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
        'md': '768px',   // 平���
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
