/**
 * Column Mapping with Alias Support
 *
 * This module implements the "Alias-Validation" pattern:
 * 1. Define domain fields (business concepts)
 * 2. Map to possible column names (aliases) in source data
 3. Validate before processing
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
  | 'vehicle_frame_no'  // 新增：车架号
  | 'is_quote'          // 新增：是否报价
  | 'claim_cases'        // 新增：赔案件数
  | 'reported_claims'   // 新增：已报告赔款
  | 'fee_amount'        // 新增：费用金额
  | 'renewal_mode'              // 新增：续保模式
  | 'insurance_grade'           // 车险风险等级
  | 'is_cross_sell'             // 交叉销售标识
  | 'cross_sell_premium_driver' // 交叉销售保费-驾意
  | 'underwriting_date'        // 提核日期（原"签单日期"重命名）
  | 'third_party_coverage'     // 三者保额
  | 'driver_coverage'          // 司机保额
  | 'passenger_coverage'       // 乘客险保额
  | 'plate_no'                 // 车牌号码
  | 'seat_count'              // 座位数
  | 'driver_age_group'         // 被保险人年龄分组
  | 'first_registration_date'  // 初次登记年月
  | 'fuel_type';               // 燃料种类

/**
 * Column Alias Configuration
 * Each domain field can have multiple possible column names
 */
export interface ColumnAliasConfig {
  [key: string]: string[]; // domain field -> possible column names
}

/**
 * Default alias mappings for common column name variations
 */
export const COLUMN_ALIASES: ColumnAliasConfig = {
  policy_no: ['policy_no', 'policyNo', '保单号', '保险单号', 'policy_number'],
  premium: ['premium', 'signed_premium', 'signedPremium', '保费', '签单保费', '保险费', '签单/批改保费含税'],
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
  renewal_policy_no: [
    '续保单号',
    'renewal_policy_no',
    'renewalPolicyNo',
    'old_policy_no',
    'renewal_no',
  ],
  is_commercial_insure: [
    '是否交商统保',
    'is_commercial_insure',
    'isCommercialInsure',
    '交商统保',
    'commercial_insure',
  ],
  vehicle_model: ['vehicle_model', 'vehicleModel', '厂牌车型', '车辆型号', 'car_model', 'model'],
  new_vehicle_price: [
    'new_vehicle_price',
    'newVehiclePrice',
    '新车购置价',
    '购置价',
    'purchase_price',
    'car_price',
  ],
  endorsement_no: [
    'endorsement_no',
    'endorsementNo',
    '批单号',
    '批改单号',
    'endorsement_number',
    'batch_no',
  ],
  endorsement_type: [
    'endorsement_type',
    'endorsementType',
    '批改类型',
    '批改类型名称',
    'endorsement_type_name',
    'batch_type',
  ],
  commercial_pricing_factor: [
    '商车自主定价系数',
    'commercial_pricing_factor',
    'commercialPricingFactor',
    '自主定价系数',
    '商业险自主系数',
    'pricing_factor',
    'coefficient',
  ],
  terminal_source: [
    'terminal_source',
    'terminalSource',
    '终端来源',
    'terminal',
    'channel_source',
  ],
  // 新增字段映射
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

  // 新增字段 - 躺在Excel中但之前Parquet没有
  driver_age_group: ['被保险人年龄分组', 'driver_age_group', 'driverAgeGroup', '年龄分组', '被保人年龄'],
  first_registration_date: ['初次登记年月', 'first_registration_date', 'firstRegistrationDate', '初始登记日期', '车辆登记日期'],
  fuel_type: ['燃料种类', 'fuel_type', 'fuelType', '燃料类型', 'fuel_kind'],
};

/**
 * Optional fields - these fields are not required for data validation
 * If not present in the data, they will be filled with default values
 */
