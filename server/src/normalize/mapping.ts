/**
 * Column Mapping with Alias Support
 *
 * ⚠️ AUTO-GENERATED from field-registry/fields.json — DO NOT EDIT MANUALLY
 * Run: node scripts/field-registry/generate.mjs
 */

export type DomainField =
  | 'policy_no'
  | 'premium'
  | 'policy_date'
  | 'insurance_start_date'
  | 'salesman_name'
  | 'org_level_3'
  | 'customer_category'
  | 'insurance_type'
  | 'coverage_combination'
  | 'is_renewal'
  | 'is_renewable'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'tonnage_segment'
  | 'renewal_policy_no'
  | 'is_commercial_insure'
  | 'vehicle_model'
  | 'new_vehicle_price'
  | 'endorsement_no'
  | 'endorsement_type'
  | 'commercial_pricing_factor'
  | 'terminal_source'
  | 'vehicle_frame_no'
  | 'is_quote'
  | 'claim_cases'
  | 'reported_claims'
  | 'fee_amount'
  | 'renewal_mode'
  | 'insurance_grade'
  | 'is_cross_sell'
  | 'cross_sell_premium_driver'
  | 'underwriting_date'
  | 'third_party_coverage'
  | 'driver_coverage'
  | 'passenger_coverage'
  | 'plate_no'
  | 'seat_count'
  | 'driver_age_group'
  | 'first_registration_date'
  | 'fuel_type'
  | 'agent_name'
  | 'customer_source'
  | 'insurance_end_date'
  | 'insured_gender'
  | 'truck_type'
  | 'tonnage_value'
  | 'no_claim_bonus'
  | 'compulsory_ncd'
  | 'compulsory_ncd_factor'
  | 'commercial_ncd'
  | 'highway_risk_level'
  | 'insurance_score'
  | 'vehicle_age_group'
  | 'previous_insurer'
  | 'next_insurer'
  | 'applicant_name'
  | 'branch_code';

export interface ColumnAliasConfig {
  [key: string]: string[];
}

