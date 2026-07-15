import { describe, expect, it } from 'vitest';
import { agentDataCapabilityRegistry, agentDataCapabilityRegistryMeta } from '../../server/src/agent/registry/agent-data-capability-registry';
import { agentMetricRegistry, agentMetricRegistryMeta } from '../../server/src/agent/registry/agent-metric-registry';
import { agentToolRegistry } from '../../server/src/agent/tools/tool-registry';

describe('销售队伍业绩 Agent 可发现性', () => {
  it('注册 admin-only 数据能力并指向 typed endpoint', () => {
    const capability = agentDataCapabilityRegistry.find((item) => item.id === 'sales_team_performance_analysis');
    expect(capability).toMatchObject({
      supportLevel: 'supported',
      sourceEndpoints: ['/api/query/sales-team-performance'],
      coreMetrics: ['standard_premium', 'received_premium', 'sales_team_row_count'],
    });
    expect(capability?.cautionNotes.join(' ')).toContain('branch_admin');
    expect(agentToolRegistry.find((item) => item.id === 'sales_team_performance.query')).toMatchObject({
      status: 'available',
      endpoint: '/api/query/sales-team-performance',
      capabilityId: 'sales_team_performance_analysis',
    });
    expect(agentDataCapabilityRegistryMeta.version).toBe('1.2.0');
  });

  it('三个指标均有 Agent 口径档案且不混用 PolicyFact 件数', () => {
    const ids = new Set(agentMetricRegistry.map((item) => item.id));
    for (const id of ['standard_premium', 'received_premium', 'sales_team_row_count']) {
      expect(ids.has(id), id).toBe(true);
    }
    const rowCount = agentMetricRegistry.find((item) => item.id === 'sales_team_row_count');
    expect(rowCount?.formula).toBe('COUNT(*)');
    expect(rowCount?.cautionNotes.join(' ')).toContain('不是保单去重件数');
    expect(agentMetricRegistryMeta.version).toBe('1.2.0');
  });
});
