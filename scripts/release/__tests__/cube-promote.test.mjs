/**
 * cube-promote.mjs 单元测试
 *
 * 测试范围（PR #644 review fix 改造）：
 *   - detectSwitches / detectPhase / buildVerdict — import 真函数自 lib
 *   - checkBuildHealth / checkShadowSampleFloor — 新加入测试覆盖
 *   - fetchSentinelHistory — import 真函数 + vi.stubGlobal('fetch') 拦截
 *
 * 改造（删除 inline 复现，import 真函数）：
 *   原 inline 副本的 buildVerdict 是旧版本（total=0 → canAdvance=true），
 *   与生产已升级版本（PR #644 改为 canAdvance=false 阻断）静默漂移。
 *   抽 lib + import 后测试自动追上脚本本体。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_MATCH_FLOOR,
  detectSwitches,
  detectPhase,
  checkBuildHealth,
  checkShadowSampleFloor,
  fetchSentinelHistory,
  buildVerdict,
} from '../lib/cube-promote-judge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__');

// GH 评论严重度 regex（fetchSentinelHistory 内一致，独立暴露便于测试解析契约）
function parseSeverityFromComment(body) {
  return /严重度.*?`(CRITICAL|WARN|INFO|NONE)`/.exec(body)?.[1] ?? null;
}

// 旧 buildVerdict 测试无 healthData 参数，统一传 skipped 模拟 --no-health
const SKIPPED_HEALTH = { skipped: true };

// 健康+样本充足的 healthData（用于"可推进"路径测试）
const HEALTHY_HEALTH = {
  cubes: {
    trend: { builtVersion: 'v1', lastError: null },
    cost: { builtVersion: 'v1', lastError: null },
    salesman: { builtVersion: 'v1', lastError: null },
  },
  cubeShadow: {
    trend: { match: 1200, mismatch: 0, error: 0 },
    growth: { match: 1100, mismatch: 0, error: 0 },
    cost: { match: 1300, mismatch: 0, error: 0 },
    kpi: { match: 1500, mismatch: 0, error: 0 },
    'salesman-ranking': { match: 1000, mismatch: 0, error: 0 },
  },
  buildHealthResult: { pass: true, failedCubes: [] },
  sampleFloorResult: {
    pass: true,
    routeFloors: {
      trend: { match: 1200, target: 1000, pass: true },
      growth: { match: 1100, target: 1000, pass: true },
      cost: { match: 1300, target: 1000, pass: true },
      kpi: { match: 1500, target: 1000, pass: true },
      'salesman-ranking': { match: 1000, target: 1000, pass: true },
    },
  },
};

// ─── detectSwitches 测试 ─────────────────────────────────────────────────────

describe('detectSwitches — ecosystem 文本解析', () => {
  it('阶段 0 fixture：两开关均解析为 false', () => {
    const src = readFileSync(join(FIXTURE_DIR, 'ecosystem-phase0.cjs'), 'utf-8');
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(false);
    expect(routing).toBe(false);
  });

  it('阶段 1 fixture：shadow=true, routing=false', () => {
    const src = readFileSync(join(FIXTURE_DIR, 'ecosystem-phase1.cjs'), 'utf-8');
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(true);
    expect(routing).toBe(false);
  });

  it('阶段 2 fixture：shadow=true, routing=true', () => {
    const src = readFileSync(join(FIXTURE_DIR, 'ecosystem-phase2.cjs'), 'utf-8');
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(true);
    expect(routing).toBe(true);
  });

  it('非法状态 fixture：shadow=false, routing=true → routing 仍解析为 true', () => {
    const src = readFileSync(join(FIXTURE_DIR, 'ecosystem-illegal.cjs'), 'utf-8');
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(false);
    expect(routing).toBe(true);
  });

  it('CRLF 行尾：\\r\\n 不影响解析结果', () => {
    const src = "env: {\r\n  CUBE_SHADOW_COMPARE: 'true',\r\n  CUBE_ROUTING_ENABLED: 'false',\r\n}\r\n";
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(true);
    expect(routing).toBe(false);
  });

  it('注释行含 CUBE_SHADOW_COMPARE: true、实际行设 false → 剥离注释后取真值行 false（f9af68：注释不再误判）', () => {
    // 修复前：detectSwitches 全文 regex 会命中注释里的 'true' → 误报 true。
    // 修复后：先逐行剥离 `//` 注释，只认真值行 CUBE_SHADOW_COMPARE: 'false'。
    const src = `env: {
  // CUBE_SHADOW_COMPARE: 'true', // 曾用过
  CUBE_SHADOW_COMPARE: 'false',
  CUBE_ROUTING_ENABLED: 'false',
}`;
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(false);
    expect(routing).toBe(false);
  });

  it("真实 ecosystem 注释『改 CUBE_ROUTING_ENABLED: 'true' 切流』不被误判为已切流（阶段1而非阶段2·f9af68 生产复现）", () => {
    // 复现 server/ecosystem.config.cjs 的验收注释致 cube-promote 误报 phase 2/routing=true 的生产 bug。
    const src = `env: {
  // 验收（设计文档 §4 阶段 1）：连续 7 天 mismatch=0 → 改 CUBE_ROUTING_ENABLED: 'true' 切流。
  CUBE_SHADOW_COMPARE: 'true',
}`;
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(true);
    expect(routing).toBe(false);
  });

  it('变量值周围有多余空白：CUBE_SHADOW_COMPARE:   "true" → 正常解析', () => {
    const src = `env: { CUBE_SHADOW_COMPARE:   "true", CUBE_ROUTING_ENABLED: 'false' }`;
    const { shadow } = detectSwitches(src);
    expect(shadow).toBe(true);
  });

  it('双引号值：CUBE_SHADOW_COMPARE: "true" → shadow=true', () => {
    const src = `env: { CUBE_SHADOW_COMPARE: "true", CUBE_ROUTING_ENABLED: "false" }`;
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(true);
    expect(routing).toBe(false);
  });

  it('两开关均缺失：不含这两个键 → 均返回 false（不报错）', () => {
    const src = `env: { NODE_ENV: 'production' }`;
    const { shadow, routing } = detectSwitches(src);
    expect(shadow).toBe(false);
    expect(routing).toBe(false);
  });
});

// ─── detectPhase 测试 ────────────────────────────────────────────────────────

describe('detectPhase — 阶段判定矩阵', () => {
  it('shadow=false, routing=false → 阶段 0', () => {
    expect(detectPhase({ shadow: false, routing: false })).toBe(0);
  });

  it('shadow=true, routing=false → 阶段 1（影子对账）', () => {
    expect(detectPhase({ shadow: true, routing: false })).toBe(1);
  });

  it('shadow=true, routing=true → 阶段 2（正式切流）', () => {
    expect(detectPhase({ shadow: true, routing: true })).toBe(2);
  });

  it('shadow=false, routing=true → 非法态，等同阶段 0 处理（返回 0）', () => {
    expect(detectPhase({ shadow: false, routing: true })).toBe(0);
  });
});

// ─── buildVerdict 决策矩阵测试 ───────────────────────────────────────────────

describe('buildVerdict — 推进决策矩阵（含 healthData 路径，PR #644 review fix）', () => {
  it('阶段 0 → canAdvance=true，nextAction 含"CUBE_SHADOW_COMPARE"', () => {
    const v = buildVerdict({
      phase: 0,
      switches: { shadow: false, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 } },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(true);
    expect(v.nextAction).toMatch(/CUBE_SHADOW_COMPARE/);
    expect(v.blockers).toHaveLength(0);
  });

  it('阶段 1 + 哨兵不可读（无 GH token）→ canAdvance=false，blockers 含提示', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: false, reason: '未提供 GH_TOKEN / GITHUB_TOKEN' },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.blockers.length).toBeGreaterThan(0);
    expect(v.blockers[0]).toMatch(/GH_TOKEN/);
  });

  it('阶段 1 + CRITICAL=1 → canAdvance=false，blockers 含 CRITICAL 次数', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 1, warn: 0, info: 0, total: 1 } },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.blockers[0]).toMatch(/CRITICAL/);
  });

  it('阶段 1 + CRITICAL=3 → canAdvance=false，summary 含 3', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 3, warn: 1, info: 0, total: 4 } },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.summary).toContain('3');
  });

  // PR #644 已修：total=0 → canAdvance=false 阻断（之前是 true 静默放行）
  it('阶段 1 + total=0（哨兵无评论）→ canAdvance=false（PR #644 已修静默放行）', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 } },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.nextAction).toMatch(/burn-in|样本/);
    expect(v.blockers.some((b) => /样本下限/.test(b))).toBe(true);
  });

  it('阶段 1 + WARN=2 INFO=1 CRITICAL=0 + 健康通过 → canAdvance=true', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 2, info: 1, total: 3 } },
      healthData: HEALTHY_HEALTH,
    });
    expect(v.canAdvance).toBe(true);
    expect(v.nextAction).toMatch(/CUBE_ROUTING_ENABLED/);
    expect(v.blockers).toHaveLength(0);
  });

  it('阶段 2 → canAdvance=false，summary 含"正式切流"', () => {
    const v = buildVerdict({
      phase: 2,
      switches: { shadow: true, routing: true },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 } },
      healthData: SKIPPED_HEALTH,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.summary).toContain('正式切流');
  });

  // 健康检查路径 — PR #644 新增的实际覆盖
  it('阶段 1 + healthData=null（/health 不可达）→ canAdvance=false + health_unreachable=true', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 3 } },
      healthData: null,
    });
    expect(v.canAdvance).toBe(false);
    expect(v.health_unreachable).toBe(true);
  });

  it('阶段 1 + cost.lastError → canAdvance=false，blockers 含立方体构建失败', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 3 } },
      healthData: {
        cubes: { trend: { builtVersion: 'v1', lastError: null }, cost: { builtVersion: null, lastError: 'OOM' }, salesman: { builtVersion: 'v1', lastError: null } },
        cubeShadow: HEALTHY_HEALTH.cubeShadow,
        buildHealthResult: { pass: false, failedCubes: ['cost（lastError: OOM）'] },
        sampleFloorResult: HEALTHY_HEALTH.sampleFloorResult,
      },
    });
    expect(v.canAdvance).toBe(false);
    expect(v.blockers.some((b) => /立方体构建失败/.test(b))).toBe(true);
    expect(v.blockers.some((b) => /cost/.test(b))).toBe(true);
  });

  it('阶段 1 + kpi.match=0（样本不足）→ canAdvance=false，blockers 含样本不足', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 3 } },
      healthData: {
        cubes: HEALTHY_HEALTH.cubes,
        cubeShadow: { ...HEALTHY_HEALTH.cubeShadow, kpi: { match: 0, mismatch: 0, error: 0 } },
        buildHealthResult: { pass: true, failedCubes: [] },
        sampleFloorResult: {
          pass: false,
          routeFloors: { ...HEALTHY_HEALTH.sampleFloorResult.routeFloors, kpi: { match: 0, target: 1000, pass: false } },
        },
      },
    });
    expect(v.canAdvance).toBe(false);
    expect(v.blockers.some((b) => /样本不足/.test(b))).toBe(true);
    expect(v.blockers.some((b) => /kpi/.test(b))).toBe(true);
  });

  it('matchFloor 参数注入 message：blockers 提示文本随 matchFloor 变化', () => {
    const v = buildVerdict({
      phase: 1,
      switches: { shadow: true, routing: false },
      history: { available: true, counts: { critical: 0, warn: 0, info: 0, total: 0 } },
      healthData: SKIPPED_HEALTH,
      matchFloor: 5000,
    });
    expect(v.blockers.some((b) => /match ≥ 5000/.test(b))).toBe(true);
  });
});

// ─── checkBuildHealth 测试（新增）────────────────────────────────────────────

describe('checkBuildHealth — 三立方体健康检查', () => {
  it('三立方体全绿 → pass=true', () => {
    const r = checkBuildHealth({
      trend: { builtVersion: 'v1', lastError: null },
      cost: { builtVersion: 'v1', lastError: null },
      salesman: { builtVersion: 'v1', lastError: null },
    });
    expect(r.pass).toBe(true);
    expect(r.failedCubes).toHaveLength(0);
  });

  it('cost.lastError != null → pass=false，failedCubes 含 cost', () => {
    const r = checkBuildHealth({
      trend: { builtVersion: 'v1', lastError: null },
      cost: { builtVersion: 'v1', lastError: 'OOM Error' },
      salesman: { builtVersion: 'v1', lastError: null },
    });
    expect(r.pass).toBe(false);
    expect(r.failedCubes[0]).toMatch(/cost/);
    expect(r.failedCubes[0]).toMatch(/OOM/);
  });

  it('trend.builtVersion=null → pass=false', () => {
    const r = checkBuildHealth({
      trend: { builtVersion: null, lastError: null },
      cost: { builtVersion: 'v1', lastError: null },
      salesman: { builtVersion: 'v1', lastError: null },
    });
    expect(r.pass).toBe(false);
    expect(r.failedCubes[0]).toMatch(/trend/);
    expect(r.failedCubes[0]).toMatch(/builtVersion 为空/);
  });

  it('salesman 状态缺失 → pass=false', () => {
    const r = checkBuildHealth({
      trend: { builtVersion: 'v1', lastError: null },
      cost: { builtVersion: 'v1', lastError: null },
    });
    expect(r.pass).toBe(false);
    expect(r.failedCubes[0]).toMatch(/salesman/);
    expect(r.failedCubes[0]).toMatch(/状态缺失/);
  });
});

// ─── checkShadowSampleFloor 测试（新增）─────────────────────────────────────

describe('checkShadowSampleFloor — 5 路由样本下限', () => {
  it('5 路由 match 全 ≥ 1000 → pass=true', () => {
    const r = checkShadowSampleFloor({
      trend: { match: 1200 },
      growth: { match: 1100 },
      cost: { match: 1500 },
      kpi: { match: 2000 },
      'salesman-ranking': { match: 1000 },
    });
    expect(r.pass).toBe(true);
    expect(Object.values(r.routeFloors).every((v) => v.pass)).toBe(true);
  });

  it('kpi.match=0 → pass=false，routeFloors.kpi.pass=false', () => {
    const r = checkShadowSampleFloor({
      trend: { match: 1200 },
      growth: { match: 1100 },
      cost: { match: 1500 },
      kpi: { match: 0 },
      'salesman-ranking': { match: 1000 },
    });
    expect(r.pass).toBe(false);
    expect(r.routeFloors.kpi.pass).toBe(false);
    expect(r.routeFloors.trend.pass).toBe(true);
  });

  it('边界值 match=DEFAULT_MATCH_FLOOR → pass=true', () => {
    const r = checkShadowSampleFloor({
      trend: { match: DEFAULT_MATCH_FLOOR },
      growth: { match: DEFAULT_MATCH_FLOOR },
      cost: { match: DEFAULT_MATCH_FLOOR },
      kpi: { match: DEFAULT_MATCH_FLOOR },
      'salesman-ranking': { match: DEFAULT_MATCH_FLOOR },
    });
    expect(r.pass).toBe(true);
  });

  it('边界值 match=DEFAULT_MATCH_FLOOR-1 → pass=false', () => {
    const r = checkShadowSampleFloor({
      trend: { match: DEFAULT_MATCH_FLOOR - 1 },
      growth: { match: 1100 },
      cost: { match: 1100 },
      kpi: { match: 1100 },
      'salesman-ranking': { match: 1100 },
    });
    expect(r.pass).toBe(false);
    expect(r.routeFloors.trend.pass).toBe(false);
  });

  it('match 字段缺失 → 视为 0，pass=false', () => {
    const r = checkShadowSampleFloor({
      trend: {},
      growth: { match: 1100 },
      cost: { match: 1100 },
      kpi: { match: 1100 },
      'salesman-ranking': { match: 1100 },
    });
    expect(r.pass).toBe(false);
    expect(r.routeFloors.trend.match).toBe(0);
  });

  it('matchFloor=500 自定义阈值 → match=500 → pass=true（覆盖 env 派生）', () => {
    const r = checkShadowSampleFloor(
      { trend: { match: 500 }, growth: { match: 500 }, cost: { match: 500 }, kpi: { match: 500 }, 'salesman-ranking': { match: 500 } },
      500,
    );
    expect(r.pass).toBe(true);
  });
});

// ─── GH 评论严重度 regex 契约测试 ───────────────────────────────────────────

describe('GH 评论严重度 regex 解析契约', () => {
  // 标准评论体格式验证（哨兵写入、cube-promote 读取的契约）
  it('评论含 **严重度**：`CRITICAL` → 解析出 CRITICAL', () => {
    const body = '**严重度**：`CRITICAL`\n路由 kpi 影子对账出现 3 次差异';
    expect(parseSeverityFromComment(body)).toBe('CRITICAL');
  });

  it('评论含 **严重度**：`WARN` → 解析出 WARN', () => {
    const body = '立方体构建失败\n**严重度**：`WARN`';
    expect(parseSeverityFromComment(body)).toBe('WARN');
  });

  it('评论含 **严重度**：`INFO` → 解析出 INFO', () => {
    const body = '## 立方体哨兵报告\n**严重度**：`INFO`\n跨格保单信号';
    expect(parseSeverityFromComment(body)).toBe('INFO');
  });

  it('评论含 **严重度**：`NONE` → 解析出 NONE', () => {
    const body = '**严重度**：`NONE`\n全部健康';
    expect(parseSeverityFromComment(body)).toBe('NONE');
  });

  it('评论不含严重度标记 → 返回 null', () => {
    const body = '普通 PR 评论，没有严重度字段';
    expect(parseSeverityFromComment(body)).toBeNull();
  });

  it('评论严重度前有其他内容（时间/数字）→ 仍能正确解析', () => {
    const body = `## 立方体灰度哨兵报告 (2026-06-14T10:00:00Z)
- **时间**：2026-06-14T10:00:00Z
- **总体状态**：❌ CRITICAL（2 条）
**严重度**：\`CRITICAL\``;
    expect(parseSeverityFromComment(body)).toBe('CRITICAL');
  });

  it('评论中严重度出现多次（多轮更新）→ 匹配第一次出现', () => {
    const body = '**严重度**：`WARN`\n……追加评论……**严重度**：`CRITICAL`';
    // regex 非贪婪，匹配第一次
    expect(parseSeverityFromComment(body)).toBe('WARN');
  });
});

// ─── fetchSentinelHistory 评论计数聚合（通过 mock fetch 验证）─────────────────

describe('fetchSentinelHistory — 评论计数聚合', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // fetchSentinelHistory 改为 import 真函数，删除 inline 复现（PR #644 review fix）

  it('GH API 返回 3 条评论（1 CRITICAL+1 WARN+1 INFO）→ 正确计数', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { body: '**严重度**：`CRITICAL`\n路由 kpi mismatch=3', created_at: '2026-06-08T01:00:00Z' },
        { body: '**严重度**：`WARN`\n立方体构建失败', created_at: '2026-06-09T01:00:00Z' },
        { body: '**严重度**：`INFO`\n跨格保单信号', created_at: '2026-06-10T01:00:00Z' },
      ],
    });
    const result = await fetchSentinelHistory({ ghToken: 'tok', repo: 'r/r', historyIssue: 99 });
    expect(result.available).toBe(true);
    expect(result.counts.critical).toBe(1);
    expect(result.counts.warn).toBe(1);
    expect(result.counts.info).toBe(1);
    expect(result.counts.total).toBe(3);
  });

  it('GH API 返回空数组（7 天内无评论）→ total=0, available=true', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await fetchSentinelHistory({ ghToken: 'tok', repo: 'r/r', historyIssue: 99 });
    expect(result.available).toBe(true);
    expect(result.counts.total).toBe(0);
    expect(result.counts.critical).toBe(0);
  });

  it('GH API 返回 401 → available=false，reason 含 HTTP 状态码', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const result = await fetchSentinelHistory({ ghToken: 'bad-token', repo: 'r/r', historyIssue: 99 });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/401/);
  });

  it('未指定 historyIssue → available=false，reason 含"未指定"', async () => {
    const result = await fetchSentinelHistory({ ghToken: 'tok', repo: 'r/r', historyIssue: null });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/未指定/);
  });

  it('未提供 ghToken → available=false，reason 含"GH_TOKEN"', async () => {
    const result = await fetchSentinelHistory({ ghToken: '', repo: 'r/r', historyIssue: 99 });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/GH_TOKEN/);
  });

  it('评论体无严重度标记 → 计入 unknown，不影响 critical/warn/info 计数', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { body: '普通评论，no severity', created_at: '2026-06-10T01:00:00Z' },
        { body: '**严重度**：`WARN`\n已知问题', created_at: '2026-06-11T01:00:00Z' },
      ],
    });
    const result = await fetchSentinelHistory({ ghToken: 'tok', repo: 'r/r', historyIssue: 99 });
    expect(result.counts.total).toBe(2);
    expect(result.counts.warn).toBe(1);
    expect(result.counts.critical).toBe(0);
    // unknown 条目出现在 latest 里
    const unknownEntry = result.latest.find((e) => e.severity === 'unknown');
    expect(unknownEntry).toBeTruthy();
  });
});
