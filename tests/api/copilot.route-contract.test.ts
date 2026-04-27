/**
 * Copilot 路由 contract 测试 — 阶段 3
 *
 * 与 agent-*-diagnosis.route-contract.test.ts 同模式：源码级断言，不依赖运行时。
 *
 * 校验：
 *  - 路由常量同时出现在 server 和 frontend mirror
 *  - 路由文件挂载 authMiddleware + permissionMiddleware
 *  - 不携带 NL2SQL / 自由 SQL / openrouter 等危险标记
 *  - 仅允许的 workflow id 白名单存在
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('copilot route contract', () => {
  it('registers /api/copilot route constants in server + frontend mirror', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain("RUNS: '/runs'");
    expect(serverRoutes).toContain("RUN_STREAM: '/runs/:runId/stream'");
    expect(serverRoutes).toContain("RUN_REPORT: '/runs/:runId/report'");

    expect(frontendRoutes).toContain("RUNS: 'copilot/runs'");
    expect(frontendRoutes).toContain("RUN_STREAM: 'copilot/runs/:runId/stream'");
    expect(frontendRoutes).toContain("RUN_REPORT: 'copilot/runs/:runId/report'");
  });

  it('mounts copilot router with auth + permission middleware', () => {
    const app = readSource('server/src/app.ts');
    const route = readSource('server/src/routes/copilot.ts');

    expect(app).toContain("app.use('/api/copilot', copilotRoutes)");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
  });

  it('whitelists only auto-risk-control-v1 in copilot router', () => {
    const route = readSource('server/src/routes/copilot.ts');
    expect(route).toContain("ALLOWED_WORKFLOW_IDS = new Set(['auto-risk-control-v1'])");
  });

  it('does not introduce NL2SQL / raw SQL / openrouter usage in copilot router', () => {
    const route = readSource('server/src/routes/copilot.ts');
    expect(route).not.toMatch(/openrouter|claude-3|gpt-4|nl2sql|rawSql|freeSql/i);
    expect(route).not.toMatch(/\bSELECT\s+\*/i);
    expect(route).not.toContain('CURRENT_DATE');
    // copilot 路由不能直接调 generateSqlWithZhipu（那是 NL2SQL 入口）
    expect(route).not.toContain('generateSqlWithZhipu');
  });

  it('SSE endpoint sets Content-Type: text/event-stream', () => {
    const route = readSource('server/src/routes/copilot.ts');
    expect(route).toContain("'Content-Type', 'text/event-stream'");
    expect(route).toContain("'X-Accel-Buffering'");
  });

  it('LLM narrative is opt-in via includeNarrative=1', () => {
    const route = readSource('server/src/routes/copilot.ts');
    expect(route).toContain("req.query.includeNarrative === '1'");
    expect(route).toContain('NARRATIVE_SYSTEM_PROMPT');
  });

  // ─────────────────────────────────────────────
  // 阶段 4 PR-D: narrative 优先级 — record.report.narrative > LLM 兜底
  // ─────────────────────────────────────────────
  it('narrative 优先取自 record.report.narrative（attach-narrative skill 已落盘）', () => {
    const route = readSource('server/src/routes/copilot.ts');
    // 路由必须读取 record.report?.narrative
    expect(route).toContain('record.report?.narrative');
    // 必须支持 narrativeSource 标记
    expect(route).toMatch(/narrativeSource/);
    // 必须有 'workflow-skill' 与 'route-llm' 两个来源标记
    expect(route).toContain("'workflow-skill'");
    expect(route).toContain("'route-llm'");
  });

  it('narrativeSource 字段在响应中暴露（让前端区分来源）', () => {
    const route = readSource('server/src/routes/copilot.ts');
    // res.json 的 data 段必须包含 narrativeSource
    expect(route).toMatch(/narrative,\s*\n\s*narrativeSource,/);
  });

  it('persistedNarrative 命中时不再调用 LLM provider（避免重复调用）', () => {
    const route = readSource('server/src/routes/copilot.ts');
    // 走 if/else if：persistedNarrative 命中走第一支；未命中且 includeNarrative 才走 LLM
    expect(route).toMatch(/if\s*\(\s*persistedNarrative\s*\)/);
    expect(route).toMatch(/else if\s*\(\s*includeNarrative\s*\)/);
  });

  it('LLM provider import path is the adapter, not zhipu service directly', () => {
    const route = readSource('server/src/routes/copilot.ts');
    expect(route).toContain("from '../skills/adapters/llm/index.js'");
    expect(route).not.toContain("from '../services/zhipu.js'");
  });

  it('异步失败分支：先发 step-completed 再发 workflow-completed（SSE 订阅端不会丢错误详情）', () => {
    const route = readSource('server/src/routes/copilot.ts');
    const stepIdx = route.indexOf("nodeId: '__error__'");
    const completedIdx = route.indexOf("type: 'workflow-completed'", stepIdx);
    expect(stepIdx).toBeGreaterThan(0);
    expect(completedIdx).toBeGreaterThan(stepIdx);
  });
});

describe('workflows route constants — 阶段 4 PR-D', () => {
  it('注册 WORKFLOWS_ROUTES 常量在 server + frontend mirror（治理 #18 一致性）', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain("RUN_AUDIT: '/runs/:runId/audit'");
    expect(serverRoutes).toContain("RUN_APPROVE: '/runs/:runId/approve'");
    expect(serverRoutes).toContain("RUN_REJECT: '/runs/:runId/reject'");

    expect(frontendRoutes).toContain("RUN_AUDIT: 'workflows/runs/:runId/audit'");
    expect(frontendRoutes).toContain("RUN_APPROVE: 'workflows/runs/:runId/approve'");
    expect(frontendRoutes).toContain("RUN_REJECT: 'workflows/runs/:runId/reject'");
  });

  it('apiClient 暴露 getWorkflowAudit / approveWorkflowRun / rejectWorkflowRun', () => {
    const client = readSource('src/shared/api/client.ts');
    expect(client).toContain('async getWorkflowAudit(');
    expect(client).toContain('async approveWorkflowRun(');
    expect(client).toContain('async rejectWorkflowRun(');
    expect(client).toContain('async getWorkflowRun(');
  });
});

describe('copilot SSE event types — 与 workflow-runner.WorkflowStepEvent 对齐', () => {
  it('workflow-runner exports WorkflowStepEvent union 含 4 种类型', () => {
    const runner = readSource('server/src/skills/workflow-runner.ts');
    expect(runner).toContain("type: 'workflow-started'");
    expect(runner).toContain("type: 'step-started'");
    expect(runner).toContain("type: 'step-completed'");
    expect(runner).toContain("type: 'workflow-completed'");
  });

  it('runner.onStep 是非破坏性扩展（不出现在阶段 2 既有调用中）', () => {
    const workflowsRoute = readSource('server/src/routes/workflows.ts');
    expect(workflowsRoute).not.toContain('onStep:');
    // /api/workflows 仍是同步执行不订阅事件
  });
});
