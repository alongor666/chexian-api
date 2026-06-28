#!/usr/bin/env bun
/**
 * 从指标注册表生成指标字典文档
 *
 * 输出：开发文档/指标字典.md
 *
 * 用法：
 *   bun scripts/metric-registry/generate-metric-doc.ts          # 生成/更新文档
 *   bun scripts/metric-registry/generate-metric-doc.ts --check  # 只校验不写入（governance 用，不一致 exit 1）
 *
 * ⚠️ 分类标签与顺序（防回归设计，2026-06-27 修复长期 drift）：
 *   - CATEGORY_LABELS 是 Record<MetricCategory, string>，类型强制覆盖全部分类
 *     —— 在 types.ts 新增分类后此处不补标签会 tsc 编译报错（编译期防回归）。
 *   - 分类输出顺序直接取自 getAllMetrics() 的自然顺序（= index.ts ALL_METRICS 拼接顺序），
 *     新增分类自动纳入，不再硬编码 CATEGORY_ORDER（运行期防回归）。
 *   - 不写"生成时间"：codegen 产物逐字节稳定，--check 才能可靠比对，避免每日伪 drift。
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllMetrics, getRegistryStats } from '../../server/src/config/metric-registry/index.js';
import type { MetricCategory } from '../../server/src/config/metric-registry/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

// 分类中文标签 —— Record<MetricCategory, string> 强制覆盖全部分类。
// types.ts 新增分类后此处缺标签 → tsc 编译报错（编译期防回归，根治历史 5/9 分类遗漏 bug）。
const CATEGORY_LABELS: Record<MetricCategory, string> = {
  foundation: '基础指标',
  ratio: '比率指标',
  cost: '成本指标',
  cross_sell: '交叉销售指标',
  growth: '增长指标',
  repair: '维修资源指标',
  plan: '计划达成指标',
  structure: '业务结构指标',
  renewal: '续保分析指标',
};

const metrics = getAllMetrics();
const stats = getRegistryStats();

// 按分类分组（Map 迭代序 = 插入序 = getAllMetrics() 自然分类顺序）
const grouped = new Map<MetricCategory, typeof metrics[number][]>();
for (const m of metrics) {
  const list = grouped.get(m.category) ?? [];
  list.push(m);
  grouped.set(m.category, list);
}

// 分类输出顺序 = 注册表中各分类首次出现的顺序（动态推导，新增分类自动覆盖）
const categoryOrder = [...grouped.keys()];

let md = `# 指标字典

> 从指标注册表自动生成，不要手动编辑
>
> 生成命令：\`bun scripts/metric-registry/generate-metric-doc.ts\`
>
> 注册表位置：\`server/src/config/metric-registry/\`

## 概览

| 分类 | 数量 |
|------|------|
${categoryOrder.map((cat) => `| ${CATEGORY_LABELS[cat] ?? cat} | ${stats.byCategory[cat] ?? 0} |`).join('\n')}
| **总计** | **${stats.total}** |

---

`;

for (const cat of categoryOrder) {
  const list = grouped.get(cat);
  if (!list?.length) continue;

  md += `## ${CATEGORY_LABELS[cat] ?? cat}\n\n`;

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
const checkOnly = process.argv.includes('--check');
const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';

if (md === existing) {
  console.log(`✓ 指标字典.md 已与注册表同步（${stats.total} 个指标）`);
} else if (checkOnly) {
  console.error(
    `✗ 指标字典.md 与注册表不同步 — 运行 bun scripts/metric-registry/generate-metric-doc.ts 重新生成`
  );
  process.exit(1);
} else {
  writeFileSync(outPath, md, 'utf-8');
  console.log(`✓ 已生成 ${outPath}`);
  console.log(`  ${stats.total} 个指标`);
}
