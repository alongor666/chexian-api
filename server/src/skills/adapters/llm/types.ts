/**
 * LLM Adapter 接口 — 阶段 3
 *
 * 设计边界（CLAUDE.md §10 红线）：
 * 1. 仅生成「叙述文本」（narrative），禁止用于生成 SQL — NL2SQL 走 services/zhipu.ts
 * 2. 调用方必须在路由层而非 Skill 内调用，确保 deterministic skill 边界
 * 3. 所有 provider 都必须经过 sql-guard，拦截疑似 SQL 关键字的输出
 * 4. 失败永远 fallback 到上游确定性输出（caller 负责 fallback）
 */

export interface LLMNarrativeRequest {
  /** 系统级 prompt（描述任务边界），必须显式拒绝 SQL */
  systemPrompt: string;
  /** 用户输入：报告原始数据摘要（已脱敏，不含 PII） */
  userContent: string;
  /** 控制温度，叙述类默认 0.3 */
  temperature?: number;
  /** 最大输出 token，默认 512（叙述够用） */
  maxTokens?: number;
}

export interface LLMNarrativeResponse {
  /** 通过 sql-guard 后的安全叙述文本 */
  text: string;
  /** 调用模型名 */
  model: string;
  /** token 消耗（可能为空，mock provider 不上报） */
  tokens?: { prompt: number; completion: number; total: number };
  /** 是否触发 sql-guard 拦截（true 时 text 已被替换为占位符） */
  blockedBySqlGuard: boolean;
}

export interface LLMAdapter {
  /** provider 名（用于审计日志） */
  readonly provider: string;
  /** 是否可用（apiKey 配置 + 网络可达检查留给 caller） */
  readonly enabled: boolean;
  generateNarrative(req: LLMNarrativeRequest): Promise<LLMNarrativeResponse>;
}

export class LLMUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string
  ) {
    super(`LLM provider ${provider} unavailable: ${reason}`);
    this.name = 'LLMUnavailableError';
  }
}