export const COLUMN_ALIASES: ColumnAliasConfig = {
  policy_no: ['policy_no', 'policyNo', '保单号', '保险单号', 'policy_number'],
  premium: ['premium', 'signed_premium', 'signedPremium', '保费', '签单保费', '保险费'],
  policy_date: ['policy_date', 'policyDate', '保单日期', '签单日期', 'sign_date', 'signed_date'],
  insurance_start_date: ['insurance_start_date', 'insuranceStartDate', '保险起期', '起保日期', 'start_date', 'effective_date'],
  salesman_name: ['salesman_name', 'salesmanName', '业务员', '业务员姓名', 'salesman', 'sales_person'],
  org_level_3: ['org_level_3', 'orgLevel3', '三级机构', '机构', 'organization', 'org_name'],
  customer_category: ['customer_category', 'customerCategory', '客户类别', '客户类别3', 'customer_type', 'client_category'],
  insurance_type: ['insurance_type', 'insuranceType', '险类', '险种类', 'insurance_class', 'product_type'],
  coverage_combination: ['coverage_combination', 'coverageCombination', '险别组合', 'coverage_type', 'product_combination'],
  is_renewal: ['is_renewal', 'isRenewal', '是否续保', '续保', 'renewal'],
  is_renewable: ['is_renewable', 'isRenewable', '是否可续', '可续', 'renewable'],
  is_new_car: ['is_new_car', 'isNewCar', '是否新车', '新车', 'new_car', 'new_vehicle'],
  is_transfer: ['is_transfer', 'isTransfer', '是否过户', '是否过户车', '过户', 'transfer', 'ownership_transfer'],
  is_nev: ['is_nev', 'isNev', '是否新能源', '是否新能源车', '是否新能源车1', '新能源', 'new_energy_vehicle', 'nev'],
  is_telemarketing: ['is_telemarketing', 'isTelemarketing', '是否电销', '电销', 'telemarketing', 'telesales'],
  tonnage_segment: ['tonnage_segment', 'tonnageSegment', '吨位分段', '货车吨位分段', 'tonnage', 'weight_segment'],
  renewal_policy_no: ['续保单号', 'renewal_policy_no', 'renewalPolicyNo', 'old_policy_no', 'renewal_no'],
  is_commercial_insure: ['是否交商统保', 'is_commercial_insure', 'isCommercialInsure', '交商统保', '交商同保', 'commercial_insure'],
  vehicle_model: ['vehicle_model', 'vehicleModel', '厂牌车型', '厂牌车型名称', '车辆型号', 'car_model', 'model'],
  new_vehicle_price: ['new_vehicle_price', 'newVehiclePrice', '新车购置价', '购置价', 'purchase_price', 'car_price'],
  endorsement_no: ['endorsement_no', 'endorsementNo', '批单号', '批改单号', 'endorsement_number', 'batch_no'],
  endorsement_type: ['endorsement_type', 'endorsementType', '批改类型', '批改类型名称', 'endorsement_type_name', 'batch_type'],
  commercial_pricing_factor: ['商车自主定价系数', 'commercial_pricing_factor', 'commercialPricingFactor', '自主定价系数', '商业险自主系数', 'pricing_factor', 'coefficient'],
  terminal_source: ['terminal_source', 'terminalSource', '终端来源', 'terminal', 'channel_source'],
  vehicle_frame_no: ['车架号', 'vehicle_frame_no', 'VIN', 'vehicle_identification'],
  is_quote: ['是否报价', 'is_quote', 'isQuote', '报价标志', 'quote_flag'],
  claim_cases: ['赔案件数', 'claim_cases', 'claimCases', '案件数', 'claim_count'],
  reported_claims: ['已报告赔款', 'reported_claims', 'reportedClaims', '赔款合计', 'total_claims'],
  fee_amount: ['费用金额', 'fee_amount', 'feeAmount', '总费用金额', 'total_fees', '费用合计'],
  renewal_mode: ['续保模式', 'renewal_mode', 'renewalMode', '续保业务类型', 'renewal_type'],
  insurance_grade: ['车险风险等级', '车险分等级', '上年-风险等级', 'insurance_grade', 'insuranceGrade'],
  is_cross_sell: ['交叉销售标识', 'is_cross_sell', 'isCrossSell'],
  cross_sell_premium_driver: ['交叉销售保费_驾意', 'cross_sell_premium_driver', 'crossSellPremiumDriver'],
  underwriting_date: ['underwriting_date', '提核日期', 'review_date'],
  third_party_coverage: ['third_party_coverage', '三者保额', '第三者保额'],
  driver_coverage: ['driver_coverage', '司机保额', '司机座位保额'],
  passenger_coverage: ['passenger_coverage', '乘客险保额', '乘客座位保额'],
  plate_no: ['plate_no', '车牌号码', '车牌号', '车牌', 'license_plate', 'plateNo', 'plate_number'],
  seat_count: ['seat_count', '座位数', 'seats', 'seatCount', 'seat_number'],
  driver_age_group: ['被保险人年龄分组', 'driver_age_group', 'driverAgeGroup', '年龄分组', '被保人年龄'],
  first_registration_date: ['初次登记年月', 'first_registration_date', 'firstRegistrationDate', '初始登记日期', '车辆登记日期'],
  fuel_type: ['燃料种类', 'fuel_type', 'fuelType', '燃料类型', 'fuel_kind'],
  agent_name: ['经代名', 'agent_name', 'agentName', '代理人/经纪人', '经纪代理人'],
  customer_source: ['客户源', '客户源类型', 'customer_source', 'customerSource', '客户来源'],
  insurance_end_date: ['insurance_end_date', 'insuranceEndDate', '保险止期', '保险终止日期', 'end_date', 'expiry_date'],
  insured_gender: ['insured_gender', 'insuredGender', '被保险人性别', '性别', 'gender'],
  truck_type: ['truck_type', 'truckType', '货车类型', '货车分类'],
  tonnage_value: ['tonnage_value', 'tonnageValue', '吨位数', '实际吨位'],
  no_claim_bonus: ['no_claim_bonus', 'noClaimBonus', '无赔款优待记录', 'NCD记录'],
  compulsory_ncd: ['compulsory_ncd', 'compulsoryNcd', '交强险NCD', '交强险NCD分组', '交强险无赔款系数'],
  compulsory_ncd_factor: ['compulsory_ncd_factor', 'compulsoryNcdFactor', '交强险NCD浮动系数', '交强险NCD系数'],
  commercial_ncd: ['commercial_ncd', 'commercialNcd', '商业险NCD', '商业险无赔款系数'],
  highway_risk_level: ['highway_risk_level', 'highwayRiskLevel', '高速风险等级'],
  insurance_score: ['insurance_score', 'insuranceScore', '车险分分数', '车险评分'],
  vehicle_age_group: ['vehicle_age_group', 'vehicleAgeGroup', '车龄分段', '车龄分组'],
  previous_insurer: ['previous_insurer', 'previousInsurer'],
  next_insurer: ['next_insurer', 'nextInsurer'],
  applicant_name: ['applicant_name', 'applicantName'],
  branch_code: ['branch_code', 'branchCode'],
};