export const OPTIONAL_FIELDS: Set<DomainField> = new Set([
  'tonnage_segment',
  'renewal_policy_no',
  'is_commercial_insure',
  'is_renewable',
  'endorsement_no',
  'endorsement_type',
  'terminal_source',
  'vehicle_model',
  'new_vehicle_price',
  'commercial_pricing_factor',
  // 新增可选字段
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
  'fuel_type',
]);

/**
 * Resolved column mapping (domain field -> actual column name in data)
 */
export interface ColumnMapping {
  policy_no: string;
  premium: string;
  policy_date: string;
  insurance_start_date: string;
  salesman_name: string;
  org_level_3: string;
  customer_category: string;
  insurance_type: string;
  coverage_combination: string;
  is_renewal: string;
  is_renewable?: string; // Optional field
  is_new_car: string;
  is_transfer: string;
  is_nev: string;
  is_telemarketing: string;
  tonnage_segment?: string; // Optional field
  renewal_policy_no?: string; // Optional field
  is_commercial_insure?: string; // Optional field
  vehicle_model?: string; // Optional field
  new_vehicle_price?: string; // Optional field
  endorsement_no?: string; // Optional field
  endorsement_type?: string; // Optional field
  commercial_pricing_factor?: string; // Optional field
  terminal_source?: string; // Optional field
  // 新增字段
  vehicle_frame_no?: string; // Optional field
  is_quote?: string; // Optional field
  claim_cases?: string; // Optional field
  reported_claims?: string; // Optional field
  fee_amount?: string; // Optional field
  renewal_mode?: string; // Optional field
  insurance_grade?: string; // Optional field - 车险风险等级
  is_cross_sell?: string; // Optional field
  cross_sell_premium_driver?: string; // Optional field
  underwriting_date?: string; // Optional field - 提核日期
  third_party_coverage?: string; // Optional field - 三者保额
  driver_coverage?: string; // Optional field - 司机保额
  passenger_coverage?: string; // Optional field - 乘客险保额
  plate_no?: string; // Optional field - 车牌号码
  seat_count?: string; // Optional field - 座位数
  driver_age_group?: string; // Optional field - 被保险人年龄分组
  first_registration_date?: string; // Optional field - 初次登记年月
  fuel_type?: string; // Optional field - 燃料种类
}

/**
 * Schema validation result
 */
export interface ValidationResult {
  valid: boolean;
  mapping?: ColumnMapping;
  errors: string[];
  warnings: string[];
}

/**
 * Validate and resolve column mapping from actual schema
 *
 * @param actualColumns - Column names from the data source
 * @param aliases - Alias configuration (defaults to COLUMN_ALIASES)
 * @returns Validation result with resolved mapping or errors
 */
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

  // Try to resolve each domain field
  for (const domainField of Object.keys(aliases) as DomainField[]) {
    const possibleNames = aliases[domainField];
    const isOptional = OPTIONAL_FIELDS.has(domainField);
    let resolved = false;

    for (const candidateName of possibleNames) {
      if (columnSet.has(candidateName)) {
        if (resolved) {
          // Multiple matches - this is ambiguous
          result.warnings.push(
            `Domain field "${domainField}" has multiple matches: already resolved to "${resolvedMapping[domainField]}", but also found "${candidateName}"`
          );
        } else {
          resolvedMapping[domainField] = candidateName;
          resolved = true;
        }
      }
    }

    if (!resolved) {
      if (isOptional) {
        // Optional field not found - this is expected behavior, no warning needed
        // The field is optional by design, so its absence is normal
      } else {
        // Required field not found - this is an error
        result.valid = false;
        result.errors.push(
          `Required domain field "${domainField}" not found. Expected one of: ${possibleNames.join(', ')}`
        );
      }
    }
  }

  if (result.valid) {
    result.mapping = resolvedMapping as ColumnMapping;
  }

  return result;
}

/**
 * Default mapping - used as fallback when column names exactly match
 */
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
  // 新增字段默认映射
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
  fuel_type: 'fuel_type',
};
