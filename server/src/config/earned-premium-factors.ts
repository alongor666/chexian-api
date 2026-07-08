/**
 * 已赚保费「险类系数 α」单一事实源
 *
 * 财务口径已赚保费公式（见 server/src/sql/cost/earned-premium.ts 头注释）中，
 * 首日费用部分 P·F·α·I 的险类折算系数：
 *   交强险 0.82 / 商业保险 0.94 / 其他 0.90
 *
 * 2026-07-07 硬编码专项：原在 earned-premium.ts / earned-premium-detail.ts /
 * sql-builder.ts 共 7 处重复硬编码，收口至此；调整系数只改本文件。
 *
 * ⚠️ 值用字符串字面量而非 number：插值进 SQL 模板后必须与历史生成 SQL 逐字节一致
 * （`${0.90}` 会退化为 '0.9'，改变 SQL 文本进而击穿 route-cache 键与黄金基线对账）。
 * 业务口径本身未变，只是消除重复；改动系数值属业务口径变更，须走 BACKLOG 登记。
 */
export const EARNED_PREMIUM_LINE_FACTORS = {
  /** 交强险 α */
  compulsory: '0.82',
  /** 商业保险 α */
  commercial: '0.94',
  /** 其他险类兜底 α */
  other: '0.90',
} as const;

/**
 * 单行版险类系数 CASE 表达式（用于内嵌在长表达式中的场景）。
 * 输出与历史硬编码文本逐字节一致：
 * `CASE insurance_type WHEN '交强险' THEN 0.82 WHEN '商业保险' THEN 0.94 ELSE 0.90 END`
 */
export const LINE_FACTOR_CASE_INLINE_SQL =
  `CASE insurance_type WHEN '交强险' THEN ${EARNED_PREMIUM_LINE_FACTORS.compulsory}` +
  ` WHEN '商业保险' THEN ${EARNED_PREMIUM_LINE_FACTORS.commercial}` +
  ` ELSE ${EARNED_PREMIUM_LINE_FACTORS.other} END`;
