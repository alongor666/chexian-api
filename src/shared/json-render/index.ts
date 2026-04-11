/**
 * JSON Render 集成模块
 *
 * 提供 AI 生成 UI 的能力，通过 Zod schema 定义组件目录，
 * 确保 AI 只能生成预定义的、安全的 UI 结构。
 *
 * @packageDocumentation
 */

// Catalog 定义
export { catalog, catalogPrompt } from './catalog'
export type { Catalog } from './catalog'

// 组件注册表
export { componentRegistry } from './components'
export type { RenderChildren } from './components'

// Hooks (useUIGeneration removed — zero callers, mock-only dead code)

// 从 @json-render/react 重新导出核心组件
export {
  // Providers
  JSONUIProvider,
  DataProvider,
  ActionProvider,
  ValidationProvider,
  VisibilityProvider,
  // Renderer
  Renderer,
  // Hooks
  useUIStream,
  useData,
  useDataValue,
  useDataBinding,
  useAction,
  useActions,
  useValidation,
  useFieldValidation,
  useVisibility,
  useIsVisible,
  // Utils
  flatToTree,
  createRendererFromCatalog,
} from '@json-render/react'

// 从 @json-render/core 重新导出类型
export type {
  UITree,
  UIElement,
  Catalog as CatalogType,
  ComponentDefinition,
} from '@json-render/core'
