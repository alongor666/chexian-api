import { describe, expect, it } from 'vitest';

import {
  buildEtlCommands,
  parseArgs,
  runDataReload,
  resolveFullSnapshotDomains,
} from '../../scripts/sync-and-reload.mjs';

describe('sync-and-reload full_snapshot plan', () => {
  it('识别逗号分隔的 full_snapshot 多域', () => {
    const opts = parseArgs(['customer_flow,new_energy_claims', '--dry-run']);
    expect(resolveFullSnapshotDomains(opts.dailyArgs)).toEqual(['customer_flow', 'new_energy_claims']);
  });

  it('full_snapshot 多域展开为多个单域 ETL，避免 daily.mjs 误走 all/PM2 路径', () => {
    const domains = resolveFullSnapshotDomains(['customer_flow,new_energy_claims']);
    expect(buildEtlCommands(['customer_flow,new_energy_claims'], domains)).toEqual([
      {
        label: 'ETL:customer_flow',
        args: ['数据管理/daily.mjs', 'customer_flow', '--no-sync', '--skip-report'],
      },
      {
        label: 'ETL:new_energy_claims',
        args: ['数据管理/daily.mjs', 'new_energy_claims', '--no-sync', '--skip-report'],
      },
    ]);
  });

  it('普通域仍保持单次 daily.mjs 调用，自动注入 --skip-report 让 sync-and-reload Stage 1.5 独占 period-trend 报告生成', () => {
    expect(buildEtlCommands(['premium'], [])).toEqual([
      {
        label: 'ETL',
        args: ['数据管理/daily.mjs', 'premium', '--no-sync', '--skip-report'],
      },
    ]);
  });

  it('调用方已显式带 --skip-report 时不重复追加', () => {
    expect(buildEtlCommands(['premium', '--skip-report'], [])).toEqual([
      {
        label: 'ETL',
        args: ['数据管理/daily.mjs', 'premium', '--skip-report', '--no-sync'],
      },
    ]);
  });

  it('data reload 网络异常时返回 false，让调用方回退 PM2 reload', async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.ADMIN_RELOAD_TOKEN;
    process.env.ADMIN_RELOAD_TOKEN = 'dummy-token';
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    try {
      await expect(runDataReload(['customer_flow'], {
        dryRun: false,
        healthUrl: 'https://chexian.example/health',
      })).resolves.toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) {
        delete process.env.ADMIN_RELOAD_TOKEN;
      } else {
        process.env.ADMIN_RELOAD_TOKEN = originalToken;
      }
    }
  });
});
