/**
 * 业务分类条件 SQL 片段 — 单一事实源（SSOT）
 *
 * 背景（B301）：优质业务定义此前在 kpi.ts / trend/shared.ts / salesman-ranking.ts
 * 三处独立定义，且 salesman-ranking.ts 的口径（网约车/出租车等营业客车）与
 * kpi/trend 的口径（非营业客车）语义相反，横向对比会得出错误结论。
 *
 * 经业务确认（2026-05-31）：以 kpi/trend 口径为准统一。本文件为唯一定义源，
 * 所有模块必须从此处 import，禁止再各自定义。
 *
 * 业务规则字典（数据管理/knowledge/rules/车险数据业务规则字典.md）暂无「优质业务」
 * 权威定义，本口径以代码层 kpi/trend 既有实现为准；若字典后续补充以字典为准。
 */

/**
 * 优质业务定义条件 SQL 片段
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为 1 吨以下或 2-9 吨
 */
export const QUALITY_BUSINESS_CONDITION = `
  (
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;
