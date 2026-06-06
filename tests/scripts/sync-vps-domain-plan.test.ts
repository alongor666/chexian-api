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

  it('builds requested full-snapshot sync tasks plus public_reports', () => {
    const tasks = buildDomainSyncTasks('/var/www/chexian/server/data', '/var/www/chexian/frontend/dist', ['customer_flow']);
    // codex P2（PR #511）：domain 模式必须带 public_reports，否则专项发布（sync-and-reload <域>）
    // 后 Stage 1.5 新生成的报告/manifest 推不上去 → 首页报告卡指向旧期。
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      label: 'fact/customer_flow',
      remote: '/var/www/chexian/server/data/fact/customer_flow',
      critical: true,
      atomicLatest: true,
    });
    expect(tasks[1]).toMatchObject({
      label: 'public_reports',
      remote: '/var/www/chexian/frontend/dist/reports',
      deleteRemote: false,
    });
  });

  it('does not include unrelated warehouse dirs in domain mode (but always syncs public_reports)', () => {
    const runConfig = resolveRunConfig(parseArgs(['--domain=customer_flow', '--dry-run']));
    const tasks = buildSyncTasks(runConfig);
    // 只含请求的 fact 域 + public_reports（报告随每次发布刷新，防首页卡过期）；不含其它 warehouse 域
    expect(tasks.map(task => task.label)).toEqual(['fact/customer_flow', 'public_reports']);
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
