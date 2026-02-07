/**
 * KPI 详细数据 SQL 生成器
 *
 * 用途：为占比类指标生成分解数据（用于迷你环形图可视化）
 *
 * 数据口径：
 * - 承保口径（默认）：仅统计 premium > 0 的记录
 * - 净额口径：包含正/零/负保费，反映财务净值
 *
 * 关联文档：开发文档/KPI口径说明.md
 */

export interface KpiDetailResult {
  // 基础 KPI（数值类）
  total_premium: number | bigint;
  policy_count: number | bigint;
  per_capita_premium: number | bigint;

  // 过户占比（分解数据）
  transfer_count: number | bigint;
  non_transfer_count: number | bigint;

  // 电销占比（分解数据）
  telesales_count: number | bigint;
  non_telesales_count: number | bigint;

  // 续保占比（分解数据）
  renewal_count: number | bigint;
  non_renewal_count: number | bigint;

  // 商业险占比（分解数据）
  commercial_premium: number | bigint;
  non_commercial_premium: number | bigint;

  // 新能源占比（分解数据）
  nev_count: number | bigint;
  non_nev_count: number | bigint;

  // 新车占比（分解数据）
  new_car_count: number | bigint;
  non_new_car_count: number | bigint;
}

/**
 * 生成 KPI 详细数据查询
 *
 * @param whereClause - WHERE 子句（默认 '1=1'）
 * @param useInsuredScope - 是否使用承保口径（默认 true）
 * @returns SQL 查询字符串
 */
export const generateKpiDetailQuery = (
  whereClause: string = '1=1',
  useInsuredScope: boolean = true
): string => {
  // 承保口径：仅统计 premium > 0
  // 净额口径：包含所有保费（正/零/负）
  const scopeFilter = useInsuredScope ? 'AND premium > 0' : '';

  return `
    SELECT
      -- 基础 KPI（数值类）
      SUM(premium) as total_premium,
      COUNT(DISTINCT policy_no) as policy_count,
      SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium,

      -- 过户占比（分解数据）
      COUNT(CASE WHEN is_transfer THEN 1 END) as transfer_count,
      COUNT(CASE WHEN NOT is_transfer THEN 1 END) as non_transfer_count,

      -- 电销占比（分解数据）
      COUNT(CASE WHEN is_telemarketing THEN 1 END) as telesales_count,
      COUNT(CASE WHEN NOT is_telemarketing THEN 1 END) as non_telesales_count,

      -- 续保占比（分解数据）
      COUNT(CASE WHEN is_renewal THEN 1 END) as renewal_count,
      COUNT(CASE WHEN NOT is_renewal THEN 1 END) as non_renewal_count,

      -- 商业险占比（分解数据 - 使用保费作为度量）
      SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) as commercial_premium,
      SUM(CASE WHEN insurance_type != '商业保险' THEN premium ELSE 0 END) as non_commercial_premium,

      -- 新能源占比（分解数据）
      COUNT(CASE WHEN is_nev THEN 1 END) as nev_count,
      COUNT(CASE WHEN NOT is_nev THEN 1 END) as non_nev_count,

      -- 新车占比（分解数据）
      COUNT(CASE WHEN is_new_car THEN 1 END) as new_car_count,
      COUNT(CASE WHEN NOT is_new_car THEN 1 END) as non_new_car_count
    FROM PolicyFact
    WHERE ${whereClause} ${scopeFilter}
  `;
};

/**
 * 辅助函数：计算占比百分比
 *
 * @param part - 部分值
 * @param total - 总计值
 * @returns 百分比（0-1之间的小数）
 */
export const calculateRate = (part: number, total: number): number => {
  if (total === 0 || total === null || total === undefined) {
    return 0;
  }
  return part / total;
};

/**
 * 辅助函数：从 KpiDetailResult 提取环形图数据
 *
 * @param kpiDetail - KPI详细数据结果
 * @param type - 指标类型（'transfer' | 'telesales' | 'renewal' | 'commercial' | 'nev' | 'new_car'）
 * @returns 环形图数据数组
 */
export const extractDonutData = (
  kpiDetail: KpiDetailResult,
  type: 'transfer' | 'telesales' | 'renewal' | 'commercial' | 'nev' | 'new_car'
): Array<{ label: string; value: number }> => {
  // 辅助函数：将 bigint 转换为 number
  const toNumber = (value: number | bigint): number =>
    typeof value === 'bigint' ? Number(value) : value;

  switch (type) {
    case 'transfer':
      return [
        { label: '过户', value: toNumber(kpiDetail.transfer_count || 0) },
        { label: '非过户', value: toNumber(kpiDetail.non_transfer_count || 0) },
      ];
    case 'telesales':
      return [
        { label: '电销', value: toNumber(kpiDetail.telesales_count || 0) },
        { label: '非电销', value: toNumber(kpiDetail.non_telesales_count || 0) },
      ];
    case 'renewal':
      return [
        { label: '续保', value: toNumber(kpiDetail.renewal_count || 0) },
        { label: '非续保', value: toNumber(kpiDetail.non_renewal_count || 0) },
      ];
    case 'commercial':
      return [
        { label: '商业险', value: toNumber(kpiDetail.commercial_premium || 0) },
        { label: '非商业险', value: toNumber(kpiDetail.non_commercial_premium || 0) },
      ];
    case 'nev':
      return [
        { label: '新能源', value: toNumber(kpiDetail.nev_count || 0) },
        { label: '非新能源', value: toNumber(kpiDetail.non_nev_count || 0) },
      ];
    case 'new_car':
      return [
        { label: '新车', value: toNumber(kpiDetail.new_car_count || 0) },
        { label: '非新车', value: toNumber(kpiDetail.non_new_car_count || 0) },
      ];
    default:
      return [];
  }
};
