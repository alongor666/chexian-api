#!/usr/bin/env node
/**
 * chexian-mcp — stdio MCP server for chexian-api
 *
 * 启动时拉 /api/auth/route-catalog，把 /api/query/* 路由全部映射为 MCP tools。
 * 用户在 Claude Desktop 等客户端的 mcpServers 配置：
 *   {
 *     "chexian": {
 *       "command": "npx",
 *       "args": ["-y", "@chexian/mcp"],
 *       "env": { "CX_BASE_URL": "https://chexian.cretvalu.com", "CX_PAT": "cx_pat_xxx.yyy" }
 *     }
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadMcpConfig, mcpGet } from './api.js';
import { fetchAllTools, type RouteMeta, type McpTool } from './tools/build-tools.js';

async function main(): Promise<void> {
  const cfg = loadMcpConfig();

  // 启动时拉一次 catalog；失败直接退出（Claude Desktop 会显示错误）
  let tools: McpTool[] = [];
  let routes: RouteMeta[] = [];
  try {
    const result = await fetchAllTools(cfg);
    tools = result.tools;
    routes = result.routes;
  } catch (err) {
    console.error(`[chexian-mcp] Failed to fetch route-catalog: ${(err as Error).message}`);
    process.exit(1);
  }

  const routesByToolName = new Map<string, RouteMeta>(
    routes.map((r) => [`cx_query_${r.key.toLowerCase()}`, r]),
  );

  const server = new Server(
    { name: 'chexian-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const route = routesByToolName.get(toolName);
    if (!route) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      };
    }
    try {
      const args = (request.params.arguments ?? {}) as Record<string, string | number | boolean>;
      const data = await mcpGet<unknown>(cfg, route.fullPath, args);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify((data as any)?.data ?? data, null, 2),
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: (err as Error).message }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[chexian-mcp] Ready. ${tools.length} tools loaded from ${cfg.baseUrl}`);
}

main().catch((err) => {
  console.error(`[chexian-mcp] Fatal: ${(err as Error).message}`);
  process.exit(1);
});
