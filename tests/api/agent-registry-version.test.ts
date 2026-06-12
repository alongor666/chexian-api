import { describe, expect, it } from 'vitest';

import {
  AgentRegistryMetaSchema,
  AgentRegistryVersionSchema,
} from '../../server/src/agent/schemas/agent-registry-meta.schema';
import {
  agentMetricRegistry,
  agentMetricRegistryMeta,
} from '../../server/src/agent/registry/agent-metric-registry';
import {
  agentDataCapabilityRegistry,
  agentDataCapabilityRegistryMeta,
} from '../../server/src/agent/registry/agent-data-capability-registry';
import {
  agentForecastOutputRegistry,
  agentForecastOutputRegistryMeta,
} from '../../server/src/agent/registry/agent-forecast-output-registry';
import {
  unsupportedMetricRegistry,
  unsupportedMetricRegistryMeta,
} from '../../server/src/agent/registry/unsupported-metric-registry';
import { getAgentMetricAudit } from '../../server/src/agent/services/agent-metric-audit-service';
import {
  getAgentCapabilityAudit,
  getAgentReadinessAudit,
  getUnsupportedMetricAudit,
} from '../../server/src/agent/services/agent-adaptation-audit-service';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

describe('agent 注册表表级版本元数据（harness 对标门槛 3）', () => {
  const metaByRegistryId = [
    { registryId: 'agent-metric', meta: agentMetricRegistryMeta, entries: agentMetricRegistry },
    {
      registryId: 'agent-data-capability',
      meta: agentDataCapabilityRegistryMeta,
      entries: agentDataCapabilityRegistry,
    },
    {
      registryId: 'agent-forecast-output',
      meta: agentForecastOutputRegistryMeta,
      entries: agentForecastOutputRegistry,
    },
    {
      registryId: 'unsupported-metric',
      meta: unsupportedMetricRegistryMeta,
      entries: unsupportedMetricRegistry,
    },
  ] as const;

  it('4 张注册表均导出通过 Zod 校验的表级 meta', () => {
    for (const { registryId, meta } of metaByRegistryId) {
      const parsed = AgentRegistryMetaSchema.parse(meta);
      expect(parsed.registryId).toBe(registryId);
      expect(parsed.version).toMatch(SEMVER_PATTERN);
      expect(parsed.changelog.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('meta.version 必须等于 changelog 最后一条的 version', () => {
    for (const { meta } of metaByRegistryId) {
      expect(meta.changelog[meta.changelog.length - 1]?.version).toBe(meta.version);
    }
  });

  it('changelog 条目含 version/date/changes 且 date 为 YYYY-MM-DD', () => {
    for (const { meta } of metaByRegistryId) {
      for (const entry of meta.changelog) {
        expect(entry.version).toMatch(SEMVER_PATTERN);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.changes.length).toBeGreaterThan(0);
      }
    }
  });

  it('AgentRegistryMetaSchema 拒绝 version 与 changelog 末条不一致的 meta', () => {
    expect(() =>
      AgentRegistryMetaSchema.parse({
        registryId: 'agent-metric',
        version: '2.0.0',
        changelog: [{ version: '1.0.0', date: '2026-06-11', changes: '初版' }],
      })
    ).toThrow();
  });
});

describe('audit 响应暴露表级注册表版本', () => {
  it('metric audit 暴露 agent-metric 与 agent-forecast-output 的表级版本', () => {
    const audit = getAgentMetricAudit();
    const versions = AgentRegistryVersionSchema.array().parse(audit.registryVersions);
    const byId = new Map(versions.map((item) => [item.registryId, item]));

    expect(byId.get('agent-metric')?.version).toBe(agentMetricRegistryMeta.version);
    expect(byId.get('agent-metric')?.entryCount).toBe(agentMetricRegistry.length);
    expect(byId.get('agent-forecast-output')?.version).toBe(agentForecastOutputRegistryMeta.version);
    expect(byId.get('agent-forecast-output')?.entryCount).toBe(agentForecastOutputRegistry.length);
  });

  it('capability audit 暴露 agent-data-capability 的表级版本', () => {
    const audit = getAgentCapabilityAudit();
    const versions = AgentRegistryVersionSchema.array().parse(audit.registryVersions);

    expect(versions).toHaveLength(1);
    expect(versions[0]?.registryId).toBe('agent-data-capability');
    expect(versions[0]?.version).toBe(agentDataCapabilityRegistryMeta.version);
    expect(versions[0]?.entryCount).toBe(agentDataCapabilityRegistry.length);
  });

  it('unsupported audit 暴露 unsupported-metric 的表级版本', () => {
    const audit = getUnsupportedMetricAudit();
    const versions = AgentRegistryVersionSchema.array().parse(audit.registryVersions);

    expect(versions).toHaveLength(1);
    expect(versions[0]?.registryId).toBe('unsupported-metric');
    expect(versions[0]?.version).toBe(unsupportedMetricRegistryMeta.version);
    expect(versions[0]?.entryCount).toBe(unsupportedMetricRegistry.length);
  });

  it('readiness audit 汇总全部 4 张注册表的表级版本', async () => {
    const readiness = await getAgentReadinessAudit();
    const versions = AgentRegistryVersionSchema.array().parse(readiness.registryVersions);
    const ids = versions.map((item) => item.registryId).sort();

    expect(ids).toEqual([
      'agent-data-capability',
      'agent-forecast-output',
      'agent-metric',
      'unsupported-metric',
    ]);
  });
});
