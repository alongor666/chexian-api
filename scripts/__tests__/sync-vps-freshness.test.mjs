/**
 * sync-vps 完整性闸门决策逻辑单测
 *
 * 锁定 evaluateFreshness 行为：本地 policy 数据比 VPS 现役更旧/更少 → block，
 * 防 parquet 不全的机器把残缺数据覆盖到生产。
 */
import { describe, expect, it } from 'vitest';
import { evaluateFreshness, buildSyncTasks } from '../sync-vps.mjs';

const vps = { maxDate: '2026-05-30', rowCount: 1_000_000 };

describe('evaluateFreshness', () => {
  it('本地与现役一致 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, vps).verdict).toBe('pass');
  });

  it('本地更新更多 → pass', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-31', rowCount: 1_000_100 }, vps).verdict).toBe('pass');
  });

  it('本地日期更旧 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 1_000_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
  });

  it('本地行数更少 → block', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-30', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('行数');
  });

  it('日期与行数同时倒退 → block，原因含两条', () => {
    const r = evaluateFreshness({ maxDate: '2026-05-20', rowCount: 400_000 }, vps);
    expect(r.verdict).toBe('block');
    expect(r.reason).toContain('maxDate');
    expect(r.reason).toContain('行数');
  });

  it('VPS 指纹不可用（端点未部署）→ skip 降级放行', () => {
    expect(evaluateFreshness({ maxDate: '2026-05-30', rowCount: 1_000_000 }, null).verdict).toBe('skip');
  });

  it('本地指纹不可用（duckdb CLI 缺失）→ skip 降级放行', () => {
    expect(evaluateFreshness(null, vps).verdict).toBe('skip');
  });

  it('一侧 maxDate 为 null 时不据日期 block，仅看行数', () => {
    // 现役 maxDate 缺失（如刚启动未查到）但行数完整 → 不应误 block
    expect(evaluateFreshness({ maxDate: null, rowCount: 1_000_000 }, { maxDate: null, rowCount: 1_000_000 }).verdict).toBe('pass');
  });
});

// policy 完整性闸门只该在本次确实同步 policy/current 时执行：
// --domain 模式只传对应 fact 域 latest.parquet，不含 policy，不应被 policy 新鲜度阻断。
describe('闸门执行范围（buildSyncTasks 是否含 policy/current）', () => {
  const cfg = (domains) => ({ domains, remoteDir: '/r', frontendDistDir: '/f' });

  it('标准全量同步 → 含 policy/current（闸门生效）', () => {
    expect(buildSyncTasks(cfg([])).some((t) => t.label === 'policy/current')).toBe(true);
  });

  it('--domain customer_flow → 不含 policy/current（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['customer_flow'])).some((t) => t.label === 'policy/current')).toBe(false);
  });

  it('--domain new_energy_claims → 不含 policy/current（闸门跳过）', () => {
    expect(buildSyncTasks(cfg(['new_energy_claims'])).some((t) => t.label === 'policy/current')).toBe(false);
  });
});
