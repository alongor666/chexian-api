import { describe, expect, it } from 'vitest';

import {
  buildDomainSyncTasks,
  buildSyncTasks,
  parseArgs,
  resolveRunConfig,
} from '../../scripts/sync-vps.mjs';

describe('sync-vps domain scoped plan', () => {
  it('parses comma-separated domain args', () => {
    const parsed = parseArgs(['--domain', 'customer_flow,new_energy_claims', '--no-restart']);
    expect(parsed.domains).toEqual(['customer_flow', 'new_energy_claims']);
    expect(parsed.noRestart).toBe(true);
  });

  it('builds only requested full-snapshot sync tasks', () => {
    const tasks = buildDomainSyncTasks('/var/www/chexian/server/data', ['customer_flow']);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      label: 'fact/customer_flow',
      remote: '/var/www/chexian/server/data/fact/customer_flow',
      critical: true,
      atomicLatest: true,
    });
  });

  it('does not include unrelated warehouse dirs in domain mode', () => {
    const runConfig = resolveRunConfig(parseArgs(['--domain=customer_flow', '--dry-run']));
    const tasks = buildSyncTasks(runConfig);
    expect(tasks.map(task => task.label)).toEqual(['fact/customer_flow']);
  });
});
