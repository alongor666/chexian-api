/**
 * AI SQL 生成器模块
 *
 * 使用智谱 GLM 将自然语言转换为 SQL
 * 工作流可视化 + SQL 验证
 */

// 类型导出
export type {
  ZhipuConfig,
  AISqlResult,
  ChatMessage,
  ZhipuResponse,
  WorkflowStep,
  WorkflowState,
} from './types';

export { AVAILABLE_MODELS, DEFAULT_MODEL } from './types';

// 客户端导出
export { generateSqlWithZhipu, validateApiKey } from './zhipuClient';

// 配置存储导出
export {
  getStoredConfig,
  saveConfig,
  clearConfig,
  hasApiKey,
  isUsingEnvKey,
} from './configStore';

// SQL 验证器导出
export { validateWithDuckDB, quickSyntaxCheck } from './sqlValidator';

// 工作流 Hook 导出
export { useAiWorkflow } from './useAiWorkflow';

// 组件导出
export { AiSqlPanel } from './AiSqlPanel';
export { WorkflowSteps } from './WorkflowSteps';
