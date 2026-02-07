/**
 * 真实测试数据夹具
 *
 * 数据来源：数据管理/保单明细/车险保单综合明细表.parquet
 * 生成时间：2026-01-18
 * 数据特点：每个三级机构、每个维度、每个时间段的真实样本数据
 *
 * 使用说明：
 * - 这些数据是从生产数据中提取的真实样本
 * - 用于验证SQL生成、数据聚合、业务计算的正确性
 * - 保单号、业务员姓名等均为真实数据
 */

/**
 * 12个三级机构列表
 */
export const REAL_ORGANIZATIONS = [
  '乐山',
  '天府',
  '宜宾',
  '德阳',
  '新都',
  '武侯',
  '泸州',
  '自贡',
  '资阳',
  '达州',
  '青羊',
  '高新',
] as const;

/**
 * 每个三级机构的真实样本数据
 */
export const REAL_ORG_SAMPLES = [
  {
    org: '乐山',
    policy_no: '6101901030120240002748',
    salesman: '200050681张彩云',
    sign_date: '2024-12-30',
    start_date: '2025-01-28',
    premium: 896.23,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: true,
  },
  {
    org: '天府',
    policy_no: '6103011030120250124367',
    salesman: '110052052官久强',
    sign_date: '2025-06-03',
    start_date: '2025-06-04',
    premium: 4226.42,
    insurance_type: '交强险',
    customer_type: '营业货车',
    is_renewal: false,
  },
  {
    org: '宜宾',
    policy_no: '6102001030120240052786',
    salesman: '210011930骆跃强',
    sign_date: '2024-12-23',
    start_date: '2024-12-23',
    premium: 627.36,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: true,
  },
  {
    org: '德阳',
    policy_no: '6103011030120250111238',
    salesman: '113030118刘欣',
    sign_date: '2025-05-13',
    start_date: '2025-05-15',
    premium: 896.23,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '新都',
    policy_no: '6103011030120250149076',
    salesman: '210011915但力君',
    sign_date: '2025-07-08',
    start_date: '2025-07-28',
    premium: 806.6,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '武侯',
    policy_no: '6103011030120250131014',
    salesman: '200049355谢黎黎',
    sign_date: '2025-06-11',
    start_date: '2025-06-27',
    premium: 627.36,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '泸州',
    policy_no: '6101701031220250002072',
    salesman: '200050109熊建律',
    sign_date: '2025-08-06',
    start_date: '2025-08-08',
    premium: 544.92,
    insurance_type: '商业保险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '自贡',
    policy_no: '6101501030120250009653',
    salesman: '110055662陈秀英',
    sign_date: '2025-07-09',
    start_date: '2025-07-12',
    premium: 627.36,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '资阳',
    policy_no: '6102101031220250000381',
    salesman: '200047694李国军',
    sign_date: '2025-02-14',
    start_date: '2025-02-26',
    premium: 936.63,
    insurance_type: '商业保险',
    customer_type: '非营业货车',
    is_renewal: false,
  },
  {
    org: '达州',
    policy_no: '6102201031220250000423',
    salesman: '200050791王星入',
    sign_date: '2025-03-20',
    start_date: '2025-04-06',
    premium: 5533.14,
    insurance_type: '商业保险',
    customer_type: '营业出租租赁',
    is_renewal: false,
  },
  {
    org: '青羊',
    policy_no: '6100501030120250001085',
    salesman: '200050970刘乔',
    sign_date: '2025-09-08',
    start_date: '2025-09-19',
    premium: 716.98,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
  {
    org: '高新',
    policy_no: '6103011031720250000211',
    salesman: '200046028周艳翎',
    sign_date: '2025-03-13',
    start_date: '2025-03-15',
    premium: 4643.22,
    insurance_type: '商业保险',
    customer_type: '非营业个人客车',
    is_renewal: false,
  },
];

/**
 * 每个险类的真实样本
 */
export const REAL_INSURANCE_TYPE_SAMPLES = [
  {
    insurance_type: '交强险',
    policy_no: '6103011030120250124367',
    premium: 4226.42,
    org: '天府',
  },
  {
    insurance_type: '商业保险',
    policy_no: '6103011031720250000211',
    premium: 4643.22,
    org: '高新',
  },
];

/**
 * 每个客户类别的真实样本
 */
export const REAL_CUSTOMER_TYPE_SAMPLES = [
  {
    customer_type: '营业货车',
    policy_no: '6103011030120250124367',
    premium: 4226.42,
    org: '天府',
  },
  {
    customer_type: '非营业个人客车',
    policy_no: '6103011030120250125936',
    premium: 896.23,
    org: '天府',
  },
  {
    customer_type: '非营业企业客车',
    policy_no: '6103011030120250161563',
    premium: 943.4,
    org: '武侯',
  },
  {
    customer_type: '非营业货车',
    policy_no: '6103011030120250169982',
    premium: 792.45,
    org: '天府',
  },
  {
    customer_type: '营业出租租赁',
    policy_no: '6102201031220250000423',
    premium: 5533.14,
    org: '达州',
  },
  {
    customer_type: '营业公路客运',
    policy_no: '6101701031720250000026',
    premium: 6802.09,
    org: '泸州',
  },
  {
    customer_type: '特种车',
    policy_no: '6101501031320250000022',
    premium: 2708.15,
    org: '自贡',
  },
  {
    customer_type: '非营业机关客车',
    policy_no: '6103008030120250020721',
    premium: 896.23,
    org: '天府',
  },
  {
    customer_type: '营业城市公交',
    policy_no: '6102101031220250001471',
    premium: 3860.49,
    org: '资阳',
  },
  {
    customer_type: '摩托车',
    policy_no: '6100601030120250000198',
    premium: 113.21,
    org: '武侯',
  },
  {
    customer_type: '挂车',
    policy_no: '6101901031320240000142',
    premium: 3427.13,
    org: '乐山',
  },
];

/**
 * 每个终端来源的真实样本
 */
export const REAL_TERMINAL_SOURCE_SAMPLES = [
  {
    terminal_source: '0202APP',
    policy_no: '6103011030120250124367',
    premium: 4226.42,
    org: '天府',
  },
  {
    terminal_source: '0106移动展业(App)',
    policy_no: '6103011030120250125936',
    premium: 896.23,
    org: '天府',
  },
  {
    terminal_source: '0107B2B',
    policy_no: '6103011030120250131851',
    premium: 933.96,
    org: '天府',
  },
  {
    terminal_source: '0101柜面',
    policy_no: '6103011030120250142783',
    premium: 627.36,
    org: '天府',
  },
  {
    terminal_source: '0201PC',
    policy_no: '6103011030120250153211',
    premium: 627.36,
    org: '天府',
  },
  {
    terminal_source: '0110融合销售',
    policy_no: '6102001030120250046208',
    premium: 1018.87,
    org: '宜宾',
  },
  {
    terminal_source: '0112AI出单',
    policy_no: '6103015031220250001501',
    premium: 389.21,
    org: '天府',
  },
  {
    terminal_source: '0105微信（WeChat）',
    policy_no: '6103009031220240000376',
    premium: 0.0,
    org: '天府',
  },
];

/**
 * 每个续保模式的真实样本
 */
export const REAL_RENEWAL_MODE_SAMPLES = [
  {
    renewal_mode: '自留',
    policy_no: '6103011031720250000211',
    premium: 4643.22,
    org: '高新',
    is_renewal: false,
  },
  {
    renewal_mode: '外呼',
    policy_no: '6103011030120250003859',
    premium: 660.38,
    org: '天府',
    is_renewal: false,
  },
];

/**
 * 每个吨位分段的真实样本（营业货车）
 */
export const REAL_TONNAGE_SAMPLES = [
  {
    tonnage_segment: '10吨以上',
    policy_no: '6103011030120250124367',
    premium: 4226.42,
    org: '天府',
    customer_type: '营业货车',
  },
  {
    tonnage_segment: '1吨以下',
    policy_no: '6103011030120250125936',
    premium: 896.23,
    org: '天府',
    customer_type: '非营业个人客车',
  },
  {
    tonnage_segment: '1-2吨',
    policy_no: '6103011030120250069551',
    premium: 905.66,
    org: '青羊',
    customer_type: '非营业货车',
  },
  {
    tonnage_segment: '2-9吨',
    policy_no: '6100701031220250002717',
    premium: 1796.16,
    org: '高新',
    customer_type: '营业货车',
  },
  {
    tonnage_segment: '9-10吨',
    policy_no: '6100701030120250004306',
    premium: 2929.25,
    org: '高新',
    customer_type: '营业货车',
  },
];

/**
 * 不同日期的真实样本（按月抽样）
 */
export const REAL_DATE_SAMPLES = [
  {
    sign_date: '2023-11-27',
    start_date: '2023-12-25',
    policy_no: '6100501030120230019431',
    premium: -41.14,
    org: '青羊',
  },
  {
    sign_date: '2023-12-05',
    start_date: '2023-12-29',
    policy_no: '6102101030120230031037',
    premium: 0.0,
    org: '资阳',
  },
  {
    sign_date: '2024-01-02',
    start_date: '2024-01-07',
    policy_no: '6103011030120240000964',
    premium: 0.0,
    org: '天府',
  },
  {
    sign_date: '2024-02-01',
    start_date: '2024-02-04',
    policy_no: '6103011031220240003494',
    premium: 0.0,
    org: '天府',
  },
  {
    sign_date: '2024-03-01',
    start_date: '2024-03-17',
    policy_no: '6100801031220240000857',
    premium: -181.46,
    org: '新都',
  },
  {
    sign_date: '2024-04-01',
    start_date: '2024-04-02',
    policy_no: '6100701031220240002481',
    premium: 0.0,
    org: '高新',
  },
  {
    sign_date: '2024-05-02',
    start_date: '2024-05-03',
    policy_no: '6102101031220240000771',
    premium: -38.73,
    org: '资阳',
  },
  {
    sign_date: '2024-06-01',
    start_date: '2024-06-01',
    policy_no: '6100501031220240002223',
    premium: -3405.91,
    org: '青羊',
  },
  {
    sign_date: '2024-07-01',
    start_date: '2024-07-02',
    policy_no: '6103011030120240047578',
    premium: 0.0,
    org: '天府',
  },
  {
    sign_date: '2024-08-01',
    start_date: '2024-08-31',
    policy_no: '6103011030120240057573',
    premium: 0.0,
    org: '天府',
  },
  {
    sign_date: '2024-09-01',
    start_date: '2024-09-01',
    policy_no: '6103011030120240076894',
    premium: 0.0,
    org: '天府',
  },
  {
    sign_date: '2024-10-01',
    start_date: '2024-11-12',
    policy_no: '6102201030120240001271',
    premium: 0.0,
    org: '达州',
  },
  {
    sign_date: '2024-11-01',
    start_date: '2024-11-10',
    policy_no: '6103011031220240045312',
    premium: 0.0,
    org: '青羊',
  },
  {
    sign_date: '2024-12-01',
    start_date: '2024-12-29',
    policy_no: '6103011031220240053617',
    premium: 393.72,
    org: '天府',
  },
  {
    sign_date: '2025-01-01',
    start_date: '2025-01-03',
    policy_no: '6103011030120250000794',
    premium: 806.6,
    org: '天府',
  },
];

/**
 * 成本分析相关真实样本（有赔案）
 */
export const REAL_COST_ANALYSIS_SAMPLES = [
  {
    policy_no: '6103011030120250124367',
    org: '天府',
    sign_date: '2025-06-03',
    start_date: '2025-06-04',
    premium: 4226.42,
    claim_count: 1,
    reported_loss: 2000.0,
    expense: 0.0,
    insurance_type: '交强险',
    customer_type: '营业货车',
  },
  {
    policy_no: '6103011030120250129325',
    org: '天府',
    sign_date: '2025-06-07',
    start_date: '2025-06-09',
    premium: 1037.74,
    claim_count: 1,
    reported_loss: 700.0,
    expense: 103.78,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6102001030120250000937',
    org: '宜宾',
    sign_date: '2025-01-04',
    start_date: '2025-01-20',
    premium: -471.44,
    claim_count: 1,
    reported_loss: 2263.43,
    expense: 4.25,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011030120250175252',
    org: '青羊',
    sign_date: '2025-08-26',
    start_date: '2025-08-27',
    premium: 716.98,
    claim_count: 1,
    reported_loss: 2000.0,
    expense: 60.3,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011031220250002878',
    org: '高新',
    sign_date: '2025-01-07',
    start_date: '2025-01-09',
    premium: 1307.35,
    claim_count: 1,
    reported_loss: 209.43,
    expense: 274.54,
    insurance_type: '商业保险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011030120240135530',
    org: '天府',
    sign_date: '2024-12-05',
    start_date: '2024-12-05',
    premium: 896.23,
    claim_count: 1,
    reported_loss: 0.0,
    expense: 170.28,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011030120240147664',
    org: '高新',
    sign_date: '2024-12-21',
    start_date: '2025-01-15',
    premium: 627.36,
    claim_count: 1,
    reported_loss: 0.0,
    expense: 31.36,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011030120250146676',
    org: '高新',
    sign_date: '2025-07-05',
    start_date: '2025-07-23',
    premium: 627.36,
    claim_count: 1,
    reported_loss: 1927.5,
    expense: 31.36,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6103011030120250161258',
    org: '宜宾',
    sign_date: '2025-07-26',
    start_date: '2025-07-27',
    premium: 933.96,
    claim_count: 1,
    reported_loss: 1980.2,
    expense: 0.0,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6101901030120240002748',
    org: '乐山',
    sign_date: '2024-12-30',
    start_date: '2025-01-28',
    premium: 896.23,
    claim_count: 1,
    reported_loss: 1054.01,
    expense: 33.7,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6102001030120240054070',
    org: '宜宾',
    sign_date: '2024-12-31',
    start_date: '2025-01-21',
    premium: 806.6,
    claim_count: 1,
    reported_loss: 1367.0,
    expense: 30.33,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
  {
    policy_no: '6101701030120250000895',
    org: '泸州',
    sign_date: '2025-01-25',
    start_date: '2025-02-06',
    premium: 806.6,
    claim_count: 1,
    reported_loss: 0.0,
    expense: 66.22,
    insurance_type: '交强险',
    customer_type: '非营业个人客车',
  },
];

/**
 * 商车自主定价系数真实样本
 */
export const REAL_COEFFICIENT_SAMPLES = [
  {
    policy_no: '6103011031720250000211',
    org: '高新',
    coefficient: 1.35,
    premium: 4643.22,
    customer_type: '非营业个人客车',
    sign_date: '2025-03-13',
  },
  {
    policy_no: '6102001031220240003882',
    org: '宜宾',
    coefficient: 0.82,
    premium: 532.83,
    customer_type: '非营业个人客车',
    sign_date: '2024-12-02',
  },
  {
    policy_no: '6102001031220250001894',
    org: '宜宾',
    coefficient: 0.77,
    premium: 1015.44,
    customer_type: '非营业个人客车',
    sign_date: '2025-05-28',
  },
  {
    policy_no: '6102001031220250004756',
    org: '宜宾',
    coefficient: 0.9625,
    premium: 705.17,
    customer_type: '非营业个人客车',
    sign_date: '2025-11-27',
  },
  {
    policy_no: '6102001031220250005612',
    org: '宜宾',
    coefficient: 0.78,
    premium: 1231.11,
    customer_type: '非营业个人客车',
    sign_date: '2025-12-31',
  },
  {
    policy_no: '6100501031220250001763',
    org: '青羊',
    coefficient: 0.8199,
    premium: 1401.53,
    customer_type: '非营业个人客车',
    sign_date: '2025-09-25',
  },
  {
    policy_no: '6100501031220250003906',
    org: '青羊',
    coefficient: 0.81,
    premium: 370.87,
    customer_type: '非营业个人客车',
    sign_date: '2025-11-09',
  },
  {
    policy_no: '6103011031220240025489',
    org: '青羊',
    coefficient: 1.2,
    premium: -1053.71,
    customer_type: '营业货车',
    sign_date: '2024-08-13',
  },
  {
    policy_no: '6103011031220240027400',
    org: '天府',
    coefficient: 0.7339,
    premium: -170.2,
    customer_type: '非营业个人客车',
    sign_date: '2024-08-20',
  },
  {
    policy_no: '6103011031220240037786',
    org: '青羊',
    coefficient: 1.35,
    premium: -822.24,
    customer_type: '非营业个人客车',
    sign_date: '2024-09-27',
  },
  {
    policy_no: '6103011031220240055017',
    org: '天府',
    coefficient: 0.796,
    premium: 617.55,
    customer_type: '非营业个人客车',
    sign_date: '2024-12-08',
  },
  {
    policy_no: '6103011031220240055075',
    org: '高新',
    coefficient: 0.8,
    premium: 314.42,
    customer_type: '非营业个人客车',
    sign_date: '2024-12-09',
  },
];

/**
 * 各机构汇总统计（真实数据）
 * 用于验证聚合查询结果
 */
export const REAL_ORG_SUMMARY = [
  {
    org: '乐山',
    total_policies: 9590,
    total_premium: 13412999.55,
    avg_premium: 1398.64,
    renewal_count: 635,
    renewal_rate: 6.62,
  },
  {
    org: '天府',
    total_policies: 245235,
    total_premium: 200735897.52,
    avg_premium: 818.55,
    renewal_count: 13171,
    renewal_rate: 5.37,
  },
  {
    org: '宜宾',
    total_policies: 111811,
    total_premium: 33438582.52,
    avg_premium: 299.06,
    renewal_count: 4599,
    renewal_rate: 4.11,
  },
  {
    org: '德阳',
    total_policies: 13821,
    total_premium: 12275154.24,
    avg_premium: 888.15,
    renewal_count: 768,
    renewal_rate: 5.56,
  },
  {
    org: '新都',
    total_policies: 23962,
    total_premium: 43687802.96,
    avg_premium: 1823.21,
    renewal_count: 1145,
    renewal_rate: 4.78,
  },
  {
    org: '武侯',
    total_policies: 15891,
    total_premium: 18277989.45,
    avg_premium: 1150.21,
    renewal_count: 682,
    renewal_rate: 4.29,
  },
  {
    org: '泸州',
    total_policies: 32415,
    total_premium: 14541528.9,
    avg_premium: 448.6,
    renewal_count: 713,
    renewal_rate: 2.2,
  },
  {
    org: '自贡',
    total_policies: 30247,
    total_premium: 9261977.86,
    avg_premium: 306.21,
    renewal_count: 497,
    renewal_rate: 1.64,
  },
  {
    org: '资阳',
    total_policies: 16416,
    total_premium: 10612657.38,
    avg_premium: 646.48,
    renewal_count: 799,
    renewal_rate: 4.87,
  },
  {
    org: '达州',
    total_policies: 3025,
    total_premium: 4369734.93,
    avg_premium: 1444.54,
    renewal_count: 286,
    renewal_rate: 9.45,
  },
  {
    org: '青羊',
    total_policies: 48736,
    total_premium: 47973257.66,
    avg_premium: 984.35,
    renewal_count: 4244,
    renewal_rate: 8.71,
  },
  {
    org: '高新',
    total_policies: 67309,
    total_premium: 70318846.13,
    avg_premium: 1044.72,
    renewal_count: 3565,
    renewal_rate: 5.3,
  },
];

/**
 * 数据统计汇总
 */
export const REAL_DATA_STATISTICS = {
  /** 总记录数 */
  totalRecords: 618502,
  /** 日期范围 */
  dateRange: {
    signDateMin: '2023-11-27',
    signDateMax: '2026-01-14',
    startDateMin: '2023-12-13',
    startDateMax: '2026-04-10',
  },
  /** 险类分布 */
  insuranceTypeDistribution: {
    交强险: 471312,
    商业保险: 147190,
  },
  /** 客户类别分布（前5） */
  customerTypeTop5: {
    非营业个人客车: 363139,
    摩托车: 177693,
    非营业企业客车: 29277,
    非营业货车: 29258,
    营业货车: 17658,
  },
  /** 终端来源分布（前3） */
  terminalSourceTop3: {
    '0106移动展业(App)': 420495,
    '0101柜面': 73932,
    '0110融合销售': 51119,
  },
};

/**
 * 辅助函数：根据机构获取样本数据
 */
export function getSampleByOrg(org: string) {
  return REAL_ORG_SAMPLES.find(s => s.org === org);
}

/**
 * 辅助函数：根据客户类别获取样本数据
 */
export function getSampleByCustomerType(customerType: string) {
  return REAL_CUSTOMER_TYPE_SAMPLES.find(s => s.customer_type === customerType);
}

/**
 * 辅助函数：根据机构获取汇总数据
 */
export function getOrgSummary(org: string) {
  return REAL_ORG_SUMMARY.find(s => s.org === org);
}

/**
 * 辅助函数：获取指定日期范围内的样本
 */
export function getDateSamplesInRange(startDate: string, endDate: string) {
  return REAL_DATE_SAMPLES.filter(s => s.sign_date >= startDate && s.sign_date <= endDate);
}
