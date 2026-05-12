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
  tags: string[];
}

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
  return {
    name: `cx_query_${meta.key.toLowerCase()}`,
    description: `${meta.summary}. ${meta.description}`,
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
