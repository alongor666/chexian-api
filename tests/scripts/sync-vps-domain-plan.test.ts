import { describe, expect, it } from 'vitest';

import {
  buildDomainSyncTasks,
  buildSyncTasks,
  parseArgs,
  resolveRunConfig,
  rsyncLatestAtomically,
} from '../../scripts/sync-vps.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

  it('treats missing latest.parquet as sync failure in atomic domain mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-vps-missing-latest-'));
    try {
      await expect(
        rsyncLatestAtomically({ alias: 'unused' }, dir, '/remote/fact/customer_flow', 'fact/customer_flow')
      ).resolves.toMatchObject({
        ok: false,
        label: 'fact/customer_flow',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('governance drift check does not skip unrelated domains for scoped manifests', () => {
    const source = readFileSync('scripts/check-governance.mjs', 'utf-8');
    expect(source).not.toContain('checkedLabels');
  });
});
