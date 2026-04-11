/**
 * 成本分析 SQL 生成器 — Barrel Re-export
 *
 * 原 996 行单体文件已拆分为 cost/ 子目录：
 * - cost/shared.ts       — 类型、常量、维度映射
 * - cost/cost-ratios.ts  — 4 种核心成本率（赔付/费用/综合/变动）
 * - cost/earned-premium.ts       — 滚动12个月已赚保费 + V3 包装器
 * - cost/earned-premium-detail.ts — 月度已赚明细 + 费用查询
 *
 * 此文件保持所有原始导出，调用方零改动。
 */

export * from './cost/shared.js';
export * from './cost/cost-ratios.js';
export * from './cost/earned-premium.js';
export * from './cost/earned-premium-detail.js';
