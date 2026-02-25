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
import { generateSqlWithZhipu, validateApiKey } from '../services/zhipu.js';
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

export default router;
