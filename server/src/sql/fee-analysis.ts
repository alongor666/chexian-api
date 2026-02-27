/**
 * 费用分析SQL生成器
 * Fee Analysis SQL Generator
 *
 * 适用范围（硬编码）：
 *   - 成都同城机构：武侯、天府、新都、青羊、高新
 *   - 非营业个人客车
 *   - 非新能源
 *   - 非电销（is_telemarketing = false）
 *   - 规则生效起始日期：2026-02-25（按签单日期）
 *
 * 共22条费率规则（6条交强险 + 16条商业险）
 * 规则元数据（生效起止日）通过 rule_def CTE 返回，UI可直接展示
 */

/** 同城成都机构列表 */
const CHENGDU_ORGS = `('武侯', '天府', '新都', '青羊', '高新')`;

/** 当前规则版本生效日期 */
const RULE_V1_START = '2026-02-25';

/**
 * 规则定义：(rule_id, rule_name, insurance_type_label, fee_rate, effective_start, effective_end)
 * effective_end = NULL 表示当前仍生效
 */
const RULE_DEF_VALUES = `
    ('CTI_L_Q_ZERO',                '交强险-川L/Q牌照',                   '交强险', 0.00, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('CTI_BUNDLE',                  '交强险-套单',                         '交强险', 0.04, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('CTI_SOLO_NON_AG_SEAT6',       '交强险-单交-非川A/G-座位≥6',          '交强险', 0.04, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('CTI_SOLO_AG_SEAT5_GRADE_ABC', '交强险-单交-川A/G-座位<6-等级A/B/C-非过户', '交强险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('CTI_SOLO_AG_SEAT5_TRANSFER',  '交强险-单交-川A/G-座位<6-过户',       '交强险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('CTI_SOLO_OTHER',              '交强险-单交-其他',                     '交强险', 0.20, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_NEW_BUNDLE_HIGH',         '商业险-新车-套单-高配',                '商业险', 0.23, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_NEW_BUNDLE_OTHER',        '商业险-新车-套单-其他',                '商业险', 0.19, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_NEW_SOLO',                '商业险-新车-单商',                     '商业险', 0.04, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_BUNDLE_ZQ_HIGH',      '商业险-旧车-套单-主全-高配',           '商业险', 0.30, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_BUNDLE_ZQ_MID',       '商业险-旧车-套单-主全-中配',           '商业险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_BUNDLE_JS_HIGH',      '商业险-旧车-套单-交三-高配',           '商业险', 0.30, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_BUNDLE_JS_MID',       '商业险-旧车-套单-交三-中配',           '商业险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_BUNDLE_OTHER',        '商业险-旧车-套单-其他',                '商业险', 0.24, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_NO_TRANSFER',    '商业险-旧车-单商-非过户',              '商业险', 0.04, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_ZQ_HIGH',   '商业险-旧车-单商-过户-主全-高配',      '商业险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_ZQ_MID',    '商业险-旧车-单商-过户-主全-中配',      '商业险', 0.24, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_JS_HIGH',   '商业险-旧车-单商-过户-交三-高配',      '商业险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_JS_MID',    '商业险-旧车-单商-过户-交三-中配',      '商业险', 0.24, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_OTHER',     '商业险-旧车-单商-过户-其他',           '商业险', 0.21, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('COM_OLD_SOLO_XFER_ZQ_HIGH_2', '商业险-旧车-单商-过户-主全-高配(重)',  '商业险', 0.27, '${RULE_V1_START}'::DATE, NULL::DATE),
    ('OUT_OF_SCOPE',                '规则外（范围内但未匹配）',              '其他',  NULL, NULL::DATE,              NULL::DATE)`;

/**
 * 规则决策树 CASE WHEN
 * 对 PolicyFact 视图中的每条保单进行规则匹配，返回 rule_id
 *
 * 注意：
 * - CASE WHEN 顺序即优先级，先匹配先中
 * - 交强险规则先于商业险规则
 * - 每条商业险规则的高配条件先于中配/其他
 */
