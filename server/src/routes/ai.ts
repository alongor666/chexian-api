/**
 * AI 路由
 * AI Routes
 *
 * POST /api/ai/nl2sql - 自然语言转 SQL
 * POST /api/ai/validate-key - 验证 API Key
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { generateSqlWithZhipu, validateApiKey, analyzeOrgTrendWithZhipu } from '../services/zhipu.js';
import { analyzeOrgTrendWithOpenRouter } from '../services/openrouter.js';
import { validateSQL } from '../utils/sql-validator.js';
import { duckdbService } from '../services/duckdb.js';
import { injectPermissionFilter, isValidPermissionFilter } from '../utils/sql-permission-injector.js';

const router = Router();

/**
 * 应用认证中间件
 */
router.use(authMiddleware);
router.use(permissionMiddleware);

/**
 * NL2SQL 请求验证 Schema
 */
const nl2sqlSchema = z.object({
  query: z.string().min(1).max(500),
  apiKey: z.string().min(10),
  model: z.string().optional(),
  execute: z.boolean().optional().default(false),
});

/**
 * POST /api/ai/nl2sql
 * 自然语言转 SQL
 */
router.post(
  '/nl2sql',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = nl2sqlSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { query, apiKey, model, execute } = parseResult.data;

    console.log(`[AI] NL2SQL request: "${query.substring(0, 50)}..."`);

    // 1. 调用智谱 API 生成 SQL
    const result = await generateSqlWithZhipu(query, { apiKey, model });

    if (!result.success) {
      return res.json({
        success: false,
        error: result.error,
      });
    }

    // 2. 验证生成的 SQL（安全校验）
    const validation = validateSQL(result.sql);
    if (!validation.valid) {
      return res.json({
        success: false,
        sql: result.sql,
        error: `生成的 SQL 不安全: ${validation.error}`,
        tokens: result.tokens,
      });
    }

    // 3. 如果需要执行，注入权限过滤并执行
    let queryResult = null;
    let executionError = null;

    if (execute) {
      try {
        const permissionFilter = req.permissionFilter || '1=1';

        // 验证权限过滤条件
        if (!isValidPermissionFilter(permissionFilter)) {
          throw new Error('权限配置错误');
        }

        // 注入权限过滤
        const finalSql = injectPermissionFilter(result.sql, permissionFilter);

        // 执行查询
        queryResult = await duckdbService.query(finalSql);
        console.log(`[AI] Query executed, ${queryResult.length} rows returned`);
      } catch (err) {
        executionError = err instanceof Error ? err.message : '查询执行失败';
        console.error(`[AI] Query execution error:`, executionError);
      }
    }

    res.json({
      success: true,
      sql: result.sql,
      tokens: result.tokens,
      ...(execute && {
        executed: !executionError,
        result: queryResult,
        executionError,
      }),
    });
  })
);

/**
 * API Key 验证请求 Schema
 */
const validateKeySchema = z.object({
  apiKey: z.string().min(10),
});

/**
 * 解析逗号分隔模型列表
 */
function parseModelList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

interface TrendCacheEntry {
  analysis: string;
  source: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  expiresAt: number;
}

const trendAnalysisCache = new Map<string, TrendCacheEntry>();

function getTrendCacheKey(
  rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number; avg_premium: number }>,
  org: string,
  coverage: string,
  openRouterModels: string[]
): string {
  return JSON.stringify({
    org,
    coverage,
    models: openRouterModels,
    rows,
  });
}

/**
 * POST /api/ai/validate-key
 * 验证智谱 API Key
 */
router.post(
  '/validate-key',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = validateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { apiKey } = parseResult.data;

    const isValid = await validateApiKey(apiKey);

    res.json({
      success: true,
      valid: isValid,
      message: isValid ? 'API Key 有效' : 'API Key 无效或已过期',
    });
  })
);

/**
 * POST /api/ai/trend-analysis
 * 机构推介率趋势 AI 分析（后端从环境变量读取 API Key）
 */
const trendAnalysisSchema = z.object({
  rows: z.array(z.object({
    date: z.string(),
    auto_count: z.number(),
    driver_count: z.number(),
    rate: z.number(),
    avg_premium: z.number(),
  })).min(1).max(90),
  org: z.string().default('全部'),
  coverage: z.string().default('整体'),
});

router.post(
  '/trend-analysis',
  asyncHandler(async (req: Request, res: Response) => {
    const requestStartAt = Date.now();
    const parseResult = trendAnalysisSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { rows, org, coverage } = parseResult.data;
    const timeoutMs = parsePositiveInt(process.env.AI_PROVIDER_TIMEOUT_MS, 4500);
    const cacheTtlMs = parsePositiveInt(process.env.AI_TREND_CACHE_TTL_MS, 180000);

    // 主路由：OpenRouter（支持逗号分隔模型顺序降级）
    const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
    const openRouterModels = parseModelList(
      process.env.AI_PRIMARY_MODEL || process.env.OPENROUTER_MODELS
    );
    const cacheKey = getTrendCacheKey(rows, org, coverage, openRouterModels);
    const cached = trendAnalysisCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({
        success: true,
        analysis: cached.analysis,
        source: `${cached.source}:cache`,
        cached: true,
        usage: cached.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        elapsed_ms: Date.now() - requestStartAt,
      });
      return;
    }

    if (openRouterApiKey && openRouterModels.length > 0) {
      const openRouterResult = await analyzeOrgTrendWithOpenRouter(
        rows,
        { org, coverage },
        {
          apiKey: openRouterApiKey,
          models: openRouterModels,
          timeoutMs,
        }
      );

      if (openRouterResult.success) {
        trendAnalysisCache.set(cacheKey, {
          analysis: openRouterResult.analysis,
          source: `openrouter:${openRouterResult.model || openRouterModels[0]}`,
          usage: openRouterResult.usage,
          expiresAt: Date.now() + cacheTtlMs,
        });
        res.json({
          success: true,
          analysis: openRouterResult.analysis,
          source: `openrouter:${openRouterResult.model || openRouterModels[0]}`,
          cached: false,
          usage: openRouterResult.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          elapsed_ms: Date.now() - requestStartAt,
        });
        return;
      }
    }

    // 免费兜底：保持当前智谱配置
    const zhipuApiKey = process.env.ZHIPU_API_KEY || process.env.VITE_ZHIPU_API_KEY || '';
    if (!zhipuApiKey) {
      throw new AppError(503, '服务端未配置可用 AI Key（OpenRouter/Zhipu），无法使用 AI 分析');
    }

    const result = await analyzeOrgTrendWithZhipu(rows, { org, coverage }, { apiKey: zhipuApiKey });

    if (result.success) {
      trendAnalysisCache.set(cacheKey, {
        analysis: result.analysis,
        source: 'zhipu',
        usage: result.usage,
        expiresAt: Date.now() + cacheTtlMs,
      });
    }

    res.json({
      success: result.success,
      analysis: result.analysis,
      source: 'zhipu',
      cached: false,
      usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      elapsed_ms: Date.now() - requestStartAt,
      ...(result.error && { error: result.error }),
    });
  })
);

export default router;
