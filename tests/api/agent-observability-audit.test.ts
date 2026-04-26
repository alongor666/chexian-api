import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import {
  getAgentObservabilityAudit,
  getAgentReadinessAudit,
} from '../../server/src/agent/services/agent-adaptation-audit-service';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function writeJsonl(entries: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-observability-'));
  const file = path.join(dir, 'audit.log');
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf-8');
  return file;
}

describe('agent observability audit readiness', () => {
  it('computes 30-day agent diagnosis audit log coverage and error rate from production logs', () => {
    const auditLogPath = writeJsonl([
      {
        timestamp: '2026-04-25T10:00:00.000Z',
        method: 'POST',
        path: '/api/agent/diagnosis/growth',
        status: 200,
        duration: 120,
      },
      {
        timestamp: '2026-04-24T10:00:00.000Z',
        method: 'POST',
        path: '/api/agent/diagnosis/cost-indicators?debug=1',
        status: 200,
        duration: 90,
      },
      {
        timestamp: '2026-04-23T10:00:00.000Z',
        method: 'POST',
        path: '/api/agent/diagnosis/growth',
        status: 500,
        duration: 350,
      },
      {
        timestamp: '2026-03-01T10:00:00.000Z',
        method: 'POST',
        path: '/api/agent/diagnosis/business-patrol',
        status: 200,
        duration: 220,
      },
      {
        timestamp: '2026-04-25T11:00:00.000Z',
        method: 'GET',
        path: '/api/query/kpi',
        status: 200,
        duration: 35,
      },
    ]);

    const audit = getAgentObservabilityAudit({
      auditLogPath,
      now: new Date('2026-04-26T00:00:00.000Z'),
      nodeEnv: 'production',
    });

    expect(audit.phase).toBe('agent_observability_readiness');
    expect(audit.auditLog.exists).toBe(true);
    expect(audit.auditLog).not.toHaveProperty('auditLogPath');
    expect(audit.auditLog.auditLogConfigured).toBe(true);
    expect(audit.auditLog.productionEvidence).toBe(true);
    expect(audit.auditLog.windowDays).toBe(30);
    expect(audit.auditLog.totalAgentDiagnosisCalls).toBe(3);
    expect(audit.auditLog.errorCount).toBe(1);
    expect(audit.auditLog.errorRate).toBeCloseTo(1 / 3, 5);
    expect(audit.auditLog.status).toBe('error_rate_above_threshold');

    const growth = audit.endpointCoverage.find((item) => item.capabilityId === 'growth_diagnosis');
    expect(growth?.observedCallCount).toBe(2);
    expect(growth?.errorCount).toBe(1);
    expect(growth?.lastObservedAt).toBe('2026-04-25T10:00:00.000Z');

    const businessPatrol = audit.endpointCoverage.find((item) => item.capabilityId === 'business_patrol_diagnosis');
    expect(businessPatrol?.observedCallCount).toBe(0);

    expect(audit.stage5Evidence.find((item) => item.id === 'production_audit_log_observed')?.met).toBe(true);
    expect(audit.stage5Evidence.find((item) => item.id === 'thirty_day_error_rate_under_threshold')?.met).toBe(false);
  });

  it('keeps Stage 5 blocked until production logs and caller display evidence are available', () => {
    const audit = getAgentObservabilityAudit({
      auditLogPath: '/tmp/chexian-agent-observability-missing.log',
      now: new Date('2026-04-26T00:00:00.000Z'),
      nodeEnv: 'development',
    });

    expect(audit.auditLog.status).toBe('missing_log');
    expect(audit.auditLog.productionEvidence).toBe(false);
    expect(audit.stage5Evidence.find((item) => item.id === 'production_audit_log_observed')?.met).toBe(false);
    expect(audit.stage5Evidence.find((item) => item.id === 'warnings_and_forbidden_interpretations_displayed')?.met)
      .toBe(false);
    expect(audit.displayContract.status).toBe('pending_caller_display_evidence');
  });

  it('embeds observability evidence into readiness while keeping LLM blocked', () => {
    const readiness = getAgentReadinessAudit({
      observability: {
        auditLogPath: '/tmp/chexian-agent-observability-missing.log',
        now: new Date('2026-04-26T00:00:00.000Z'),
        nodeEnv: 'development',
      },
    });

    expect(readiness.currentStage).toBe('stage_4_6_observability_ready');
    expect(readiness.readyForLlm).toBe(false);
    expect(readiness.observabilityEvidence.auditLog.status).toBe('missing_log');
    expect(readiness.stage5Prerequisites.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'production_audit_log_observed',
        'thirty_day_error_rate_under_threshold',
        'warnings_and_forbidden_interpretations_displayed',
      ])
    );
    expect(readiness.llmReadinessBlockers.join('\n')).toContain('缺少生产 audit log');
  });

  it('serves the protected observability audit route over HTTP', async () => {
    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentAuditRoutes }] =
      await Promise.all([
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

      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/audit/observability`);
      expect(unauthorizedResponse.status).toBe(401);

      const token = jwt.sign(
        { userId: 'u1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );
      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/audit/observability`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as {
        success: boolean;
        data: { phase: string; auditLog: { windowDays: number }; displayContract: { requiredFields: string[] } };
      };

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.phase).toBe('agent_observability_readiness');
      expect(body.data.auditLog.windowDays).toBe(30);
      expect(body.data.displayContract.requiredFields).toEqual(['warnings', 'forbiddenInterpretations']);
    } finally {
      await closeServer(server);
    }
  });
});
