#!/usr/bin/env npx tsx
/**
 * 从指标注册表生成前端映射文件
 *
 * 输出：src/shared/config/metric-display-map.ts
 * 包含：METRIC_LABEL_MAP + METRIC_FORMATTER_MAP
 *
 * 用法：npx tsx scripts/metric-registry/generate-frontend-map.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllMetrics, getRegistryStats } from '../../server/src/config/metric-registry/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

const metrics = getAllMetrics();
const stats = getRegistryStats();

// 生成标签映射
const labelEntries = metrics
  .map((m) => `  '${m.id}': '${m.display.label}',`)
  .join('\n');

// 生成格式化器映射
const formatterEntries = metrics
  .map((m) => {
    const parts = [`formatter: '${m.display.formatter}'`];
    if (m.display.unit) parts.push(`unit: '${m.display.unit}'`);
    if (m.display.decimals !== undefined) parts.push(`decimals: ${m.display.decimals}`);
    return `  '${m.id}': { ${parts.join(', ')} },`;
  })
  .join('\n');

// 生成公式映射
const formulaEntries = metrics
  .map((m) => `  '${m.id}': '${m.formula.description}',`)
  .join('\n');

const output = `/**
 * 指标展示映射 — 从注册表自动生成
 *
 * 生成命令：npx tsx scripts/metric-registry/generate-frontend-map.ts
 * 生成时间：${new Date().toISOString()}
 * 指标数量：${stats.total}
 *
 * ⚠ 不要手动编辑此文件，修改注册表后重新生成
 */

/** 指标 ID → 中文标签 */
export const METRIC_LABEL_MAP: Record<string, string> = {
${labelEntries}
} as const;

/** 指标 ID → 格式化配置 */
export const METRIC_FORMATTER_MAP: Record<string, {
  formatter: string;
  unit?: string;
  decimals?: number;
}> = {
${formatterEntries}
} as const;

/** 指标 ID → 公式描述 */
export const METRIC_FORMULA_MAP: Record<string, string> = {
${formulaEntries}
} as const;
`;

const outPath = resolve(ROOT, 'src/shared/config/metric-display-map.ts');
writeFileSync(outPath, output, 'utf-8');
console.log(`✓ 已生成 ${outPath}`);
console.log(`  ${stats.total} 个指标, 分类: ${JSON.stringify(stats.byCategory)}`);