const RULE_CASE_WHEN = `
    CASE
      -- ============ 交强险规则 ============
      -- 规则1: 车牌含川L/Q（特殊地区）→ 0%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND (plate_no LIKE '川L%' OR plate_no LIKE '川Q%')
        THEN 'CTI_L_Q_ZERO'

      -- 规则2: 交强险套单 → 4%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_commercial_insure = '套单'
        THEN 'CTI_BUNDLE'

      -- 规则3: 单交 + 非川A/G + 座位≥6 → 4%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_commercial_insure = '单交'
        AND plate_no NOT LIKE '川A%'
        AND plate_no NOT LIKE '川G%'
        AND COALESCE(seat_count, 0) >= 6
        THEN 'CTI_SOLO_NON_AG_SEAT6'

      -- 规则4: 单交 + 非过户 + 川A/G + 座位<6 + 等级A/B/C → 27%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_commercial_insure = '单交'
        AND is_transfer = false
        AND (plate_no LIKE '川A%' OR plate_no LIKE '川G%')
        AND COALESCE(seat_count, 0) < 6
        AND insurance_grade IN ('A', 'B', 'C')
        THEN 'CTI_SOLO_AG_SEAT5_GRADE_ABC'

      -- 规则5: 单交 + 过户 + 川A/G + 座位<6 → 27%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_commercial_insure = '单交'
        AND is_transfer = true
        AND (plate_no LIKE '川A%' OR plate_no LIKE '川G%')
        AND COALESCE(seat_count, 0) < 6
        THEN 'CTI_SOLO_AG_SEAT5_TRANSFER'

      -- 规则6: 单交其他情况 → 20%
      WHEN insurance_type = '交强险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_commercial_insure = '单交'
        THEN 'CTI_SOLO_OTHER'

      -- ============ 商业险规则 ============
      -- 规则7: 新车 + 套单 + 高配（三者≥200万，司机≥2万，乘客≥2万，驾意≥300）→ 23%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = true
        AND is_commercial_insure = '套单'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 20000
        AND COALESCE(passenger_coverage, 0) >= 20000
        AND COALESCE(cross_sell_premium_driver, 0) >= 300
        THEN 'COM_NEW_BUNDLE_HIGH'

      -- 规则8: 新车 + 套单其他 → 19%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = true
        AND is_commercial_insure = '套单'
        THEN 'COM_NEW_BUNDLE_OTHER'

      -- 规则9: 新车 + 单商 → 4%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = true
        AND is_commercial_insure = '单商'
        THEN 'COM_NEW_SOLO'

      -- 规则10: 旧车 + 套单 + 主全 + 高配（司机≥2万，乘客≥2万，驾意≥300）→ 30%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_commercial_insure = '套单'
        AND coverage_combination = '主全'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 20000
        AND COALESCE(passenger_coverage, 0) >= 20000
        AND COALESCE(cross_sell_premium_driver, 0) >= 300
        THEN 'COM_OLD_BUNDLE_ZQ_HIGH'

      -- 规则11: 旧车 + 套单 + 主全 + 中配（司机≥1万，乘客≥1万，驾意≥200）→ 27%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_commercial_insure = '套单'
        AND coverage_combination = '主全'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 10000
        AND COALESCE(passenger_coverage, 0) >= 10000
        AND COALESCE(cross_sell_premium_driver, 0) >= 200
        THEN 'COM_OLD_BUNDLE_ZQ_MID'

      -- 规则12: 旧车 + 套单 + 交三 + 高配（司机≥2万，乘客≥2万，驾意≥200）→ 30%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_commercial_insure = '套单'
        AND coverage_combination = '交三'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 20000
        AND COALESCE(passenger_coverage, 0) >= 20000
        AND COALESCE(cross_sell_premium_driver, 0) >= 200
        THEN 'COM_OLD_BUNDLE_JS_HIGH'

      -- 规则13: 旧车 + 套单 + 交三 + 中配（司机≥1万，乘客≥1万，驾意≥150）→ 27%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_commercial_insure = '套单'
        AND coverage_combination = '交三'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 10000
        AND COALESCE(passenger_coverage, 0) >= 10000
        AND COALESCE(cross_sell_premium_driver, 0) >= 150
        THEN 'COM_OLD_BUNDLE_JS_MID'

      -- 规则14: 旧车 + 套单其他 → 24%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_commercial_insure = '套单'
        THEN 'COM_OLD_BUNDLE_OTHER'

      -- 规则15: 旧车 + 非过户 + 单商 → 4%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = false
        AND is_commercial_insure = '单商'
        THEN 'COM_OLD_SOLO_NO_TRANSFER'

      -- 规则16: 旧车 + 过户 + 单商 + 主全 + 高配（司机≥2万，乘客≥2万，驾意≥300）→ 27%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = true
        AND is_commercial_insure = '单商'
        AND coverage_combination = '主全'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 20000
        AND COALESCE(passenger_coverage, 0) >= 20000
        AND COALESCE(cross_sell_premium_driver, 0) >= 300
        THEN 'COM_OLD_SOLO_XFER_ZQ_HIGH'

      -- 规则17: 旧车 + 过户 + 单商 + 主全 + 中配（司机≥1万，乘客≥1万，驾意≥200）→ 24%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = true
        AND is_commercial_insure = '单商'
        AND coverage_combination = '主全'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 10000
        AND COALESCE(passenger_coverage, 0) >= 10000
        AND COALESCE(cross_sell_premium_driver, 0) >= 200
        THEN 'COM_OLD_SOLO_XFER_ZQ_MID'

      -- 规则18: 旧车 + 过户 + 单商 + 交三 + 高配（司机≥2万，乘客≥2万，驾意≥200）→ 27%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = true
        AND is_commercial_insure = '单商'
        AND coverage_combination = '交三'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 20000
        AND COALESCE(passenger_coverage, 0) >= 20000
        AND COALESCE(cross_sell_premium_driver, 0) >= 200
        THEN 'COM_OLD_SOLO_XFER_JS_HIGH'

      -- 规则19: 旧车 + 过户 + 单商 + 交三 + 中配（司机≥1万，乘客≥1万，驾意≥150）→ 24%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = true
        AND is_commercial_insure = '单商'
        AND coverage_combination = '交三'
        AND COALESCE(third_party_coverage, 0) >= 2000000
        AND COALESCE(driver_coverage, 0) >= 10000
        AND COALESCE(passenger_coverage, 0) >= 10000
        AND COALESCE(cross_sell_premium_driver, 0) >= 150
        THEN 'COM_OLD_SOLO_XFER_JS_MID'

      -- 规则20: 旧车 + 过户 + 单商其他 → 21%
      WHEN insurance_type = '商业保险'
        AND policy_date >= '${RULE_V1_START}'
        AND is_new_car = false
        AND is_transfer = true
        AND is_commercial_insure = '单商'
        THEN 'COM_OLD_SOLO_XFER_OTHER'

      -- 规则外（在适用范围内但不满足任何规则）
      ELSE 'OUT_OF_SCOPE'
    END`;