export const OPTIONAL_FIELDS: Set<DomainField> = new Set([
  'is_renewable',
  'tonnage_segment',
  'renewal_policy_no',
  'is_commercial_insure',
  'vehicle_model',
  'new_vehicle_price',
  'endorsement_no',
  'endorsement_type',
  'commercial_pricing_factor',
  'terminal_source',
  'vehicle_frame_no',
  'is_quote',
  'claim_cases',
  'reported_claims',
  'fee_amount',
  'renewal_mode',
  'insurance_grade',
  'is_cross_sell',
  'cross_sell_premium_driver',
  'underwriting_date',
  'third_party_coverage',
  'driver_coverage',
  'passenger_coverage',
  'plate_no',
  'seat_count',
  'driver_age_group',
  'first_registration_date',
  'fuel_type',
  'agent_name',
  'customer_source',
  'insurance_end_date',
  'insured_gender',
  'truck_type',
  'tonnage_value',
  'no_claim_bonus',
  'compulsory_ncd',
  'compulsory_ncd_factor',
  'commercial_ncd',
  'highway_risk_level',
  'insurance_score',
  'vehicle_age_group',
  'previous_insurer',
  'next_insurer',
  'applicant_name',
  'branch_code',
]);

/**
 * 敏感字段（个人信息，隐私红线）— fields.json `sensitive: true` 的字段集合。
 * 仅限台账/明细类授权同步场景使用；分析查询面（NL2SQL SQL 校验、字段发现、
 * 字段画像）必须统一消费本集合，拒绝 SELECT / GROUP BY / ORDER BY。
 */
export const SENSITIVE_FIELDS: ReadonlySet<DomainField> = new Set([
  'applicant_name',
]);

