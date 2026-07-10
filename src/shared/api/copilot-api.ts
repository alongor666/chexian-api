/**
 * Copilot 子客户端（backlog 2026-07-03-claude-05dff4 ① 手写 fetch 收编）
 *
 * 挂载点：apiClient.copilot.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 收编来源：src/features/copilot 下 4 处绕过 apiClient 的手写 fetch
 * （useCopilotRun 创建 run / 拉报告 + useForecastBaseline / useForecastScenario
 * 的 baseline 与 profit-scenario POST）。收编后统一获得传输内核的鉴权头注入、
 * 401 静默刷新、403/429 全局拦截、GET 同 key 合并与 30s 超时。
 *
 * 不收编项：useCopilotRun 的 SSE 订阅（EventSource 是浏览器原生 API，无法走
 * fetch 传输内核），仍在 hook 内直连 `${API_BASE}/copilot/runs/:runId/stream`。
 *
 * 返回类型：copilot 域的富类型（ForecastBaselineData 等）定义在
 * src/features/copilot（特性层），shared 层禁止反向引用（分层边界规则 (b)），
 * 故方法用泛型透传，调用方在特性层落类型。
 */

import { COPILOT_ROUTES, AGENT_FORECAST_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class CopilotApi {
  constructor(private readonly t: ApiTransport) {}

  /** 创建 workflow run（POST copilot/runs），异步触发，立即返回 runId（进度走 SSE） */
  createRun<T = { runId: string }>(body: {
    workflowId: string;
    input: unknown;
  }): Promise<T> {
    return this.t.request(`/${COPILOT_ROUTES.RUNS}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** 拉取 run 的 Markdown 报告（GET copilot/runs/:runId/report），可选 LLM 叙事增强 */
  report<T>(runId: string, includeNarrative = false): Promise<T> {
    const path = COPILOT_ROUTES.RUN_REPORT.replace(':runId', encodeURIComponent(runId));
    return this.t.request(`/${path}${includeNarrative ? '?includeNarrative=1' : ''}`);
  }

  /** 利润预测基线（POST agent/forecast/baseline）：actual + 4 变量历史分位数 + defaults */
  forecastBaseline<T>(body: {
    cutoffDate: string;
    /** 特性层 ForecastBaselineFilters（interface 无索引签名，shared 层用 unknown 透传） */
    filters: unknown;
    historyWindowYears: number;
    recentExpenseMonths: number;
  }): Promise<T> {
    return this.t.request(`/${AGENT_FORECAST_ROUTES.BASELINE}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** 单情景利润测算（POST agent/forecast/profit-scenario） */
  profitScenario<T>(body: {
    scenarioName: string;
    premium: number;
    ultimateVariableCostRatio: number;
    ultimateFixedCostRatio: number;
    earningSchedule: Array<{ period: string; earnedRatio: number }>;
    assumptionSource: string;
  }): Promise<T> {
    return this.t.request(`/${AGENT_FORECAST_ROUTES.PROFIT_SCENARIO}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
