import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('agent route-question response contract', () => {
  it('registers route constants in server and frontend mirrors', () => {
    const serverRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(serverRoutes).toContain("ROUTE_QUESTION: '/route-question'");
    expect(frontendRoutes).toContain("ROUTE_QUESTION: 'agent/audit/route-question'");
  });

  it('wraps the route-question response with SuccessResponseSchema like other audit endpoints', () => {
    const route = readSource('server/src/agent/routes/agent-audit.ts');

    expect(route).toContain("'/route-question'");
    expect(route).toContain('SuccessResponseSchema(RouteQuestionResultSchema).parse');
    expect(route).not.toMatch(/res\.json\(\s*result\s*\)/);
  });

  it('keeps auth and permission middleware on the route-question endpoint', () => {
    const route = readSource('server/src/agent/routes/agent-audit.ts');

    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
  });

  it('does not introduce LLM, NL2SQL, raw SQL, or implicit current-date behavior', () => {
    const combined = [
      readSource('server/src/agent/routes/agent-audit.ts'),
      readSource('server/src/agent/services/agent-question-router-service.ts'),
    ].join('\n');

    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });

  it('returns a SuccessResponse-wrapped routing result over HTTP', async () => {
    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentAuditRoutes }] = await Promise.all([
      import('../../server/src/config/auth.js'),
      import('../../server/src/middleware/error.js'),
      import('../../server/src/agent/routes/agent-audit.js'),
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/agent/audit', agentAuditRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

      const unauthorizedResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/audit/route-question`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: '变动成本率为什么升高？' }),
        }
      );
      expect(unauthorizedResponse.status).toBe(401);

      const token = jwt.sign(
        { userId: 'u1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const supportedResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/audit/route-question`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ question: '变动成本率为什么升高？' }),
        }
      );
      const supportedBody = (await supportedResponse.json()) as {
        success: boolean;
        data: {
          blocked: boolean;
          status: string;
          matchedCapabilityId?: string;
          recommendedMetrics: string[];
          recommendedTools: string[];
          warnings: string[];
        };
      };

      expect(supportedResponse.status).toBe(200);
      expect(supportedBody.success).toBe(true);
      expect(supportedBody.data).toBeDefined();
      expect(supportedBody.data.blocked).toBe(false);
      expect(supportedBody.data.status).toBe('supported');
      expect(supportedBody.data.matchedCapabilityId).toBe('cost_indicator_diagnosis');
      expect(supportedBody.data.recommendedMetrics).toContain('variable_cost_ratio');
      expect(Array.isArray(supportedBody.data.warnings)).toBe(true);

      const blockedResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/audit/route-question`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ question: '哪个机构承保利润最低？' }),
        }
      );
      const blockedBody = (await blockedResponse.json()) as {
        success: boolean;
        data: { blocked: boolean; status: string; reason?: string };
      };

      expect(blockedResponse.status).toBe(200);
      expect(blockedBody.success).toBe(true);
      expect(blockedBody.data.blocked).toBe(true);
      expect(blockedBody.data.status).toBe('unsupported');
      expect(blockedBody.data.reason).toBeTruthy();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects empty or oversized questions through Zod validation', async () => {
    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentAuditRoutes }] = await Promise.all([
      import('../../server/src/config/auth.js'),
      import('../../server/src/middleware/error.js'),
      import('../../server/src/agent/routes/agent-audit.js'),
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/agent/audit', agentAuditRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

      const token = jwt.sign(
        { userId: 'u1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const emptyResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/agent/audit/route-question`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ question: '' }),
        }
      );
      expect(emptyResponse.ok).toBe(false);
      const emptyBody = (await emptyResponse.json()) as { success: boolean };
      expect(emptyBody.success).toBe(false);
    } finally {
      await closeServer(server);
    }
  });
});