/**
 * 生成费用分析聚合查询
 *
 * 固定范围过滤：成都同城机构 + 非营业个人客车 + 非新能源 + 非电销
 * 规则生效日期：policy_date >= 2026-02-25
 * 返回：按规则分档的件数、保费、预计费用、绩效费
 *
 * @param userWhereClause  用户可选筛选条件（日期/业务员等，来自 parseFiltersAndBuildWhere）
 */
export function generateFeeAnalysisQuery(userWhereClause: string): string {
  // 固定适用范围（与用户筛选 AND 组合）
  const scopeFilter = `
    org_level_3 IN ${CHENGDU_ORGS}
    AND is_nev = false
    AND customer_category = '非营业个人客车'
    AND is_telemarketing = false`;

  const finalWhere = userWhereClause && userWhereClause !== '1=1'
    ? `${scopeFilter}\n    AND (${userWhereClause})`
    : scopeFilter;

  return `
    WITH rule_def AS (
      SELECT * FROM (VALUES
        ${RULE_DEF_VALUES}
      ) AS t(rule_id, rule_name, insurance_type_label, fee_rate, effective_start, effective_end)
    ),
    tagged AS (
      SELECT
        premium,
        ${RULE_CASE_WHEN} AS fee_rule_id
      FROM PolicyFact
      WHERE ${finalWhere}
    )
    SELECT
      r.rule_id                                                    AS fee_rule_id,
      r.rule_name                                                  AS fee_rule_name,
      r.insurance_type_label                                       AS insurance_type_label,
      r.fee_rate                                                   AS fee_rate,
      STRFTIME(r.effective_start, '%Y-%m-%d')                      AS effective_start,
      CASE WHEN r.effective_end IS NULL THEN NULL
           ELSE STRFTIME(r.effective_end, '%Y-%m-%d') END          AS effective_end,
      COUNT(*)                                                     AS policy_count,
      SUM(t.premium)                                               AS total_premium,
      CASE WHEN r.fee_rate IS NOT NULL
           THEN SUM(t.premium) * r.fee_rate
           ELSE NULL END                                           AS expected_fee,
      SUM(t.premium) * 0.01                                        AS performance_fee
    FROM tagged t
    JOIN rule_def r ON t.fee_rule_id = r.rule_id
    GROUP BY
      r.rule_id, r.rule_name, r.insurance_type_label,
      r.fee_rate, r.effective_start, r.effective_end
    ORDER BY
      r.insurance_type_label,
      r.fee_rate DESC NULLS LAST,
      r.rule_id
  `;
}
