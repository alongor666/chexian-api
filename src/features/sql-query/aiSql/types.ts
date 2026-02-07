/**
 * AI SQL 生成器类型定义
 */

/**
 * 智谱 API 配置
 */
export interface ZhipuConfig {
  apiKey: string;
  model: string;
}

/**
 * AI SQL 生成结果
 */
export interface AISqlResult {
  success: boolean;
  sql: string;
  explanation?: string;
  error?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 智谱 API 响应
 */
export interface ZhipuResponse {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

/**
 * 可用模型列表（标准 API - 仅免费模型）
 * @see https://open.bigmodel.cn/dev/api
 */
export const AVAILABLE_MODELS = [
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', description: '最新免费模型，推荐' },
  { id: 'glm-4-flash', name: 'GLM-4-Flash', description: '免费模型，稳定' },
] as const;

export const DEFAULT_MODEL = 'glm-4.7-flash';

/**
 * 工作流步骤状态
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'success' | 'error';

export interface WorkflowStep {
  id: string;
  name: string;
  status: WorkflowStepStatus;
  message?: string;
  duration?: number;
}

export interface WorkflowState {
  steps: WorkflowStep[];
  startTime?: number;
  totalDuration?: number;
}