export interface ColumnMapping {
  policy_no: string; // 保单号
  premium: string; // 保费
  policy_date: string; // 签单日期
  insurance_start_date: string; // 保险起期
  salesman_name: string; // 业务员
  org_level_3: string; // 三级机构
  customer_category: string; // 客户类别
  insurance_type: string; // 险类
  coverage_combination: string; // 险别组合
  is_renewal: string; // 是否续保
  is_renewable?: string; // 是否可续
  is_new_car: string; // 是否新车
  is_transfer: string; // 是否过户车
  is_nev: string; // 是否新能源
  is_telemarketing: string; // 是否电销
  tonnage_segment?: string; // 吨位分段
  renewal_policy_no?: string; // 续保单号
  is_commercial_insure?: string; // 是否交商统保
  vehicle_model?: string; // 厂牌车型
  new_vehicle_price?: string; // 新车购置价
  endorsement_no?: string; // 批单号
  endorsement_type?: string; // 批改类型
  commercial_pricing_factor?: string; // 商车自主定价系数
  terminal_source?: string; // 终端来源
  vehicle_frame_no?: string; // 车架号
  is_quote?: string; // 是否报价
  claim_cases?: string; // 赔案件数
  reported_claims?: string; // 已报告赔款
  fee_amount?: string; // 费用金额
  renewal_mode?: string; // 续保模式
  insurance_grade?: string; // 车险风险等级
  is_cross_sell?: string; // 交叉销售标识
  cross_sell_premium_driver?: string; // 交叉销售保费_驾意
  underwriting_date?: string; // 提核日期
  third_party_coverage?: string; // 三者保额
  driver_coverage?: string; // 司机保额
  passenger_coverage?: string; // 乘客险保额
  plate_no?: string; // 车牌号码
  seat_count?: string; // 座位数
  driver_age_group?: string; // 被保险人年龄分组
  first_registration_date?: string; // 初次登记年月
  fuel_type?: string; // 燃料种类
  agent_name?: string; // 经代名
  customer_source?: string; // 客户源
  insurance_end_date?: string; // 保险止期
  insured_gender?: string; // 被保险人性别
  truck_type?: string; // 货车类型
  tonnage_value?: string; // 吨位数
  no_claim_bonus?: string; // 无赔款优待记录
  compulsory_ncd?: string; // 交强险NCD
  compulsory_ncd_factor?: string; // 交强险NCD浮动系数
  commercial_ncd?: string; // 商业险NCD
  highway_risk_level?: string; // 高速风险等级
  insurance_score?: string; // 车险分分数
  vehicle_age_group?: string; // 车龄分段
  previous_insurer?: string; // 上年承保主体
  next_insurer?: string; // 次年保险公司
  applicant_name?: string; // 投保人名称
  branch_code?: string; // 分公司编码
}

export interface ValidationResult {
  valid: boolean;
  mapping?: ColumnMapping;
  errors: string[];
  warnings: string[];
}

export function validateAndResolveMapping(
  actualColumns: string[],
  aliases: ColumnAliasConfig = COLUMN_ALIASES
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const columnSet = new Set(actualColumns);
  const resolvedMapping: Partial<ColumnMapping> = {};

  for (const domainField of Object.keys(aliases) as DomainField[]) {
    const possibleNames = aliases[domainField];
    const isOptional = OPTIONAL_FIELDS.has(domainField);
    let resolved = false;

    for (const candidateName of possibleNames) {
      if (columnSet.has(candidateName)) {
        if (resolved) {
          result.warnings.push(
            `Domain field "${domainField}" has multiple matches: already resolved to "${resolvedMapping[domainField]}", but also found "${candidateName}"`
          );
        } else {
          resolvedMapping[domainField] = candidateName;
          resolved = true;
        }
      }
    }

    if (!resolved && !isOptional) {
      result.valid = false;
      result.errors.push(
        `Required domain field "${domainField}" not found. Expected one of: ${possibleNames.join(', ')}`
      );
    }
  }

  if (result.valid) {
    result.mapping = resolvedMapping as ColumnMapping;
  }

  return result;
}

