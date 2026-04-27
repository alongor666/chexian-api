/**
 * /api/copilot — 阶段 3
 *
 * 前端 Copilot MVP 的后端编排层：
 *  - POST /api/copilot/runs        异步触发 workflow，立即返回 runId（前端可订阅 SSE）
 *  - GET  /api/copilot/runs/:runId/stream   SSE 推送 workflow 执行进度（step-started/step-completed/workflow-completed）
 *  - GET  /api/copilot/runs/:runId/report   渲染 Markdown 报告（report-template skill），可选 LLM narrative 增强
 *
 * 鉴权：authMiddleware + permissionMiddleware（与 /api/workflows 一致）
 *
 * 红线（CLAUDE.md §10）：
 *  - LLM 仅用于「叙述生成」，不调用自然语言转 SQL 接口；narrative 失败 → 不阻断报告
 *  - 报告内容是 report-template skill 的确定性输出，narrative 仅追加为「执行摘要」段
 *  - 前端 SSE 推送内容仅含元数据（nodeId/skillId/status/elapsedMs/error），不含原始数据
 */

import { Router, type Response } from 'express';
import { EventEmitter } from 'node:events';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { getRequestContext } from '../utils/request-context.js';
import { getSkill } from '../skills/registry.js';
import { runSkill } from '../skills/runner.js';
import { reportTemplateSkill } from '../skills/skills/report-template.skill.js';
import { getWorkflow } from '../skills/workflows/index.js';
import {
  runWorkflow,
  getWorkflowRun,
  generateWorkflowRunId,
  type WorkflowStepEvent,
} from '../skills/workflow-runner.js';
import type { SkillContext } from '../skills/types.js';
import {
  getDefaultLlmProvider,
  NARRATIVE_SYSTEM_PROMPT,
  LLMUnavailableError,
} from '../skills/adapters/llm/index.js';

// ───────────────────────── In-Memory Progress Bus ─────────────────────────

interface RunChannel {
  emitter: EventEmitter;
  events: WorkflowStepEvent[];
  done: boolean;
  username: string;
  startedAt: number;
}

const RUN_CHANNELS = new Map<string, RunChannel>();
const CHANNEL_TTL_MS = 10 * 60 * 1000; // 10 分钟回收

function gcChannels(): void {
  const now = Date.now();
  for (const [runId, ch] of RUN_CHANNELS) {
    if (ch.done && now - ch.startedAt > CHANNEL_TTL_MS) {
      RUN_CHANNELS.delete(runId);
    }
  }
}

function createChannel(runId: string, username: string): RunChannel {
  gcChannels();
  const ch: RunChannel = {
    emitter: new EventEmitter(),
    events: [],
    done: false,
    username,
    startedAt: Date.now(),
  };
  ch.emitter.setMaxListeners(8);
  RUN_CHANNELS.set(runId, ch);
  return ch;
}

function pushEvent(ch: RunChannel, event: WorkflowStepEvent): void {
  ch.events.push(event);
  if (event.type === 'workflow-completed') {
    ch.done = true;
  }
  ch.emitter.emit('event', event);
}

// ───────────────────────── Router ─────────────────────────

const router = Router();
router.use(authMiddleware);
router.use(permissionMiddleware);

const ALLOWED_WORKFLOW_IDS = new Set(['auto-risk-control-v1']);

/**
 * POST /api/copilot/runs
 * Body: { workflowId: string, input: <WorkflowInput> }
 * 立即返回 runId，后台异步执行。
 */
