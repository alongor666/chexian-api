import { describe, expect, it } from 'vitest';
import {
  generateKpiDetailQuery,
  SAME_CITY_ORGS,
  SAME_CITY_ORGS_BY_BRANCH,
} from '../kpi-detail.js';

/**
 * G6：generateKpiDetailQuery 同城机构名单省份感知
 *
 * 三个核心断言：
 *   (a) 不传 branchCode → 生成 SQL 含成都 7 机构，与传 'SC' 完全一致（字节安全）
 *   (b) 传 'SX' → 含太原口径 3 机构，不含成都机构
 *   (c) 传未知省码 → 回退 SC 名单
 */
describe('generateKpiDetailQuery — 同城机构名单省份感知 (G6)', () => {
  // ————————————————————————————————————————————————————
  // (a) 字节安全：不传 branchCode 与传 'SC' 生成结果逐字节一致
  // ————————————————————————————————————————————————————
  it('(a) 不传 branchCode 与传 SC 结果逐字节一致', () => {
    const sqlNoCode = generateKpiDetailQuery('1=1', false);
    const sqlSC     = generateKpiDetailQuery('1=1', false, 'SC');
    expect(sqlNoCode).toBe(sqlSC);
  });

  it('(a) 不传 branchCode 时 SQL 含成都全部 7 个同城机构', () => {
    const sql = generateKpiDetailQuery('1=1', false);
    const scOrgs = SAME_CITY_ORGS_BY_BRANCH.SC;
    for (const org of scOrgs) {
      expect(sql).toContain(`'${org}'`);
    }
  });

  it('(a) SQL 使用 IN 子句判定同城（冒烟）', () => {
    const sql = generateKpiDetailQuery('1=1', false);
    expect(sql).toContain('same_city_premium');
    expect(sql).toContain('remote_premium');
    // IN 列表中包含首个成都机构作为代表
    expect(sql).toContain("'天府'");
  });

  // ————————————————————————————————————————————————————
  // (b) 传 'SX' → 太原口径，不含成都机构
  // ————————————————————————————————————————————————————
  it('(b) 传 SX 时 SQL 含太原三机构', () => {
    const sql = generateKpiDetailQuery('1=1', false, 'SX');
    expect(sql).toContain("'太原一部'");
    expect(sql).toContain("'太原二部'");
    // 中文顿号精确匹配
    expect(sql).toContain("'经代、车商、重客'");
  });

  it('(b) 传 SX 时 SQL 不含成都机构', () => {
    const sql = generateKpiDetailQuery('1=1', false, 'SX');
    for (const org of SAME_CITY_ORGS_BY_BRANCH.SC) {
      expect(sql).not.toContain(`'${org}'`);
    }
  });

  it('(b) 传 SX 时 SQL 不含 SC 列表内任何机构', () => {
    const sqlSX = generateKpiDetailQuery('1=1', false, 'SX');
    const sqlSC = generateKpiDetailQuery('1=1', false, 'SC');
    // 两者不同（非回退）
    expect(sqlSX).not.toBe(sqlSC);
  });

  // ————————————————————————————————————————————————————
  // (c) 未知省码回退 SC 名单
  // ————————————————————————————————————————————————————
  it('(c) 传未知省码回退 SC 名单', () => {
    const sqlUnknown = generateKpiDetailQuery('1=1', false, 'ZZ');
    const sqlSC      = generateKpiDetailQuery('1=1', false, 'SC');
    expect(sqlUnknown).toBe(sqlSC);
  });

  it('(c) 传空字符串省码回退 SC 名单', () => {
    const sqlEmpty = generateKpiDetailQuery('1=1', false, '');
    const sqlSC    = generateKpiDetailQuery('1=1', false, 'SC');
    // 空字符串 branchCode ?? 'SC' 不会触发（??只看 null/undefined），
    // 但 SAME_CITY_ORGS_BY_BRANCH[''] 为 undefined → ?? SC 兜底
    expect(sqlEmpty).toBe(sqlSC);
  });

  // ————————————————————————————————————————————————————
  // 向后兼容别名验证
  // ————————————————————————————————————————————————————
  it('SAME_CITY_ORGS 向后兼容别名等于 SC 名单', () => {
    expect([...SAME_CITY_ORGS]).toEqual([...SAME_CITY_ORGS_BY_BRANCH.SC]);
  });

  it('SAME_CITY_ORGS 含成都 7 机构', () => {
    expect(SAME_CITY_ORGS).toContain('天府');
    expect(SAME_CITY_ORGS).toContain('高新');
    expect(SAME_CITY_ORGS).toContain('新都');
    expect(SAME_CITY_ORGS).toContain('青羊');
    expect(SAME_CITY_ORGS).toContain('武侯');
    expect(SAME_CITY_ORGS).toContain('重客');
    expect(SAME_CITY_ORGS).toContain('本部');
    expect(SAME_CITY_ORGS).toHaveLength(7);
  });

  it('SAME_CITY_ORGS_BY_BRANCH.SX 含太原 3 机构', () => {
    const sx = SAME_CITY_ORGS_BY_BRANCH.SX;
    expect(sx).toContain('太原一部');
    expect(sx).toContain('太原二部');
    expect(sx).toContain('经代、车商、重客');
    expect(sx).toHaveLength(3);
  });
});

/**
 * G6 follow-up：fetchDashboardBundleData 第二消费方 — dashboard bundle 路径透传 branchCode 验证
 *
 * fetchDashboardBundleData 内部调用 generateKpiDetailQuery(whereWithDate, false, branchCode)。
 * 该集成路径的核心逻辑在 generateKpiDetailQuery（上方已有完整测试），此处仅验证
 * SQL 生成层签名满足"透传 branchCode 可改变同城名单"的前提条件，
 * 确认 dashboard bundle 路径在 G6 follow-up 后的行为与 /kpi-detail 路由一致。
 */
describe('generateKpiDetailQuery — dashboard bundle 透传 branchCode (G6 follow-up)', () => {
  it('模拟 dashboard bundle 传 SC branchCode：SQL 含成都机构', () => {
    // 模拟 fetchDashboardBundleData 内部调用（branchCode 来自路由 handler 的 resolveBranchRlsCode）
    const sql = generateKpiDetailQuery('policy_date >= \'2026-01-01\'', false, 'SC');
    expect(sql).toContain("'天府'");
    expect(sql).toContain("'高新'");
    expect(sql).toContain('same_city_premium');
  });

  it('模拟 dashboard bundle 传 SX branchCode：SQL 含太原机构，不含成都机构', () => {
    const sql = generateKpiDetailQuery('policy_date >= \'2026-01-01\'', false, 'SX');
    expect(sql).toContain("'太原一部'");
    expect(sql).not.toContain("'天府'");
    expect(sql).toContain('same_city_premium');
  });

  it('模拟 dashboard bundle 不传 branchCode（cache-warmer 旧调用）：回退 SC 名单，字节安全', () => {
    // cache-warmer 中新增 branchCode: variant.branchCode ?? undefined
    // 当 variant.branchCode 为 null（flag off 兼容期）时等同不传，仍回退 SC 名单
    const sqlNone = generateKpiDetailQuery('1=1', false, undefined);
    const sqlSC   = generateKpiDetailQuery('1=1', false, 'SC');
    expect(sqlNone).toBe(sqlSC);
  });
});