export const DEFAULT_MAPPING: ColumnMapping = {
  policy_no: 'policy_no',
  premium: 'premium',
  policy_date: 'policy_date',
  insurance_start_date: 'insurance_start_date',
  salesman_name: 'salesman_name',
  org_level_3: 'org_level_3',
  customer_category: 'customer_category',
  insurance_type: 'insurance_type',
  coverage_combination: 'coverage_combination',
  is_renewal: 'is_renewal',
  is_renewable: 'is_renewable',
  is_new_car: 'is_new_car',
  is_transfer: 'is_transfer',
  is_nev: 'is_nev',
  is_telemarketing: 'is_telemarketing',
  tonnage_segment: 'tonnage_segment',
  renewal_policy_no: 'renewal_policy_no',
  is_commercial_insure: 'is_commercial_insure',
  vehicle_model: 'vehicle_model',
  new_vehicle_price: 'new_vehicle_price',
  endorsement_no: 'endorsement_no',
  endorsement_type: 'endorsement_type',
  commercial_pricing_factor: 'commercial_pricing_factor',
  terminal_source: 'terminal_source',
  vehicle_frame_no: 'vehicle_frame_no',
  is_quote: 'is_quote',
  claim_cases: 'claim_cases',
  reported_claims: 'reported_claims',
  fee_amount: 'fee_amount',
  renewal_mode: 'renewal_mode',
  insurance_grade: 'insurance_grade',
  is_cross_sell: 'is_cross_sell',
  cross_sell_premium_driver: 'cross_sell_premium_driver',
  underwriting_date: 'underwriting_date',
  third_party_coverage: 'third_party_coverage',
  driver_coverage: 'driver_coverage',
  passenger_coverage: 'passenger_coverage',
  plate_no: 'plate_no',
  seat_count: 'seat_count',
  driver_age_group: 'driver_age_group',
  first_registration_date: 'first_registration_date',
  fuel_type: 'fuel_type',
  agent_name: 'agent_name',
  customer_source: 'customer_source',
  insurance_end_date: 'insurance_end_date',
  insured_gender: 'insured_gender',
  truck_type: 'truck_type',
  tonnage_value: 'tonnage_value',
  no_claim_bonus: 'no_claim_bonus',
  compulsory_ncd: 'compulsory_ncd',
  compulsory_ncd_factor: 'compulsory_ncd_factor',
  commercial_ncd: 'commercial_ncd',
  highway_risk_level: 'highway_risk_level',
  insurance_score: 'insurance_score',
  vehicle_age_group: 'vehicle_age_group',
  previous_insurer: 'previous_insurer',
  next_insurer: 'next_insurer',
  applicant_name: 'applicant_name',
  branch_code: 'branch_code',
};

/**
 * 字段 ID 字面量数组（编译期 + 运行期双锁定）
 *
 * 用法：在 zod schema 中作为 enum 源，使任何引用未注册字段的 Skill / 配置在
 * `bun run typecheck` 阶段就报错，无需等到运行时 Binder Error。
 *
 * 示例：
 *   import { FIELD_IDS } from '../../normalize/mapping.js';
 *   const schema = z.array(z.enum(FIELD_IDS));
 */
export const FIELD_IDS = [
  'policy_no',
  'premium',
  'policy_date',
  'insurance_start_date',
  'salesman_name',
  'org_level_3',
  'customer_category',
  'insurance_type',
  'coverage_combination',
  'is_renewal',
  'is_renewable',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'tonnage_segment',
  'renewal_policy_no',
  'is_commercial_insure',
  'vehicle_model',
  'new_vehicle_price',
  'endorsement_no',
  'endorsement_type',
  'commercial_pricing_factor',
  'terminal_source',
  'vehicle_frame_no',
  'is_quote',
  'claim_cases',
  'reported_claims',
  'fee_amount',
  'renewal_mode',
  'insurance_grade',
  'is_cross_sell',
  'cross_sell_premium_driver',
  'underwriting_date',
  'third_party_coverage',
  'driver_coverage',
  'passenger_coverage',
  'plate_no',
  'seat_count',
  'driver_age_group',
  'first_registration_date',
  'fuel_type',
  'agent_name',
  'customer_source',
  'insurance_end_date',
  'insured_gender',
  'truck_type',
  'tonnage_value',
  'no_claim_bonus',
  'compulsory_ncd',
  'compulsory_ncd_factor',
  'commercial_ncd',
  'highway_risk_level',
  'insurance_score',
  'vehicle_age_group',
  'previous_insurer',
  'next_insurer',
  'applicant_name',
  'branch_code',
] as const satisfies ReadonlyArray<DomainField>;
