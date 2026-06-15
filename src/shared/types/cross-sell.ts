/**
 * 交叉销售相关类型（前端共用，避免直接 import server/）
 *
 * B330 修复：useCrossSellTopSalesman.ts 原从 server/src/sql/cross-sell-top-salesman
 * 跨层 import type，违反前后端边界。将类型定义平迁至 shared/types，前后端
 * 各自维护一份（字面量联合类型，drift 风险极低）。
 */

/** 推介率 TOP20 业务员分析的险种范围（主全 = 主险+全车损；交三 = 交强险+三责） */
export type TopSalesmanCoverage = '主全' | '交三';
