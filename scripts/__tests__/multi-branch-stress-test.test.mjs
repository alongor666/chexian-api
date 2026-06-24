/**
 * multi-branch-stress-test 串读判定单测（2026-06-24 假阳性修复回归锁）
 *
 * 背景：cutover D5 第 2 步用 `--simulate-sx` 作为放行闸。旧断言用「data 数组长度 > 0」判
 * 「SX 有数据→串读」，但 KPI 等聚合路由被 RLS 过滤到零行后仍返回 1 行全零（数组长度=1），
 * 导致假阳性 CRITICAL。修复改用 realDataCount（含正数业务度量的行数）。本测试锁住：
 *   ① SX 聚合零行（真实 fixture）→ 0，不再误判串读
 *   ② SC 真实聚合行 → 1
 *   ③ 仅计划字段非零（计划维度未省份化）→ 0，不当作 SC 数据泄漏
 *   ④ 真实串读（SX 行含 policy_count>0）→ 仍被计为泄漏，且诊断样本带泄漏字段
 *   ⑤ 列表路由按"有真实数据的行数"统计；空数组/空响应 → 0
 */
import { describe, it, expect } from 'vitest';
import { realDataSignals, countRealDataRows } from '../multi-branch-stress-test.mjs';

// 实测 fixture（来自本地 RLS-on 服务器 /api/query/kpi，2026-06-24）
const SX_EMPTY_KPI_ROW = {
  latest_policy_date: null,
  vehicle_plan_wan: 45116, // ⚠️ 计划字段：SX 也非零（计划维度未省份化），不是 SC 数据泄漏
  vehicle_premium: 0,
  vehicle_achievement_rate: null,
  variable_cost_ratio: null,
  earned_claim_ratio: null,
  driver_premium: 0,
  total_premium: null,
  policy_count: 0,
  org_count: 0,
  salesman_count: 0,
  transfer_rate: null,
};

const SC_REAL_KPI_ROW = {
  latest_policy_date: '2026-05-11',
  vehicle_plan_wan: 45116,
  vehicle_premium: 170345990.7,
  total_premium: 170345990.7,
  policy_count: 225188,
  org_count: 14,
  salesman_count: 268,
};

describe('realDataSignals', () => {
  it('SX 聚合零行（仅计划字段非零）→ 无真实数据信号', () => {
    expect(realDataSignals(SX_EMPTY_KPI_ROW)).toEqual([]);
  });

  it('SC 真实聚合行 → 含多个业务度量信号', () => {
    const sig = realDataSignals(SC_REAL_KPI_ROW);
    const fields = sig.map((s) => s.field);
    expect(fields).toContain('policy_count');
    expect(fields).toContain('total_premium');
    expect(fields).toContain('org_count');
    // 计划/比率字段不应作为信号
    expect(fields).not.toContain('vehicle_plan_wan');
  });

  it('计划字段非零、业务度量全零 → 不算数据（防计划维度未省份化误判）', () => {
    expect(realDataSignals({ vehicle_plan_wan: 99999, policy_count: 0, total_premium: null })).toEqual([]);
  });

  it('null / 非对象处理', () => {
    expect(realDataSignals(null)).toEqual([]);
    expect(realDataSignals(undefined)).toEqual([]);
    expect(realDataSignals('某标签')).toEqual([{ field: '(value)', value: 1 }]); // 原始值列表项=一条数据
  });

  it('未知形状对象（无已知度量字段、非空）→ 保守判为有数据（宁可误报不漏真串读）', () => {
    expect(realDataSignals({ foo: 'bar' })).toEqual([{ field: '(unknown-shape)', value: 1 }]);
  });

  it('负数 / 0 / 非有限值不算正向度量', () => {
    expect(realDataSignals({ policy_count: -1 })).toEqual([]);
    expect(realDataSignals({ premium: 0 })).toEqual([]);
    expect(realDataSignals({ premium: Number.NaN })).toEqual([]);
  });
});

describe('countRealDataRows', () => {
  it('SX 聚合零行响应（数组长度=1 但全零）→ count 0（核心：消除假阳性）', () => {
    const { count } = countRealDataRows({ data: [SX_EMPTY_KPI_ROW] });
    expect(count).toBe(0);
  });

  it('SC 真实聚合响应 → count 1', () => {
    const { count, sample } = countRealDataRows({ data: [SC_REAL_KPI_ROW] });
    expect(count).toBe(1);
    expect(sample.length).toBe(1);
  });

  it('真实串读：SX 响应含 policy_count>0 → 仍计为泄漏，诊断样本带泄漏字段', () => {
    const leaked = { data: [{ policy_count: 225188, total_premium: 170345990.7 }] };
    const { count, sample } = countRealDataRows(leaked);
    expect(count).toBe(1);
    const fields = sample[0].map((s) => s.field);
    expect(fields).toContain('policy_count');
  });

  it('列表路由：按含真实数据的行数统计', () => {
    const trend = {
      data: [
        { date: '2026-01-01', premium: 1000, policy_count: 3 },
        { date: '2026-01-02', premium: 0, policy_count: 0 }, // 零行不计
        { date: '2026-01-03', premium: 2000, policy_count: 5 },
      ],
    };
    expect(countRealDataRows(trend).count).toBe(2);
  });

  it('空数组 / 空响应 / 无 data → count 0', () => {
    expect(countRealDataRows({ data: [] }).count).toBe(0);
    expect(countRealDataRows({ data: null }).count).toBe(0);
    expect(countRealDataRows({}).count).toBe(0);
    expect(countRealDataRows(undefined).count).toBe(0);
  });

  it('sample 最多取 3 行', () => {
    const many = { data: Array.from({ length: 10 }, () => ({ policy_count: 5 })) };
    const { count, sample } = countRealDataRows(many);
    expect(count).toBe(10);
    expect(sample.length).toBe(3);
  });
});
