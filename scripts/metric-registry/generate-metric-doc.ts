#!/usr/bin/env bun
/**
 * 从指标注册表生成指标字典文档
 *
 * 输出：开发文档/指标字典.md
 *
 * 用法：bun scripts/metric-registry/generate-metric-doc.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllMetrics, getRegistryStats } from '../../server/src/config/metric-registry/index.js';
import type { MetricCategory } from '../../server/src/config/metric-registry/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

const CATEGORY_LABELS: Record<MetricCategory, string> = {
  foundation: '基础指标',
  ratio: '比率指标',
  cost: '成本指标',
  cross_sell: '交叉销售指标',
  growth: '增长指标',
};

const metrics = getAllMetrics();
const stats = getRegistryStats();

// 按分类分组
const grouped = new Map<MetricCategory, typeof metrics[number][]>();
for (const m of metrics) {
  const list = grouped.get(m.category) ?? [];
  list.push(m);
  grouped.set(m.category, list);
}

let md = `# 指标字典

> 从指标注册表自动生成，不要手动编辑
>
> 生成命令：\`bun scripts/metric-registry/generate-metric-doc.ts\`
>
> 生成时间：${new Date().toISOString().slice(0, 10)}
>
> 注册表位置：\`server/src/config/metric-registry/\`

## 概览

| 分类 | 数量 |
|------|------|
${Object.entries(stats.byCategory).map(([cat, count]) => `| ${CATEGORY_LABELS[cat as MetricCategory] ?? cat} | ${count} |`).join('\n')}
| **总计** | **${stats.total}** |

---

`;

const CATEGORY_ORDER: MetricCategory[] = ['foundation', 'ratio', 'cost', 'cross_sell', 'growth'];

for (const cat of CATEGORY_ORDER) {
  const list = grouped.get(cat);
  if (!list?.length) continue;

  md += `## ${CATEGORY_LABELS[cat]}\n\n`;

  for (const m of list) {
    md += `### ${m.name} (\`${m.id}\`)\n\n`;
    md += `- **版本**: ${m.version}\n`;
    md += `- **标签**: ${m.tags.join(', ')}\n`;
    md += `- **单位**: ${m.formula.unit}\n`;
    md += `- **公式**: ${m.formula.description}\n`;
    if (m.formula.numerator) md += `  - 分子: ${m.formula.numerator}\n`;
    if (m.formula.denominator) md += `  - 分母: ${m.formula.denominator}\n`;
    md += `- **展示**: ${m.display.label} (${m.display.formatter}${m.display.unit ? `, ${m.display.unit}` : ''})\n`;
    if (m.sql.notes) md += `- **注意**: ${m.sql.notes}\n`;

    md += `\n\`\`\`sql\n${m.sql.expression}\n\`\`\`\n\n`;

    // changelog
    if (m.changelog.length > 0) {
      md += '**变更历史**:\n';
      for (const v of m.changelog) {
        md += `- v${v.version} (${v.date}): ${v.changes}\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }
}

const outPath = resolve(ROOT, '开发文档/指标字典.md');
writeFileSync(outPath, md, 'utf-8');
console.log(`✓ 已生成 ${outPath}`);
console.log(`  ${stats.total} 个指标`);
