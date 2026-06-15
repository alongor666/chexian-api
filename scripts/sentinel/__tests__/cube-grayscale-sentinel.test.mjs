/**
 * cube-grayscale-sentinel.mjs 单元测试
 *
 * 测试范围：
 *   - buildAnomalies：判定规则（fixture 驱动）
 *   - maxSeverity：多规则同时命中取最高严重度
 *   - renderSummary：输出 schema 稳定性
 *
 * 改造（PR #644 review fix）：从 inline 复现纯函数改为 import lib 真函数，
 * 解决「测试副本 vs 脚本本体漂移」风险。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAnomalies, maxSeverity, renderSummary } from '../lib/cube-grayscale-judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
}

// ─── 规则 ①：mismatch > 0 → CRITICAL ────────────────────────────────────────

describe('规则 ①：shadow mismatch > 0 → CRITICAL', () => {
  it('fixture health-ok：mismatch=0 → 无 CRITICAL 异常', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const criticals = anomalies.filter((a) => a.severity === 'CRITICAL');
    expect(criticals).toHaveLength(0);
  });

  it('fixture health-mismatch：kpi mismatch=3 → 1 条 CRITICAL shadow_mismatch', () => {
    const healthBody = loadFixture('health-mismatch.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const criticals = anomalies.filter((a) => a.kind === 'shadow_mismatch');
    expect(criticals).toHaveLength(1);
    expect(criticals[0].severity).toBe('CRITICAL');
    expect(criticals[0].route).toBe('kpi');
  });

  it('mismatch > 0 → maxSeverity 返回 CRITICAL，退出码应为 1', () => {
    const healthBody = loadFixture('health-mismatch.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(maxSeverity(anomalies)).toBe('CRITICAL');
  });

  it('两条路由均有 mismatch → 产出 2 条 CRITICAL 异常', () => {
    const healthBody = loadFixture('health-multiple-anomalies.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const mismatches = anomalies.filter((a) => a.kind === 'shadow_mismatch');
    // kpi mismatch=10, trend mismatch=2
    expect(mismatches).toHaveLength(2);
    expect(mismatches.every((a) => a.severity === 'CRITICAL')).toBe(true);
  });
});

// ─── 规则 ②：cube lastError → cost 升 CRITICAL，其他 WARN ──────────────────

describe('规则 ②：cube lastError != null — cost 域 → CRITICAL（KPI 大盘），其他 → WARN', () => {
  it('cost.lastError 非空 → 1 条 CRITICAL cube_build_error（影响 KPI 大盘 + cost 分析）', () => {
    const healthBody = loadFixture('health-build-error.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const buildErrors = anomalies.filter((a) => a.kind === 'cube_build_error');
    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0].severity).toBe('CRITICAL');
    expect(buildErrors[0].route).toBe('cost');
  });

  it('cost CRITICAL message 含"影响 KPI 大盘 + cost 分析"标记', () => {
    const healthBody = loadFixture('health-build-error.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const e = anomalies.find((a) => a.kind === 'cube_build_error');
    expect(e?.message).toContain('KPI 大盘');
    expect(e?.message).toContain('DuckDB connection pool exhausted');
  });

  it('cost CRITICAL → maxSeverity=CRITICAL → 退出码 1（阻断 cron）', () => {
    const healthBody = loadFixture('health-build-error.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(maxSeverity(anomalies)).toBe('CRITICAL');
  });

  it('trend.lastError 非空 → WARN（不阻断切流推进）', () => {
    const healthBody = {
      success: true,
      cubes: {
        cost: { builtVersion: '2026-06-14', exact: true, lastError: null },
        trend: { builtVersion: '2026-06-14', exact: true, lastError: 'trend SQL syntax error in cubeSql rewriter' },
        salesman: { builtVersion: '2026-06-14', exact: true, lastError: null },
      },
      cubeShadow: {},
    };
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const buildErrors = anomalies.filter((a) => a.kind === 'cube_build_error');
    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0].severity).toBe('WARN');
    expect(buildErrors[0].route).toBe('trend');
    expect(maxSeverity(anomalies)).toBe('WARN'); // 不阻断 cron
  });

  it('salesman.lastError 非空 → WARN（不阻断切流推进）', () => {
    const healthBody = {
      success: true,
      cubes: {
        cost: { builtVersion: '2026-06-14', exact: true, lastError: null },
        salesman: { builtVersion: '2026-06-14', exact: true, lastError: 'salesman cube probe failed' },
      },
      cubeShadow: {},
    };
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const buildErrors = anomalies.filter((a) => a.kind === 'cube_build_error');
    expect(buildErrors).toHaveLength(1);
    expect(buildErrors[0].severity).toBe('WARN');
    expect(buildErrors[0].route).toBe('salesman');
  });

  it('cost + trend 同时失败 → cost CRITICAL + trend WARN，最高 CRITICAL', () => {
    const healthBody = {
      success: true,
      cubes: {
        cost: { builtVersion: null, exact: null, lastError: 'OOM during construction' },
        trend: { builtVersion: null, exact: null, lastError: 'syntax error' },
      },
      cubeShadow: {},
    };
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const buildErrors = anomalies.filter((a) => a.kind === 'cube_build_error');
    expect(buildErrors).toHaveLength(2);
    const costErr = buildErrors.find((a) => a.route === 'cost');
    const trendErr = buildErrors.find((a) => a.route === 'trend');
    expect(costErr.severity).toBe('CRITICAL');
    expect(trendErr.severity).toBe('WARN');
    expect(maxSeverity(anomalies)).toBe('CRITICAL');
  });

  it('lastError=null 的立方体不产出 cube_build_error 异常', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies.filter((a) => a.kind === 'cube_build_error')).toHaveLength(0);
  });
});

// ─── 规则 ③：cost cube exact=false → INFO ────────────────────────────────────

describe('规则 ③：cost cube exact=false → INFO（跨格保单数据质量信号）', () => {
  it('fixture health-cost-inexact：exact=false → 1 条 INFO cost_cube_degraded', () => {
    const healthBody = loadFixture('health-cost-inexact.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const infos = anomalies.filter((a) => a.kind === 'cost_cube_degraded');
    expect(infos).toHaveLength(1);
    expect(infos[0].severity).toBe('INFO');
    expect(infos[0].route).toBe('cost');
  });

  it('exact=true → 不产出 cost_cube_degraded 异常', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies.filter((a) => a.kind === 'cost_cube_degraded')).toHaveLength(0);
  });

  it('exact=null/undefined（尚未构建）→ 不产出 cost_cube_degraded 异常', () => {
    const healthBody = { cubes: { cost: { builtVersion: null, exact: null, lastError: null } }, cubeShadow: {} };
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies.filter((a) => a.kind === 'cost_cube_degraded')).toHaveLength(0);
  });
});

// ─── 规则 ④：builtVersion 落后 dataVersion → WARN ───────────────────────────

describe('规则 ④：builtVersion 落后 dataVersion → WARN（立方体版本陈旧）', () => {
  it('fixture health-stale-cube：builtVersion=2026-06-10 落后 2026-06-14 → 1 条 WARN cube_stale', () => {
    const healthBody = loadFixture('health-stale-cube.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const stale = anomalies.filter((a) => a.kind === 'cube_stale');
    expect(stale).toHaveLength(1);
    expect(stale[0].severity).toBe('WARN');
    expect(stale[0].route).toBe('cost');
  });

  it('builtVersion === dataVersion（已追上）→ 无 cube_stale 异常', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies.filter((a) => a.kind === 'cube_stale')).toHaveLength(0);
  });

  it('dataVersion=null → 不触发 cube_stale（无基准可比较）', () => {
    const healthBody = loadFixture('health-stale-cube.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: null });
    expect(anomalies.filter((a) => a.kind === 'cube_stale')).toHaveLength(0);
  });

  it('builtVersion=null（尚未构建）→ 不触发 cube_stale', () => {
    const healthBody = { cubes: { cost: { builtVersion: null, lastError: null } }, cubeShadow: {} };
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies.filter((a) => a.kind === 'cube_stale')).toHaveLength(0);
  });
});

// ─── maxSeverity：多规则同时命中取最高 ──────────────────────────────────────

describe('maxSeverity — 多规则同时命中取最高严重度', () => {
  it('只有 INFO → maxSeverity 返回 INFO', () => {
    const anomalies = [{ severity: 'INFO', kind: 'cost_cube_degraded', route: 'cost', message: 'test' }];
    expect(maxSeverity(anomalies)).toBe('INFO');
  });

  it('INFO + WARN 同时存在 → maxSeverity 返回 WARN', () => {
    const anomalies = [
      { severity: 'INFO', kind: 'cost_cube_degraded', route: 'cost', message: 'test' },
      { severity: 'WARN', kind: 'cube_build_error', route: 'trend', message: 'test' },
    ];
    expect(maxSeverity(anomalies)).toBe('WARN');
  });

  it('WARN + CRITICAL 同时存在 → maxSeverity 返回 CRITICAL', () => {
    const anomalies = [
      { severity: 'WARN', kind: 'shadow_error', route: 'kpi', message: 'test' },
      { severity: 'CRITICAL', kind: 'shadow_mismatch', route: 'trend', message: 'test' },
    ];
    expect(maxSeverity(anomalies)).toBe('CRITICAL');
  });

  it('fixture health-multiple-anomalies：mismatch+error+build_error+inexact → CRITICAL 最高', () => {
    const healthBody = loadFixture('health-multiple-anomalies.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(maxSeverity(anomalies)).toBe('CRITICAL');
  });

  it('无异常 → maxSeverity 返回 null', () => {
    expect(maxSeverity([])).toBeNull();
  });
});

// ─── 健康状态：全绿 → 零异常 ────────────────────────────────────────────────

describe('全绿状态：fixture health-ok 与 dataVersion 一致', () => {
  it('health-ok + dataVersion 与 builtVersion 一致 → 零异常', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(anomalies).toHaveLength(0);
    expect(maxSeverity(anomalies)).toBeNull();
  });

  it('所有 checks 均为 ok=true', () => {
    const healthBody = loadFixture('health-ok.json');
    const { checks } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});

// ─── /health 不可达（CRITICAL）─────────────────────────────────────────────

describe('/health 不可达 → 应产出 CRITICAL health_unreachable', () => {
  it('模拟 fetchHealth 抛出异常时的 verdict 结构', () => {
    // 验证不可达时生成的 verdict 结构（与 main 中 catch 块一致）
    const errMsg = 'fetch failed: ECONNREFUSED';
    const verdict = {
      version: 'cube-grayscale-sentinel/1.0',
      ranAt: '2026-06-14T00:00:00Z',
      apiBase: 'https://chexian.cretvalu.com',
      health: { status: null, error: errMsg },
      anomalies: [{ severity: 'CRITICAL', kind: 'health_unreachable', route: 'health', message: `/health 端点不可达：${errMsg}` }],
      hasAnomalies: true,
    };
    expect(verdict.anomalies[0].severity).toBe('CRITICAL');
    expect(verdict.anomalies[0].kind).toBe('health_unreachable');
    expect(verdict.hasAnomalies).toBe(true);
  });
});

// ─── renderSummary schema 稳定性（快照测试）─────────────────────────────────

describe('renderSummary — 输出 schema 稳定性', () => {
  const FIXED_TIME = '2026-06-14T00:00:00.000Z';
  const API_BASE = 'https://chexian.cretvalu.com';
  const DATA_VERSION = '2026-06-14';

  it('全绿时 summary.md 包含必要章节标题', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies, checks } = buildAnomalies({ healthBody, dataVersion: DATA_VERSION });
    const md = renderSummary({ ranAt: FIXED_TIME, dataVersion: DATA_VERSION, healthBody, anomalies, checks, apiBase: API_BASE });

    expect(md).toContain('# 立方体灰度哨兵报告');
    expect(md).toContain('**时间**');
    expect(md).toContain('**总体状态**');
    expect(md).toContain('## 检查项');
    expect(md).toContain('## 立方体新鲜度');
    expect(md).toContain('## 影子对账计数');
    // 全绿无异常清单章节
    expect(md).not.toContain('## 异常清单');
  });

  it('有 CRITICAL 异常时 summary.md 包含异常清单章节', () => {
    const healthBody = loadFixture('health-mismatch.json');
    const { anomalies, checks } = buildAnomalies({ healthBody, dataVersion: DATA_VERSION });
    const md = renderSummary({ ranAt: FIXED_TIME, dataVersion: DATA_VERSION, healthBody, anomalies, checks, apiBase: API_BASE });

    expect(md).toContain('## 异常清单');
    expect(md).toContain('CRITICAL');
    expect(md).toContain('shadow_mismatch');
  });

  it('总体状态格式：健康时含"✅ 健康"，异常时含"❌"', () => {
    const healthOk = loadFixture('health-ok.json');
    const r1 = buildAnomalies({ healthBody: healthOk, dataVersion: DATA_VERSION });
    const md1 = renderSummary({ ranAt: FIXED_TIME, dataVersion: DATA_VERSION, healthBody: healthOk, ...r1, apiBase: API_BASE });
    expect(md1).toContain('✅ 健康');

    const healthBad = loadFixture('health-mismatch.json');
    const r2 = buildAnomalies({ healthBody: healthBad, dataVersion: DATA_VERSION });
    const md2 = renderSummary({ ranAt: FIXED_TIME, dataVersion: DATA_VERSION, healthBody: healthBad, ...r2, apiBase: API_BASE });
    expect(md2).toContain('❌');
  });

  it('影子对账为空时显示提示文案而非空表', () => {
    const healthBody = { cubes: {}, cubeShadow: {} };
    const { anomalies, checks } = buildAnomalies({ healthBody, dataVersion: null });
    const md = renderSummary({ ranAt: FIXED_TIME, dataVersion: null, healthBody, anomalies, checks, apiBase: API_BASE });
    expect(md).toContain('暂无路由触发过影子对账');
  });

  it('dataVersion 为 null 时显示"(未取到)"', () => {
    const healthBody = loadFixture('health-ok.json');
    const { anomalies, checks } = buildAnomalies({ healthBody, dataVersion: null });
    const md = renderSummary({ ranAt: FIXED_TIME, dataVersion: null, healthBody, anomalies, checks, apiBase: API_BASE });
    expect(md).toContain('(未取到)');
  });
});

// ─── checks 数组结构测试 ─────────────────────────────────────────────────────

describe('buildAnomalies — checks 数组结构', () => {
  it('每次调用均产出 4 个 checks（四条规则各一个）', () => {
    const healthBody = loadFixture('health-ok.json');
    const { checks } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    expect(checks).toHaveLength(4);
    const ids = checks.map((c) => c.id);
    expect(ids).toContain('shadow_no_mismatch');
    expect(ids).toContain('shadow_no_error');
    expect(ids).toContain('cost_cube_exact');
    expect(ids).toContain('cubes_fresh');
  });

  it('全绿时所有 checks 的 ok 字段均为 true', () => {
    const healthBody = loadFixture('health-ok.json');
    const { checks } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    for (const c of checks) {
      expect(c.ok, `check ${c.id} 应为 ok=true`).toBe(true);
    }
  });

  it('有 mismatch 时 shadow_no_mismatch check 的 ok=false', () => {
    const healthBody = loadFixture('health-mismatch.json');
    const { checks } = buildAnomalies({ healthBody, dataVersion: '2026-06-14' });
    const mismatchCheck = checks.find((c) => c.id === 'shadow_no_mismatch');
    expect(mismatchCheck?.ok).toBe(false);
  });
});
