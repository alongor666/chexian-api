/**
 * 把 /api/auth/route-catalog 返回的路由元数据转成 MCP tools
 */
import { mcpGet, type McpConfig } from '../api.js';

export interface RouteParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;
  description: string;
  enum?: string[];
}

export interface RouteMeta {
  key: string;
  path: string;
  fullPath: string;
  method: 'GET';
  summary: string;
  description: string;
  parameters: RouteParam[];
  /** 时间窗口语义（B290 口径消歧；旧服务端可能缺省） */
  timeWindow?: string;
  /** 时间口径补充说明 */
  timeWindowNote?: string;
  tags: string[];
}

/** 时间窗口语义 → 给 LLM 的中文口径提示（拼入 tool description 防口径歧义） */
const TIME_WINDOW_HINTS: Record<string, string> = {
  'window': '时间口径: 起止日期参数决定的任意窗口，不传则为全量历史累计',
  'rolling': '时间口径: 截至当前的近 N 天滚动窗口',
  'policy-year': '时间口径: 按保单年度切片（非"年初至今"）',
  'ytd-progress': '时间口径: 年度计划进度（实际÷年计划×时间进度），禁止用于回答任意日期窗口的提问',
  'cohort-development': '时间口径: 保单年度批次的发展/成熟度（观察期截止日）',
  'snapshot': '时间口径: 当前状态快照，无时间窗概念',
  'any': '时间口径: 完全由调用方 SQL 决定',
};

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

function paramTypeToJsonSchema(t: RouteParam['type']): string {
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  // date 和 string 在 JSON Schema 里都是 string（date 用 description 标注）
  return 'string';
}

export function routeToTool(meta: RouteMeta): McpTool {
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};
  const required: string[] = [];
  for (const p of meta.parameters) {
    properties[p.name] = {
      type: paramTypeToJsonSchema(p.type),
      description: p.type === 'date' ? `${p.description} (date YYYY-MM-DD)` : p.description,
    };
    if (p.enum) properties[p.name].enum = p.enum;
    if (p.required) required.push(p.name);
  }
  const hint = meta.timeWindow ? TIME_WINDOW_HINTS[meta.timeWindow] : undefined;
  const note = meta.timeWindowNote ? ` ${meta.timeWindowNote}。` : '';
  return {
    name: `cx_query_${meta.key.toLowerCase()}`,
    description: `${meta.summary}. ${meta.description}${hint ? ` 【${hint}。${note}】` : ''}`,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

export async function fetchAllTools(cfg: McpConfig): Promise<{ tools: McpTool[]; routes: RouteMeta[] }> {
  const resp = await mcpGet<{ success: boolean; data: { version: number; routes: RouteMeta[] } }>(
    cfg, '/api/auth/route-catalog',
  );
  const routes = resp.data.routes;
  const tools = routes.map(routeToTool);
  return { tools, routes };
}

/**
 * 发现工具映射：cx_discover_<name> → /api/discover/<name>
 *
 * 启动时拉一次发现数据用于在工具描述中嵌入摘要，实际调用走 mcpGet。
 */
export interface DiscoveryToolBinding {
  tool: McpTool;
  endpoint: string;
}

export async function buildDiscoveryTools(cfg: McpConfig): Promise<DiscoveryToolBinding[]> {
  const [fieldsResp, metricsResp, presetsResp] = await Promise.all([
    mcpGet<{ success: boolean; data: Array<{ id: string; groupable?: boolean }> }>(cfg, '/api/discover/fields').catch(() => null),
    mcpGet<{ success: boolean; data: Array<{ id: string; category: string }> }>(cfg, '/api/discover/metrics').catch(() => null),
    mcpGet<{ success: boolean; data: { vehicleQuickFilters: string[] } }>(cfg, '/api/discover/presets').catch(() => null),
  ]);

  const groupableFieldIds = (fieldsResp?.data ?? [])
    .filter((f) => f.groupable)
    .slice(0, 15)
    .map((f) => f.id)
    .join(', ');
  const metricCount = metricsResp?.data?.length ?? 0;
  const metricCategories = metricsResp?.data
    ? Array.from(new Set(metricsResp.data.map((m) => m.category))).join(', ')
    : 'foundation, ratio, cost, cross_sell, growth, repair, plan, structure';
  const vehicleFilters = (presetsResp?.data?.vehicleQuickFilters ?? []).join(', ');

  return [
    {
      endpoint: '/api/discover/fields',
      tool: {
        name: 'cx_discover_fields',
        description: `列出字段注册表（56 个字段）。groupable=true 仅返回可分组（VARCHAR/TEXT）字段。常用可分组字段：${groupableFieldIds || '(N/A)'}。`,
        inputSchema: {
          type: 'object',
          properties: {
            groupable: { type: 'boolean', description: '是否仅列出可分组字段' },
          },
        },
      },
    },
    {
      endpoint: '/api/discover/metrics',
      tool: {
        name: 'cx_discover_metrics',
        description: `列出指标注册表（${metricCount || 25} 个）。可按 category 过滤：${metricCategories}。指标 SQL 不暴露 — Agent 必须通过 /api/query/pivot 或 /api/query/sql 调用。`,
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `指标分类（${metricCategories}）` },
          },
        },
      },
    },
    {
      endpoint: '/api/discover/presets',
      tool: {
        name: 'cx_discover_presets',
        description: `列出筛选器 schema 和车型快捷预设：${vehicleFilters || 'home_car, truck_1t, truck_2_9t, motorcycle, truck_1_2t, rental, dump, tractor, general'}。`,
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    },
  ];
}
