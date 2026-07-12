/**
 * ecosystem.config.cjs 重启策略回归锁
 *
 * 背景：2026-07-12 生产 502 RCA（卡 2026-07-12-claude-4d85f8）。
 * 内核升级重启触发 pm2 resurrect，对着部署 npm ci 半装窗口里缺 express 的
 * node_modules 拉起 → 崩溃循环；旧 `max_restarts:5` 让 PM2 崩 5 次后【永久放弃】，
 * 把秒级瞬时故障恶化为持续 502。根治 A = 启用 exp_backoff_restart_delay 无限退避自愈。
 *
 * 本测试锁死该配置不被回归删除。详见 开发文档/reviews/2026-07-12-生产502事故RCA.md §5。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECOSYSTEM_PATH = resolve(__dirname, '../../server/ecosystem.config.cjs');

describe('ecosystem.config.cjs 重启策略（生产 502 RCA 根治 A）', () => {
  it('导出的 app 配置含 exp_backoff_restart_delay（PM2 指数退避自愈，防瞬时崩溃恶化为永久宕机）', async () => {
    const mod = await import(ECOSYSTEM_PATH);
    const config = mod.default ?? mod;
    const app = config.apps?.[0];
    expect(app, 'ecosystem.config.cjs 应导出 apps[0]').toBeTruthy();
    expect(
      app.exp_backoff_restart_delay,
      'exp_backoff_restart_delay 缺失：PM2 会在 max_restarts 后永久放弃，瞬时 node_modules 残缺将恶化为持续 502'
    ).toBeTypeOf('number');
    // 退避基线应为正且不过大（PM2 在此基础上指数增长，上限约 15s）
    expect(app.exp_backoff_restart_delay).toBeGreaterThan(0);
    expect(app.exp_backoff_restart_delay).toBeLessThanOrEqual(1000);
  });

  it('保留 chexian-api 进程名与 dist/app.js 入口（防误改）', async () => {
    const mod = await import(ECOSYSTEM_PATH);
    const config = mod.default ?? mod;
    const app = config.apps?.[0];
    expect(app.name).toBe('chexian-api');
    expect(app.script).toBe('dist/app.js');
  });
});
