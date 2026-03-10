/**
 * JSON Render 自定义 Hooks
 *
 * 提供便捷的 hook 封装，简化 AI 生成 UI 的集成。
 */

import { useState, useCallback } from 'react'
import type { UITree } from '@json-render/core'

/** UI 生成状态 */
export interface UIGenerationState {
  /** 是否正在生成 */
  isGenerating: boolean
  /** 生成的 UI 树 */
  uiTree: UITree | null
  /** 错误信息 */
  error: string | null
}

/**
 * 模拟 AI 生成 UI 的 hook
 *
 * 实际使用时，需要替换为真实的 AI API 调用。
 * 可以接入：
 * - Anthropic Claude API
 * - OpenAI API
 * - 本地大模型服务
 *
 * @example
 * ```tsx
 * import { useUIGeneration, componentRegistry } from '@/shared/json-render'
 * import { Renderer } from '@json-render/react'
 *
 * function AIGeneratedDashboard() {
 *   const { state, generate } = useUIGeneration()
 *
 *   return (
 *     <div>
 *       <input onSubmit={(e) => generate(e.target.value)} />
 *       {state.uiTree && (
 *         <Renderer tree={state.uiTree} registry={componentRegistry} />
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
export function useUIGeneration() {
  const [state, setState] = useState<UIGenerationState>({
    isGenerating: false,
    uiTree: null,
    error: null,
  })

  const generate = useCallback(async (prompt: string) => {
    setState({ isGenerating: true, uiTree: null, error: null })

    try {
      // TODO: 替换为实际的 AI API 调用
      // 示例：使用 @json-render/react 的 useUIStream hook
      /*
      const response = await fetch('/api/generate-ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          catalog: catalogPrompt,
        }),
      })
      const data = await response.json()
      */

      // 模拟响应（开发阶段使用）
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 示例 UI Tree
      const mockTree = generateMockTree(prompt)

      setState({
        isGenerating: false,
        uiTree: mockTree,
        error: null,
      })
    } catch (err) {
      setState({
        isGenerating: false,
        uiTree: null,
        error: err instanceof Error ? err.message : '生成失败',
      })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ isGenerating: false, uiTree: null, error: null })
  }, [])

  return { state, generate, reset }
}

/**
 * 生成模拟 UI Tree（开发/演示用）
 *
 * 根据提示词关键字返回预设的 UI 结构。
 * 实际使用时会被 AI 生成的 JSON 替换。
 */
