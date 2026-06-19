/**
 * 派生域联邦（cx sql 多视图准入 + 每视图 fail-closed RLS）测试。
 *
 * 设计：.claude/plans/cx-cli-swift-pudding.md P0。被测三处：
 *   - config/sql-federation-policy.ts  联邦策略注册表（单一事实源）
 *   - utils/sql-validator.ts            validateRelationBoundary（联邦感知准入）
 *   - utils/sql-permission-injector.ts  injectPermissionIntoAnySql（多视图 RLS 注入）
 *
 * 安全核心（必须验证）：
 *   ① 开关关闭 → 行为与历史一致（仅 PolicyFact，逐字节兼容）。
 *   ② 开关开启 → 联邦白名单视图可达，未登记关系仍拒绝。
 *   ③ RLS fail-closed：过滤条件引用的列若视图缺失 → 抛错拒绝（绝不静默丢弃过滤=越权泄漏）。
 *   ④ exempt 参照表放行但不注入；direct 视图必注入；残留扫描兜底。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { validateSQL } from '../sql-validator.js';
import { injectPermissionIntoAnySql } from '../sql-permission-injector.js';
import {
  isFederationEnabled,
  isRelationAllowed,
  getRelationPolicy,
  getInjectableRelations,
  relationSupportsFilterColumns,
} from '../../config/sql-federation-policy.js';

const FLAG = 'SQL_FEDERATION_ENABLED';
function enableFederation() {
  process.env[FLAG] = 'true';
}
function disableFederation() {
  delete process.env[FLAG];
}
afterEach(disableFederation);

describe('sql-federation-policy 注册表', () => {
  it('默认（开关关闭）：仅 PolicyFact 可达，派生视图全部拒绝', () => {
    disableFederation();
    expect(isFederationEnabled()).toBe(false);
    expect(isRelationAllowed('PolicyFact')).toBe(true);
    expect(isRelationAllowed('RenewalTrackerFact')).toBe(false);
    expect(isRelationAllowed('QuoteConversion')).toBe(false);
    expect(isRelationAllowed('BrandDim')).toBe(false);
    // 关闭态可注入关系仅 PolicyFact
    expect(getInjectableRelations().map((p) => p.canonical)).toEqual(['PolicyFact']);
  });

  it('开关开启：联邦白名单视图可达，未登记关系仍拒绝', () => {
    enableFederation();
    expect(isRelationAllowed('PolicyFact')).toBe(true);
    expect(isRelationAllowed('RenewalTrackerFact')).toBe(true);
    expect(isRelationAllowed('QuoteConversion')).toBe(true);
    expect(isRelationAllowed('CrossSellFact')).toBe(true);
    expect(isRelationAllowed('NewEnergyClaims')).toBe(true);
    expect(isRelationAllowed('BrandDim')).toBe(true); // exempt 也算可达
    // 未登记
    expect(isRelationAllowed('raw_parquet')).toBe(false);
    expect(isRelationAllowed('ClaimsDetail')).toBe(false); // 本增量未纳入（列未实证）
    expect(isRelationAllowed('information_schema.columns')).toBe(false);
  });

  it('开关开启：getInjectableRelations 含 direct 视图、排除 exempt 参照表与未纳入的 RepairDim', () => {
    enableFederation();
    const names = getInjectableRelations().map((p) => p.canonical);
    expect(names).toContain('PolicyFact');
    expect(names).toContain('RenewalTrackerFact');
    expect(names).toContain('QuoteConversion');
    // 真正无机构作用域的参照表才 exempt（不注入）
    expect(names).not.toContain('BrandDim');
    expect(names).not.toContain('PlateRegionMap');
    // RepairDim 含机构敏感数据但 org 列为编码格式，本增量未纳入 → 不在可注入清单
    expect(names).not.toContain('RepairDim');
  });

  it('relationSupportsFilterColumns：列齐备→支持，缺列→不支持', () => {
    enableFederation();
    const renewal = getRelationPolicy('RenewalTrackerFact')!;
    expect(relationSupportsFilterColumns(renewal, ['org_level_3'])).toBe(true);
    expect(relationSupportsFilterColumns(renewal, ['salesman_name'])).toBe(true);
    // RenewalTrackerFact 无 is_telemarketing / branch_code
    expect(relationSupportsFilterColumns(renewal, ['is_telemarketing'])).toBe(false);
    expect(relationSupportsFilterColumns(renewal, ['branch_code'])).toBe(false);
  });
});

describe('validateSQL — 联邦感知访问边界', () => {
  it('开关关闭：FROM RenewalTrackerFact 拒绝（访问边界），报错文案与历史一致', () => {
    disableFederation();
    const r = validateSQL('SELECT COUNT(*) FROM RenewalTrackerFact');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('边界');
  });

  it('开关关闭：纯 PolicyFact 查询仍合法', () => {
    disableFederation();
    expect(validateSQL('SELECT SUM(premium) FROM PolicyFact').valid).toBe(true);
  });

  it('开关开启：FROM RenewalTrackerFact + 聚合 → 合法', () => {
    enableFederation();
    const r = validateSQL(
      "SELECT org_level_3, COUNT(*) FROM RenewalTrackerFact WHERE customer_category='非营业个人客车' GROUP BY org_level_3",
    );
    expect(r.valid).toBe(true);
  });

  it('开关开启：未登记关系（information_schema）仍拒绝', () => {
    enableFederation();
    const r = validateSQL('SELECT COUNT(*) FROM information_schema.columns');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('边界');
  });

  it('开关开启：raw_parquet 仍拒绝（既被边界又被黑名单拦截）', () => {
    enableFederation();
    expect(validateSQL('SELECT SUM(x) FROM raw_parquet').valid).toBe(false);
  });
});

describe('injectPermissionIntoAnySql — 关闭态逐字节兼容', () => {
  it('PolicyFact + org 过滤 → 包裹为过滤内联视图（与历史一致）', () => {
    disableFederation();
    const out = injectPermissionIntoAnySql(
      'SELECT SUM(premium) FROM PolicyFact GROUP BY org_level_3',
      "org_level_3 = '乐山'",
    );
    expect(out).toBe(
      "SELECT SUM(premium) FROM (SELECT * FROM PolicyFact WHERE org_level_3 = '乐山') AS PolicyFact GROUP BY org_level_3",
    );
  });

  it('1=1 → 不注入', () => {
    disableFederation();
    const sql = 'SELECT SUM(premium) FROM PolicyFact';
    expect(injectPermissionIntoAnySql(sql, '1=1')).toBe(sql);
  });

  it('关闭态：含 RenewalTrackerFact 的查询不会被注入（注入器只认 PolicyFact），但 validateSQL 已先拦截', () => {
    disableFederation();
    // 关闭态注入器对 RenewalTrackerFact 无策略；若 SQL 仅含它且有 org 过滤 → 未定位 PolicyFact → 抛错
    expect(() =>
      injectPermissionIntoAnySql(
        'SELECT COUNT(*) FROM RenewalTrackerFact',
        "org_level_3 = '乐山'",
      ),
    ).toThrow(/未能定位 PolicyFact/);
  });
});

describe('injectPermissionIntoAnySql — 联邦 RLS 矩阵（开关开启）', () => {
  it('org_user 过滤 → RenewalTrackerFact 被包裹过滤内联视图', () => {
    enableFederation();
    const out = injectPermissionIntoAnySql(
      'SELECT org_level_3, COUNT(*) FROM RenewalTrackerFact GROUP BY org_level_3',
      "org_level_3 = '乐山'",
    );
    expect(out).toContain("(SELECT * FROM RenewalTrackerFact WHERE org_level_3 = '乐山') AS RenewalTrackerFact");
  });

  it('电销过滤 is_telemarketing=true 作用于 RenewalTrackerFact → fail-closed 抛错（缺列，绝不丢弃过滤）', () => {
    enableFederation();
    expect(() =>
      injectPermissionIntoAnySql(
        'SELECT COUNT(*) FROM RenewalTrackerFact',
        'is_telemarketing = true',
      ),
    ).toThrow(/缺少权限列.*is_telemarketing/);
  });

  it('分公司过滤 branch_code 作用于 RenewalTrackerFact → fail-closed 抛错（缺列）', () => {
    enableFederation();
    expect(() =>
      injectPermissionIntoAnySql(
        'SELECT COUNT(*) FROM RenewalTrackerFact',
        "branch_code = 'SC'",
      ),
    ).toThrow(/缺少权限列.*branch_code/);
  });

  it('org 过滤作用于 QuoteConversion（有 org_level_3 列）→ 正常注入', () => {
    enableFederation();
    const out = injectPermissionIntoAnySql(
      'SELECT COUNT(*) FROM QuoteConversion',
      "org_level_3 = '乐山'",
    );
    expect(out).toContain("(SELECT * FROM QuoteConversion WHERE org_level_3 = '乐山') AS QuoteConversion");
  });

  it('电销过滤作用于 QuoteConversion（is_telemarketing 为 varchar 未纳入 RLS 列）→ fail-closed 拒绝', () => {
    enableFederation();
    expect(() =>
      injectPermissionIntoAnySql('SELECT COUNT(*) FROM QuoteConversion', 'is_telemarketing = true'),
    ).toThrow(/缺少权限列.*is_telemarketing/);
  });

  it('越权缺陷回归：RepairDim（含 org_level_3 机构敏感数据）→ 未纳入联邦，validateSQL 直接拒绝', () => {
    enableFederation();
    // 修复前：误标 exempt → validateSQL 放行 + 注入器原样返回无过滤 SQL（越权读全机构修理数据）。
    // 修复后：RepairDim 移出注册表 → 准入边界直接拒绝，根本进不到注入环节。
    const r = validateSQL('SELECT org_level_3, SUM(damage_assessment_amount) FROM RepairDim GROUP BY org_level_3');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('边界');
  });

  it('exempt 参照表 BrandDim → 放行不注入（确为无机构作用域：厂牌→品牌）', () => {
    enableFederation();
    const sql = 'SELECT COUNT(*) FROM BrandDim';
    // BrandDim 不在 getInjectableRelations，且无 direct 关系 → 开启态放行原样返回
    expect(injectPermissionIntoAnySql(sql, "org_level_3 = '乐山'")).toBe(sql);
  });

  it('JOIN：org 过滤 → 两个 direct 视图各自独立包裹', () => {
    enableFederation();
    const out = injectPermissionIntoAnySql(
      'SELECT COUNT(*) FROM RenewalTrackerFact r JOIN CrossSellFact c ON r.vehicle_frame_no = c.policy_no',
      "org_level_3 = '乐山'",
    );
    expect(out).toContain("(SELECT * FROM RenewalTrackerFact WHERE org_level_3 = '乐山') AS r");
    expect(out).toContain("(SELECT * FROM CrossSellFact WHERE org_level_3 = '乐山') AS c");
  });

  it('1=1 → 任何视图都不注入', () => {
    enableFederation();
    const sql = 'SELECT COUNT(*) FROM RenewalTrackerFact';
    expect(injectPermissionIntoAnySql(sql, '1=1')).toBe(sql);
  });
});
