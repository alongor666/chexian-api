/**
 * 交叉销售 SQL 生成器 — 共享类型与辅助函数
 *
 * 从 cross-sell-summary.ts 提取，供全部 6 个 cross-sell SQL 模块共用：
 *   - cross-sell.ts
 *   - cross-sell-summary.ts
 *   - cross-sell-trend.ts
 *   - cross-sell-org-trend.ts
 *   - cross-sell-heatmap.ts
 *   - cross-sell-top-salesman.ts
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 车辆类别过滤 */
export type VehicleCategory = 'all' | 'passenger' | 'truck' | 'motorcycle';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 根据车辆类别返回 WHERE 过滤子句（无表前缀）
 */
export function getVehicleCategoryFilter(category: VehicleCategory, colPrefix = ''): string {
  if (category === 'all') return '1=1';
  switch (category) {
    case 'passenger':
      return `${colPrefix}customer_category IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')`;
    case 'truck':
      return `${colPrefix}customer_category LIKE '%货车%'`;
    case 'motorcycle':
      return `${colPrefix}customer_category = '摩托车'`;
  }
}

/**
 * 生成 is_cross_sell 字段的真值判断 SQL 表达式
 *
 * 与 performance-analysis/shared.ts::truthyExpr 相同逻辑，
 * 专为 cross-sell 语境封装，避免循环依赖。
 *
 * @param fieldExpr - 字段表达式，如 'is_cross_sell' 或 'p.is_cross_sell'
 */
export function crossSellTruthyExpr(fieldExpr: string): string {
  return `(
    TRY_CAST(${fieldExpr} AS BOOLEAN) = true
    OR LOWER(TRIM(CAST(${fieldExpr} AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
  )`;
}