router.post(
  '/runs',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { workflowId?: unknown; input?: unknown };
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId : 'auto-risk-control-v1';
    if (!ALLOWED_WORKFLOW_IDS.has(workflowId)) {
      throw new AppError(400, `Workflow not allowed in copilot: ${workflowId}`);
    }
    const workflow = getWorkflow(workflowId);
    if (!workflow) throw new AppError(404, `Workflow not found: ${workflowId}`);

    if (!req.user || !req.permissionFilter) {
      throw new AppError(401, 'Authentication context missing');
    }

    const reqCtx = getRequestContext();
    const startedAt = Date.now();
    const runId = generateWorkflowRunId(workflow.id);
    const ctx: SkillContext = {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role,
      organization: req.user.organization,
      permissionFilter: req.permissionFilter,
      requestId: reqCtx?.requestId ?? 'unknown',
      startedAt,
      now: new Date(),
    };

    const channel = createChannel(runId, ctx.username);

    // 异步执行 — 不 await
    runWorkflow(workflow, body.input, ctx, {
      resolveSkill: getSkill,
      preassignedRunId: runId,
      onStep: (event) => pushEvent(channel, event),
    }).catch((err) => {
      // 顺序关键：先发 step-completed 让订阅端拿到错误详情，再发 workflow-completed
      // （SSE 订阅端在收到 workflow-completed 后立即关闭连接）
      pushEvent(channel, {
        type: 'step-completed',
        runId,
        nodeId: '__error__',
        status: 'failed',
        elapsedMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      pushEvent(channel, {
        type: 'workflow-completed',
        runId,
        status: 'failed',
        elapsedMs: Date.now() - startedAt,
      });
    });

    res.status(202).json({
      success: true,
      data: {
        runId,
        workflowId: workflow.id,
        streamUrl: `/api/copilot/runs/${runId}/stream`,
        reportUrl: `/api/copilot/runs/${runId}/report`,
      },
    });
  })
);

/**
 * GET /api/copilot/runs/:runId/stream
 * Server-Sent Events 推送进度
 */
router.get('/runs/:runId/stream', (req, res) => {
  const runId = req.params.runId;
  const channel = RUN_CHANNELS.get(runId);

  if (!req.user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!channel) {
    res.status(404).json({ success: false, error: `run ${runId} not found or expired` });
    return;
  }
  if (req.user.role !== 'branch_admin' && channel.username !== req.user.username) {
    res.status(403).json({ success: false, error: 'cannot subscribe to other user runs' });
    return;
  }

  setupSseHeaders(res);

  // 1) 回放已发生的事件
  for (const ev of channel.events) {
    writeSseEvent(res, ev);
  }

  if (channel.done) {
    writeSseEvent(res, { type: 'stream-end', runId });
    res.end();
    return;
  }

  // 2) 订阅后续事件
  const onEvent = (event: WorkflowStepEvent) => {
    writeSseEvent(res, event);
    if (event.type === 'workflow-completed') {
      writeSseEvent(res, { type: 'stream-end', runId });
      res.end();
      channel.emitter.off('event', onEvent);
    }
  };
  channel.emitter.on('event', onEvent);

  // 心跳
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    channel.emitter.off('event', onEvent);
  });
});

/**
 * GET /api/copilot/runs/:runId/report?includeNarrative=1
 * 渲染 Markdown 报告（确定性 + 可选 LLM 叙述）
 */
