/**
 * 单元测试：generateRenewalCubeQuery（P2 续保可组合生成器）+ 主查询 A-E 口径共享
 *
 * 覆盖：
 *   - 0/1/2 维度子集的 SQL 骨架（GROUP BY 序号 / 无 GROUP BY）
 *   - 维度白名单（CASE 布尔维度嵌入；未知维度抛错）
 *   - 日期/limit 校验
 *   - cutoff 嵌入 B 计数；extraConditions 追加
 *   - A-E 口径 SSOT：cube 与固定 GROUPING SETS 主查询共用 renewalCountSelectSql（同一 A-E 文本）
 */
import { describe, expect, it } from 'vitest';
import {
  generateRenewalCubeQuery,
  generateRenewalTrackerQuery,
  RENEWAL_CUBE_DIMENSIONS,
} from '../renewal-tracker.js';

const BASE = { start: '2026-06-01', end: '2026-06-30', cutoff: '2026-06-18', limit: 100 };

describe('generateRenewalCubeQuery', () => {
  it('1 维：基本骨架 + GROUP BY 1 + ORDER BY A', () => {
    const sql = generateRenewalCubeQuery({ ...BASE, dims: ['org_level_3'] });
    expect(sql).toContain('org_level_3 AS org_level_3');
    expect(sql).toContain('FROM RenewalTrackerFact');
    expect(sql).toContain("expiry_date >= DATE '2026-06-01'");
    expect(sql).toContain("expiry_date <= DATE '2026-06-30'");
    expect(sql).toMatch(/GROUP BY 1\b/);
    expect(sql).toMatch(/ORDER BY A DESC/);
    expect(sql).toMatch(/LIMIT 100/);
    // A-E universe 列齐全
    expect(sql).toContain('COUNT(DISTINCT vehicle_frame_no) AS A');
    expect(sql).toMatch(/AS B/);
    expect(sql).toMatch(/AS C/);
    expect(sql).toMatch(/AS D/);
    expect(sql).toMatch(/AS E/);
  });

  it('2 维（含 CASE 布尔维度 is_new_car）：GROUP BY 1, 2', () => {
    const sql = generateRenewalCubeQuery({ ...BASE, dims: ['org_level_3', 'is_new_car'] });
    expect(sql).toContain('org_level_3 AS org_level_3');
    expect(sql).toContain("CASE WHEN is_new_car THEN '新车' ELSE '旧车' END AS is_new_car");
    expect(sql).toMatch(/GROUP BY 1, 2/);
  });

  it('0 维：整体聚合，无 GROUP BY 子句', () => {
    const sql = generateRenewalCubeQuery({ ...BASE, dims: [] });
    expect(sql).not.toMatch(/GROUP BY/);
    expect(sql).toContain('COUNT(DISTINCT vehicle_frame_no) AS A');
    expect(sql).toMatch(/ORDER BY A DESC/);
  });

  it('cutoff 嵌入 B 报价计数', () => {
    const sql = generateRenewalCubeQuery({ ...BASE, dims: ['org_level_3'] });
    expect(sql).toContain("CAST(first_quote_time AS DATE) <= DATE '2026-06-18'");
  });

  it('extraConditions 追加到 WHERE（权限/筛选）', () => {
    const sql = generateRenewalCubeQuery({
      ...BASE,
      dims: ['org_level_3'],
      extraConditions: ["org_level_3 IN ('天府')", '(org_level_3 = \'天府\')'],
    });
    expect(sql).toContain("org_level_3 IN ('天府')");
    expect(sql).toContain("(org_level_3 = '天府')");
  });

  it('未知维度抛错（白名单外）', () => {
    expect(() =>
      generateRenewalCubeQuery({ ...BASE, dims: ['insurance_grade'] })
    ).toThrow(/未知维度/);
  });

  it('非法日期抛错', () => {
    expect(() => generateRenewalCubeQuery({ ...BASE, start: '2026/06/01', dims: [] })).toThrow(/Invalid start date/);
    expect(() => generateRenewalCubeQuery({ ...BASE, cutoff: 'bad', dims: [] })).toThrow(/Invalid cutoff date/);
  });

  it('非正整数 limit 抛错', () => {
    expect(() => generateRenewalCubeQuery({ ...BASE, dims: [], limit: 0 })).toThrow(/limit/);
    expect(() => generateRenewalCubeQuery({ ...BASE, dims: [], limit: -5 })).toThrow(/limit/);
  });

  it('维度白名单含续保派生列 + 不含 PolicyFact 专属列（如 insurance_grade）', () => {
    const keys = Object.keys(RENEWAL_CUBE_DIMENSIONS);
    expect(keys).toContain('org_level_3');
    expect(keys).toContain('is_new_car');
    expect(keys).toContain('coverage_combination');
    expect(keys).not.toContain('insurance_grade'); // 风险等级不在续保宽表
  });
});

describe('A-E 口径 SSOT：cube 与固定 GROUPING SETS 主查询共用', () => {
  it('主查询仍含 A-E + GROUPING SETS（refactor 行为保持）', () => {
    const sql = generateRenewalTrackerQuery(BASE);
    expect(sql).toContain('COUNT(DISTINCT vehicle_frame_no) AS A');
    expect(sql).toMatch(/AS E/);
    expect(sql).toContain('GROUPING SETS');
  });

  it('cube 与主查询的 A 列定义字面一致（共享 renewalCountSelectSql）', () => {
    const main = generateRenewalTrackerQuery(BASE);
    const cube = generateRenewalCubeQuery({ ...BASE, dims: ['org_level_3'] });
    // 两者都包含同一 A 计数定义（口径未漂移）
    const aDef = 'COUNT(DISTINCT vehicle_frame_no) AS A';
    expect(main).toContain(aDef);
    expect(cube).toContain(aDef);
    // B 报价件数 cutoff 切片定义两者一致
    const bDef = "WHEN is_quoted AND CAST(first_quote_time AS DATE) <= DATE '2026-06-18' THEN vehicle_frame_no";
    expect(main).toContain(bDef);
    expect(cube).toContain(bDef);
  });
});
