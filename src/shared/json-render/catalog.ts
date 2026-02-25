/**
 * JSON Render 组件目录定义
 *
 * 使用 Zod schemas 定义 AI 可以使用的组件及其属性。
 * 这确保 AI 只能生成预定义的、安全的 UI 结构。
 */

import { z } from 'zod'
import { createCatalog, generateCatalogPrompt } from '@json-render/core'

/**
 * @json-render/core 当前会携带自己的一份 zod 类型，和仓库顶层 zod 在 TS 层不兼容。
 * 运行时 schema 完全兼容，这里仅在 catalog 创建点做类型降级，避免泛型深度爆炸。
 */
const createCatalogLoose = createCatalog as unknown as (config: unknown) => ReturnType<typeof createCatalog>

// ============================================================================
// 属性 Schema 定义
// ============================================================================

/** 通用颜色变体 */
const colorVariantSchema = z.enum(['default', 'primary', 'success', 'warning', 'danger'])

/** 尺寸变体 */
const sizeSchema = z.enum(['sm', 'md', 'lg'])

/** 对齐方式 */
const alignSchema = z.enum(['left', 'center', 'right'])

// ============================================================================
// 组件 Catalog 定义
// ============================================================================

export const catalog = createCatalogLoose({
  name: 'chexian-dashboard',
  components: {
    // --------------------------------------------------------------------------
    // 布局组件
    // --------------------------------------------------------------------------

    /** 卡片容器 */
    Card: {
      props: z.object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        variant: z.enum(['base', 'compact', 'spacious']).default('base'),
      }),
      hasChildren: true,
      description: '卡片容器组件，用于包装内容块',
    },

    /** 网格布局 */
    Grid: {
      props: z.object({
        columns: z.number().min(1).max(6).default(2),
        gap: sizeSchema.default('md'),
      }),
      hasChildren: true,
      description: '网格布局组件',
    },

    /** 堆叠布局 */
    Stack: {
      props: z.object({
        direction: z.enum(['vertical', 'horizontal']).default('vertical'),
        gap: sizeSchema.default('md'),
        align: alignSchema.default('left'),
      }),
      hasChildren: true,
      description: '堆叠布局组件',
    },

    // --------------------------------------------------------------------------
    // 数据展示组件
    // --------------------------------------------------------------------------

    /** KPI 指标卡片 */
    KpiCard: {
      props: z.object({
        title: z.string(),
        value: z.union([z.string(), z.number()]),
        unit: z.string().optional(),
        trend: z.number().optional(),
        trendLabel: z.string().optional(),
        icon: z.string().optional(),
        variant: colorVariantSchema.default('default'),
      }),
      description: 'KPI 指标展示卡片',
    },

    /** 数据表格 */
    DataTable: {
      props: z.object({
        columns: z.array(z.object({
          key: z.string(),
          title: z.string(),
          align: alignSchema.optional(),
          format: z.enum(['text', 'number', 'percent', 'currency']).optional(),
        })),
        data: z.array(z.record(z.string(), z.unknown())),
        title: z.string().optional(),
        pageSize: z.number().default(10),
        sortable: z.boolean().default(true),
      }),
      description: '数据表格组件',
    },

    /** 柱状图 */
    BarChart: {
      props: z.object({
        title: z.string().optional(),
        data: z.array(z.object({
          name: z.string(),
          value: z.number(),
          group: z.string().optional(),
        })),
        xAxisLabel: z.string().optional(),
        yAxisLabel: z.string().optional(),
        showLegend: z.boolean().default(true),
        stacked: z.boolean().default(false),
        horizontal: z.boolean().default(false),
      }),
      description: '柱状图组件',
    },

    /** 折线图 */
    LineChart: {
      props: z.object({
        title: z.string().optional(),
        data: z.array(z.object({
          x: z.union([z.string(), z.number()]),
          y: z.number(),
          series: z.string().optional(),
        })),
        xAxisLabel: z.string().optional(),
        yAxisLabel: z.string().optional(),
        showLegend: z.boolean().default(true),
        smooth: z.boolean().default(true),
        showArea: z.boolean().default(false),
      }),
      description: '折线图组件',
    },

    /** 饼图 */
    PieChart: {
      props: z.object({
        title: z.string().optional(),
        data: z.array(z.object({
          name: z.string(),
          value: z.number(),
        })),
        showLegend: z.boolean().default(true),
        donut: z.boolean().default(false),
        showLabel: z.boolean().default(true),
      }),
      description: '饼图/环形图组件',
    },

    // --------------------------------------------------------------------------
    // 文本和状态组件
    // --------------------------------------------------------------------------

    /** 文本 */
    Text: {
      props: z.object({
        content: z.string(),
        variant: z.enum(['title-large', 'title-medium', 'title-small', 'body', 'caption', 'label']).default('body'),
        color: colorVariantSchema.optional(),
        align: alignSchema.default('left'),
      }),
      description: '文本组件',
    },

    /** 徽章 */
    Badge: {
      props: z.object({
        text: z.string(),
        variant: colorVariantSchema.default('default'),
        size: sizeSchema.default('md'),
      }),
      description: '徽章/标签组件',
    },

    /** 趋势指示器 */
    TrendIndicator: {
      props: z.object({
        value: z.number(),
        label: z.string().optional(),
        inverse: z.boolean().default(false),
        format: z.enum(['percent', 'number']).default('percent'),
      }),
      description: '趋势指示器组件',
    },

    /** 进度条 */
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100),
        max: z.number().default(100),
        label: z.string().optional(),
        showValue: z.boolean().default(true),
        variant: colorVariantSchema.default('primary'),
        size: sizeSchema.default('md'),
      }),
      description: '进度条组件',
    },

    // --------------------------------------------------------------------------
    // 交互组件
    // --------------------------------------------------------------------------

    /** 按钮 */
    Button: {
      props: z.object({
        text: z.string(),
        variant: z.enum(['primary', 'secondary', 'ghost', 'danger']).default('primary'),
        size: sizeSchema.default('md'),
        icon: z.string().optional(),
        disabled: z.boolean().default(false),
      }),
      description: '按钮组件',
    },

    /** 空状态 */
    Empty: {
      props: z.object({
        title: z.string().default('暂无数据'),
        description: z.string().optional(),
        icon: z.string().optional(),
      }),
      description: '空状态占位组件',
    },

    /** 加载状态 */
    Loading: {
      props: z.object({
        text: z.string().default('加载中...'),
        size: sizeSchema.default('md'),
      }),
      description: '加载状态组件',
    },
  },

  // 操作定义
  actions: {
    sort: {
      params: z.object({
        column: z.string(),
        direction: z.enum(['asc', 'desc']),
      }),
      description: '排序操作',
    },
    rowClick: {
      params: z.object({
        rowIndex: z.number(),
      }),
      description: '行点击操作',
    },
    buttonClick: {
      params: z.object({
        buttonId: z.string().optional(),
      }),
      description: '按钮点击操作',
    },
  },
})

/** 导出 catalog 类型 */
export type Catalog = typeof catalog

/** 生成 AI 系统提示词 */
export const catalogPrompt = generateCatalogPrompt(catalog)