router.get(
  '/runs/:runId/report',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.permissionFilter) {
      throw new AppError(401, 'Authentication context missing');
    }
    const runId = req.params.runId;
    const includeNarrative = req.query.includeNarrative === '1' || req.query.includeNarrative === 'true';

    // 等待 run 落盘（最多 30s 轮询）
    const record = await waitForWorkflowRun(runId, 30_000);
    if (!record) {
      throw new AppError(404, `Workflow run not found or still running: ${runId}`);
    }
    if (req.user.role !== 'branch_admin' && record.username !== req.user.username) {
      throw new AppError(403, 'Cannot access another user run');
    }

    const reqCtx = getRequestContext();
    const skillCtx: SkillContext = {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role,
      organization: req.user.organization,
      permissionFilter: req.permissionFilter,
      requestId: reqCtx?.requestId ?? 'unknown',
      startedAt: Date.now(),
      now: new Date(),
    };

    const { result } = await runSkill(reportTemplateSkill, { workflowRunId: runId }, skillCtx, {
      persist: false,
    });

    // 阶段 4 PR-D：narrative 优先取自 record.report.narrative（attach-narrative skill 已落盘）
    // - workflow 跑 attach-narrative 节点成功后 record.report.narrative 即被填充
    // - 命中时 narrativeSource='workflow-skill'，避免重复调 LLM
    // - 未命中且 includeNarrative=1 → 走旧 LLM 兜底，narrativeSource='route-llm'
    // - 都没有 → narrativeSource=null
    let narrative: string | null = null;
    let narrativeSource: 'workflow-skill' | 'route-llm' | null = null;
    let narrativeMeta:
      | { provider: string; blockedBySqlGuard?: boolean; tokens?: unknown; error?: string }
      | null = null;

    const persistedNarrative = record.report?.narrative ?? null;
    if (persistedNarrative) {
      narrative = persistedNarrative;
      narrativeSource = 'workflow-skill';
    } else if (includeNarrative) {
      const preflight = await tryGenerateNarrative(result.result.markdown, result.result.allWarnings);
      narrativeMeta = preflight;
      if (preflight && !preflight.error) {
        const provider = getDefaultLlmProvider();
        try {
          const r = await provider.generateNarrative({
            systemPrompt: NARRATIVE_SYSTEM_PROMPT,
            userContent: buildNarrativeContext(result.result),
            temperature: 0.3,
            maxTokens: 400,
          });
          narrative = r.text;
          narrativeSource = 'route-llm';
          narrativeMeta = {
            provider: provider.provider,
            blockedBySqlGuard: r.blockedBySqlGuard,
            tokens: r.tokens,
          };
        } catch (err) {
          narrativeMeta = {
            provider: provider.provider,
            error: err instanceof LLMUnavailableError ? err.reason : err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    const finalMarkdown = narrative
      ? `## 执行摘要（LLM 叙述）\n\n> ${narrative.replace(/\n/g, '\n> ')}\n\n${result.result.markdown}`
      : result.result.markdown;

    res.json({
      success: true,
      data: {
        runId,
        workflowId: result.result.workflowId,
        workflowStatus: result.result.workflowStatus,
        markdown: finalMarkdown,
        sections: result.result.sections,
        redLineWarnings: result.result.redLineWarnings,
        successCount: result.result.successCount,
        failedCount: result.result.failedCount,
        skippedCount: result.result.skippedCount,
        totalElapsedMs: result.result.totalElapsedMs,
        narrative,
        narrativeSource,
        narrativeMeta,
      },
    });
  })
);

export default router;

// ───────────────────────── Helpers ─────────────────────────

function setupSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx：禁用缓冲
  res.flushHeaders?.();
}

function writeSseEvent(res: Response, payload: object): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function waitForWorkflowRun(runId: string, timeoutMs: number) {
  const channel = RUN_CHANNELS.get(runId);
  if (channel && !channel.done) {
    await new Promise<void>((resolve) => {
      const onEvent = (event: WorkflowStepEvent) => {
        if (event.type === 'workflow-completed') {
          channel.emitter.off('event', onEvent);
          resolve();
        }
      };
      channel.emitter.on('event', onEvent);
      setTimeout(() => {
        channel.emitter.off('event', onEvent);
        resolve();
      }, timeoutMs);
    });
  }
  return getWorkflowRun(runId);
}

/**
 * 简短预检：当 markdown 极长时截取核心数据片段，避免触发 LLM 限流。
 * 返回非 null 时表示「值得调用 LLM」。
 */
async function tryGenerateNarrative(markdown: string, _warnings: string[]) {
  if (markdown.length < 50) return { provider: 'skipped', error: 'markdown too short' };
  return { provider: 'pending', blockedBySqlGuard: false };
}

function buildNarrativeContext(result: {
  workflowId: string;
  workflowStatus: string;
  successCount: number;
  failedCount: number;
  redLineWarnings: string[];
  sections: Array<{ title: string; status: string; markdown: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`工作流：${result.workflowId} · 状态：${result.workflowStatus}`);
  lines.push(`步骤：成功 ${result.successCount} / 失败 ${result.failedCount}`);
  lines.push('');
  for (const s of result.sections) {
    lines.push(`### ${s.title}（${s.status}）`);
    // 截取每段前 600 字，避免 prompt 过长 + 减少 LLM 暴露
    lines.push(s.markdown.slice(0, 600));
    lines.push('');
  }
  return lines.join('\n').slice(0, 6000);
}
