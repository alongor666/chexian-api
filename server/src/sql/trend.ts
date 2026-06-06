/**
 * 保费趋势分析 SQL 生成器 — Barrel Re-export
 *
 * 原 561 行单体文件已拆分为 trend/ 子目录：
 * - trend/shared.ts            — 类型定义、共享常量
 * - trend/premium-trend.ts     — 按机构分组趋势查询
 * - trend/total-trend.ts       — 总体趋势查询
 * - trend/quality-business.ts  — 优质业务占比趋势
 *
 * 此文件保持所有原始导出，调用方零改动。
 */

export * from './trend/shared.js';
export * from './trend/premium-trend.js';
export * from './trend/total-trend.js';
export * from './trend/quality-business.js';
