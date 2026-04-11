/**
 * 增长率分析 SQL 生成器 — Barrel Re-export
 *
 * 原 690 行单体文件已拆分为 growth/ 子目录：
 * - growth/shared.ts        — 类型、常量、辅助函数
 * - growth/yoy.ts           — 同比增长率查询
 * - growth/mom.ts           — 环比增长率查询
 * - growth/ytd.ts           — 年累计增长率查询
 * - growth/custom.ts        — 自定义比较 + 综合查询 + 预设配置
 * - growth/dual-metric.ts   — 双指标对比查询
 *
 * 此文件保持所有原始导出，调用方零改动。
 */

export { type GrowthType, type TimeView, type GrowthConfig } from './growth/shared.js';
export * from './growth/yoy.js';
export * from './growth/mom.js';
export * from './growth/ytd.js';
export * from './growth/custom.js';
export * from './growth/dual-metric.js';