function generateMockTree(prompt: string): UITree {
  const lowerPrompt = prompt.toLowerCase()

  // KPI 概览
  if (lowerPrompt.includes('kpi') || lowerPrompt.includes('概览') || lowerPrompt.includes('总览')) {
    return {
      root: 'grid-1',
      elements: {
        'grid-1': {
          key: 'grid-1',
          type: 'Grid',
          props: { columns: 4 },
          children: ['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4'],
        },
        'kpi-1': {
          key: 'kpi-1',
          type: 'KpiCard',
          props: { title: '总保费', value: '2,345', unit: '万元', trend: 12.5, trendLabel: '同比' },
          parentKey: 'grid-1',
        },
        'kpi-2': {
          key: 'kpi-2',
          type: 'KpiCard',
          props: { title: '签单量', value: '1,234', unit: '件', trend: -3.2, trendLabel: '环比' },
          parentKey: 'grid-1',
        },
        'kpi-3': {
          key: 'kpi-3',
          type: 'KpiCard',
          props: { title: '续保率', value: '78.5', unit: '%', trend: 5.1, variant: 'success' },
          parentKey: 'grid-1',
        },
        'kpi-4': {
          key: 'kpi-4',
          type: 'KpiCard',
          props: { title: '综合费用率', value: '32.4', unit: '%', trend: -2.1, variant: 'primary' },
          parentKey: 'grid-1',
        },
      },
    }
  }

  // 表格数据
  if (lowerPrompt.includes('表格') || lowerPrompt.includes('排名') || lowerPrompt.includes('top')) {
    return {
      root: 'table-1',
      elements: {
        'table-1': {
          key: 'table-1',
          type: 'DataTable',
          props: {
            title: '业务员保费排名 Top 10',
            columns: [
              { key: 'rank', title: '排名', align: 'center' },
              { key: 'name', title: '业务员', align: 'left' },
              { key: 'org', title: '机构', align: 'left' },
              { key: 'premium', title: '保费(万元)', align: 'right', format: 'currency' },
              { key: 'count', title: '件数', align: 'right', format: 'number' },
              { key: 'growth', title: '增长率', align: 'right', format: 'percent' },
            ],
            data: [
              { rank: 1, name: '张三', org: '分公司A', premium: 156.8, count: 89, growth: 15.2 },
              { rank: 2, name: '李四', org: '分公司B', premium: 142.3, count: 76, growth: 8.7 },
              { rank: 3, name: '王五', org: '分公司A', premium: 128.9, count: 65, growth: -2.1 },
              { rank: 4, name: '赵六', org: '分公司C', premium: 115.4, count: 58, growth: 22.4 },
              { rank: 5, name: '钱七', org: '分公司B', premium: 98.7, count: 52, growth: 5.3 },
            ],
            pageSize: 10,
          },
        },
      },
    }
  }

  // 图表
  if (lowerPrompt.includes('趋势') || lowerPrompt.includes('折线') || lowerPrompt.includes('月度')) {
    return {
      root: 'card-1',
      elements: {
        'card-1': {
          key: 'card-1',
          type: 'Card',
          props: { title: '月度保费趋势' },
          children: ['chart-1'],
        },
        'chart-1': {
          key: 'chart-1',
          type: 'LineChart',
          props: {
            data: [
              { x: '1月', y: 180 },
              { x: '2月', y: 165 },
              { x: '3月', y: 210 },
              { x: '4月', y: 195 },
              { x: '5月', y: 230 },
              { x: '6月', y: 245 },
            ],
            xAxisLabel: '月份',
            yAxisLabel: '保费(万元)',
            smooth: true,
            showArea: true,
          },
          parentKey: 'card-1',
        },
      },
    }
  }

  // 分布/饼图
  if (lowerPrompt.includes('分布') || lowerPrompt.includes('占比') || lowerPrompt.includes('构成')) {
    return {
      root: 'grid-1',
      elements: {
        'grid-1': {
          key: 'grid-1',
          type: 'Grid',
          props: { columns: 2 },
          children: ['card-1', 'card-2'],
        },
        'card-1': {
          key: 'card-1',
          type: 'Card',
          props: { title: '险种保费分布' },
          children: ['pie-1'],
          parentKey: 'grid-1',
        },
        'pie-1': {
          key: 'pie-1',
          type: 'PieChart',
          props: {
            data: [
              { name: '交强险', value: 450 },
              { name: '车损险', value: 680 },
              { name: '三者险', value: 520 },
              { name: '其他', value: 150 },
            ],
            donut: true,
          },
          parentKey: 'card-1',
        },
        'card-2': {
          key: 'card-2',
          type: 'Card',
          props: { title: '机构保费占比' },
          children: ['bar-1'],
          parentKey: 'grid-1',
        },
        'bar-1': {
          key: 'bar-1',
          type: 'BarChart',
          props: {
            data: [
              { name: '分公司A', value: 580 },
              { name: '分公司B', value: 420 },
              { name: '分公司C', value: 350 },
              { name: '分公司D', value: 280 },
            ],
            horizontal: true,
          },
          parentKey: 'card-2',
        },
      },
    }
  }

  // 默认：仪表盘布局
  return {
    root: 'stack-1',
    elements: {
      'stack-1': {
        key: 'stack-1',
        type: 'Stack',
        props: { gap: 'lg' },
        children: ['grid-1', 'text-1'],
      },
      'grid-1': {
        key: 'grid-1',
        type: 'Grid',
        props: { columns: 3 },
        children: ['kpi-1', 'kpi-2', 'kpi-3'],
        parentKey: 'stack-1',
      },
      'kpi-1': {
        key: 'kpi-1',
        type: 'KpiCard',
        props: { title: '本月保费', value: '1,234', unit: '万元', trend: 8.5 },
        parentKey: 'grid-1',
      },
      'kpi-2': {
        key: 'kpi-2',
        type: 'KpiCard',
        props: { title: '完成率', value: '86.5', unit: '%', variant: 'success' },
        parentKey: 'grid-1',
      },
      'kpi-3': {
        key: 'kpi-3',
        type: 'KpiCard',
        props: { title: '签单量', value: '456', unit: '件', trend: -2.3 },
        parentKey: 'grid-1',
      },
      'text-1': {
        key: 'text-1',
        type: 'Text',
        props: {
          content: '提示：您可以输入更具体的需求，如"展示本月保费前10的业务员表格"或"展示月度保费趋势图"',
          variant: 'caption',
          color: 'default',
        },
        parentKey: 'stack-1',
      },
    },
  }
}

/**
 * 系统提示词（供 AI 调用时使用）
 *
 * 定义 AI 生成 UI JSON 的规则和约束。
 */
export const systemPrompt = `你是一个车险业绩分析助手，负责根据用户需求生成数据可视化 UI。

## 输出格式

你需要生成 UITree 格式的 JSON：

{
  "root": "根元素的key",
  "elements": {
    "key1": {
      "key": "key1",
      "type": "组件类型",
      "props": { ... },
      "children": ["子元素key数组"],
      "parentKey": "父元素key或null"
    }
  }
}

## 可用组件

### 布局组件
- Card: { title?, subtitle?, variant? } - 卡片容器（可包含子组件）
- Grid: { columns(1-6), gap } - 网格布局（可包含子组件）
- Stack: { direction, gap, align } - 堆叠布局（可包含子组件）

### 数据展示
- KpiCard: { title, value, unit?, trend?, trendLabel?, metricPolarity?, variant? } - KPI 指标卡
- DataTable: { columns, data, title?, pageSize?, sortable? } - 数据表格
- BarChart: { title?, data, xAxisLabel?, yAxisLabel?, stacked?, horizontal? } - 柱状图
- LineChart: { title?, data, xAxisLabel?, yAxisLabel?, smooth?, showArea? } - 折线图
- PieChart: { title?, data, showLegend?, donut?, showLabel? } - 饼图

### 文本和状态
- Text: { content, variant, color?, align? } - 文本
- Badge: { text, variant, size? } - 徽章
- TrendIndicator: { value, label?, inverse?, metricPolarity?, format? } - 趋势指示器
- Progress: { value, max?, label?, showValue?, variant? } - 进度条

### 交互
- Button: { text, variant, size?, disabled? } - 按钮
- Empty: { title?, description?, icon? } - 空状态
- Loading: { text?, size? } - 加载状态

## 生成规则

1. 只使用上述定义的组件，不要创造新组件
2. 每个元素必须有唯一的 key
3. 父子关系通过 children 数组和 parentKey 维护
4. 数据格式：
   - 保费单位：万元
   - 百分比：数值形式，如 85.5 表示 85.5%
   - 趋势：正数表示增长，负数表示下降
5. 返回纯 JSON 格式
`
