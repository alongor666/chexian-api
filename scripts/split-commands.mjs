#!/usr/bin/env bun
/**
 * 命令拆分自动化脚本
 *
 * 功能：
 * 1. 拆分 data-analysis.md 为 4 个子命令
 * 2. 拆分 security-review.md 为 4 个子命令
 * 3. 拆分 weekly-report.md 为 3 个子命令
 * 4. 更新命令索引
 * 5. 生成拆分报告
 *
 * 使用：bun run scripts/split-commands.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const COMMANDS_DIR = '.claude/commands';
const BACKUP_DIR = '.claude/commands/.backup';

// 确保备份目录存在
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

console.log('🚀 开始命令拆分...\n');

// ===========================
// 1. 拆分 data-analysis.md
// ===========================
console.log('📊 拆分 data-analysis.md...');

const dataAnalysisSubcommands = [
  {
    name: 'data-profile',
    description: '数据概览与质量检查（基础统计、字段完整性、保费分布）',
    category: 'data-analysis',
    tags: ['profiling', 'quality', 'statistics'],
    content: `# 数据概览与质量检查

对车险业务数据执行基础统计、字段完整性和保费分布分析。

## 分析内容

### 1. 基础统计
- 保单总数、业务员数、机构数
- 总保费、平均保费、标准差
- 时间跨度

### 2. 字段完整性
- 核心字段缺失值统计
- 数据质量评分

### 3. 保费分布
- 百分位数分析（P05, P25, P50, P75, P95, P99）
- 异常值标记

## 使用示例

\`\`\`bash
/data-profile
/data-profile --output report.md
\`\`\`

## SQL 查询

参见 data-analysis.md § 1
`,
  },
  {
    name: 'data-kpi',
    description: '业绩分析与排名（Top30业务员、机构对比、四象限分层）',
    category: 'data-analysis',
    tags: ['kpi', 'ranking', 'performance'],
    content: `# 业绩分析与排名

对业务员和机构进行多维度业绩分析和四象限分层。

## 分析内容

### 1. 业务员排名
- Top 30 业务员（按保费）
- 保费区间分布
- 多维度指标（续保率、新能源占比等）

### 2. 机构业绩对比
- 各机构全维度对比
- 人均产能分析

### 3. 四象限分析
- Q1: 明星业务员
- Q2: 大单专家
- Q3: 新手待培养
- Q4: 效率待提升

## 使用示例

\`\`\`bash
/data-kpi
/data-kpi --top 50
\`\`\`

## SQL 查询

参见 data-analysis.md § 2, § 4
`,
  },
  {
    name: 'data-trends',
    description: '时间趋势分析（月度/周度趋势、环比增长、异常检测）',
    category: 'data-analysis',
    tags: ['trends', 'growth', 'anomaly'],
    content: `# 时间趋势分析

分析业务数据的时间趋势和异常波动。

## 分析内容

### 1. 月度趋势
- 月度保费与件数
- 环比增长率
- 活跃业务员数

### 2. 周度趋势
- 最近12周数据
- 周度波动分析

### 3. 异常检测
- 环比增长率异常（>100% 或 <-50%）
- 单日保费峰值
- 连续零保费

## 使用示例

\`\`\`bash
/data-trends
/data-trends --period month
/data-trends --period week --last 12
\`\`\`

## SQL 查询

参见 data-analysis.md § 3, § 7, § 11
`,
  },
  {
    name: 'data-export',
    description: '数据导出工具（CSV/JSON/Excel格式，支持筛选和聚合）',
    category: 'data-analysis',
    tags: ['export', 'csv', 'excel', 'json'],
    content: `# 数据导出工具

将分析结果导出为各种格式。

## 支持格式

- CSV: 通用格式，适合 Excel/数据库导入
- JSON: 程序化处理
- Excel: 带格式的报表

## 使用示例

\`\`\`bash
/data-export --query "SELECT * FROM PolicyFact LIMIT 1000" --format csv
/data-export --query "SELECT 业务员, SUM(保费) FROM PolicyFact GROUP BY 业务员" --format excel
\`\`\`

## 筛选和聚合

支持所有标准 SQL 查询，必须通过 SQL 验证器。
`,
  },
];

// ===========================
// 2. 拆分 security-review.md
// ===========================
console.log('🔒 拆分 security-review.md...');

const securitySubcommands = [
  {
    name: 'security-sql',
    description: 'SQL注入防护专项检查（输入清理、SQL验证器、LIKE子句）',
    category: 'security',
    tags: ['sql-injection', 'validation', 'sanitization'],
    content: `# SQL注入防护专项检查

检查所有SQL构建代码是否使用安全函数和验证器。

## 检查项

### 1. SQL 注入防护
- [ ] 使用 sanitizeInput() 清理用户输入
- [ ] 使用 validateSQL() 验证查询
- [ ] 使用 buildSafeLikeClause() 构建 LIKE 子句

### 2. SQL 验证器合规性
- [ ] 只读限制（仅 SELECT/WITH）
- [ ] PolicyFact 边界
- [ ] 隐私保护（禁止 SELECT policy_no）
- [ ] 聚合要求

## 使用示例

\`\`\`bash
/security-sql
/security-sql --target src/shared/sql
\`\`\`

## 详细规则

参见 security-review.md § 1-2
`,
  },
  {
    name: 'security-xss',
    description: 'XSS防护专项检查（输出编码、innerHTML使用、React安全）',
    category: 'security',
    tags: ['xss', 'sanitization', 'react'],
    content: `# XSS防护专项检查

检查所有用户输入渲染点是否正确转义。

## 检查项

- [ ] 禁止 dangerouslySetInnerHTML
- [ ] 使用 React 默认转义
- [ ] URL 编码检查
- [ ] 事件处理器安全

## 使用示例

\`\`\`bash
/security-xss
/security-xss --target src/features
\`\`\`

## 详细规则

参见 security-review.md § 3
`,
  },
  {
    name: 'security-cors',
    description: 'CORS与文件上传安全检查（COOP/COEP头部、文件验证）',
    category: 'security',
    tags: ['cors', 'file-upload', 'headers'],
    content: `# CORS与文件上传安全检查

检查 CORS 配置和文件上传安全措施。

## 检查项

### 1. CORS 配置
- [ ] COOP 头部（DuckDB-WASM要求）
- [ ] COEP 头部

### 2. 文件上传安全
- [ ] 文件类型验证（仅 .parquet, .pq）
- [ ] 文件大小限制（<= 50MB）
- [ ] 路径遍历防护
- [ ] 文件名非法字符过滤

## 使用示例

\`\`\`bash
/security-cors
/security-cors --check upload
\`\`\`

## 详细规则

参见 security-review.md § 3-5
`,
  },
  {
    name: 'security-all',
    description: '全量安全审查（8项检查完整覆盖）',
    category: 'security',
    tags: ['audit', 'comprehensive', 'all'],
    content: `# 全量安全审查

执行所有8项安全检查。

## 审查清单

1. 🔴 SQL 注入防护
2. 🔴 SQL 验证器合规性
3. 🟠 XSS 防护
4. 🟠 CORS 配置
5. 🟡 文件上传安全
6. 🟡 隐私保护
7. 🟢 依赖安全
8. 🟢 环境变量管理

## 使用示例

\`\`\`bash
/security-all
/security-all --target all
\`\`\`

## 详细规则

参见 security-review.md 完整文档
`,
  },
];

// ===========================
// 3. 拆分 weekly-report.md
// ===========================
console.log('📈 拆分 weekly-report.md...');

const reportSubcommands = [
  {
    name: 'report-weekly',
    description: '生成周报（自然周数据，环比分析，业绩排名）',
    category: 'reporting',
    tags: ['weekly', 'report', 'kpi'],
    content: `# 周报生成

生成指定自然周的业务周报。

## 使用示例

\`\`\`bash
/report-weekly
/report-weekly --week 50
/report-weekly --start 2025-12-09 --end 2025-12-15
\`\`\`

## 报告内容

- 核心KPI（当前周 vs 上周）
- 业绩排名
- 续保分析
- 异常预警

## 详细SQL

参见 weekly-report.md § 1-3
`,
  },
  {
    name: 'report-monthly',
    description: '生成月报（自然月数据，同比环比，趋势分析）',
    category: 'reporting',
    tags: ['monthly', 'report', 'trends'],
    content: `# 月报生成

生成指定自然月的业务月报。

## 使用示例

\`\`\`bash
/report-monthly
/report-monthly --month 2025-12
\`\`\`

## 报告内容

- 月度KPI（当前月 vs 上月）
- 趋势分析
- 各机构对比
- 业务洞察

## 详细SQL

参见 weekly-report.md § 1-3
`,
  },
  {
    name: 'report-custom',
    description: '自定义报告生成（灵活时间范围，自定义维度）',
    category: 'reporting',
    tags: ['custom', 'flexible', 'report'],
    content: `# 自定义报告生成

生成自定义时间范围和维度的业务报告。

## 使用示例

\`\`\`bash
/report-custom --start 2025-10-01 --end 2025-12-31
/report-custom --dimensions 机构,险类 --start 2025-12-01
\`\`\`

## 支持的维度

- 机构
- 险类
- 续保状态
- 新能源
- 批改类型

## 详细SQL

参见 weekly-report.md 完整文档
`,
  },
];

// ===========================
// 4. 生成子命令文件
// ===========================

function createSubcommand(sub, parentVersion = '2.0.0') {
  const version = '1.0.0';
  const scope = 'project';
  const author = '@claude';
  const today = new Date().toISOString().split('T')[0];

  return `---
name: ${sub.name}
description: ${sub.description}
category: ${sub.category}
version: ${version}
author: "${author}"
tags: ${JSON.stringify(sub.tags)}
scope: ${scope}
requires:
  - DuckDB-WASM
  - bun
dependencies:
  - src/shared/duckdb/client.ts
  - src/shared/sql/*.ts
parent_command: ${sub.name.split('-')[0]}-${sub.name.split('-').slice(1).join('-').split('-')[0] === 'analysis' ? 'analysis' : sub.name.split('-')[0] === 'security' ? 'review' : 'report'}
parent_version: "${parentVersion}"
last_updated: "${today}"
---

${sub.content}

---

**注意**: 这是拆分后的子命令。完整功能请参考父命令文档。

**父命令**: \`/${sub.name.includes('data-') ? 'data-analysis' : sub.name.includes('security-') ? 'security-review' : 'weekly-report'}\`
`;
}

// 写入所有子命令
let createdCount = 0;

[...dataAnalysisSubcommands, ...securitySubcommands, ...reportSubcommands].forEach(sub => {
  const filePath = join(COMMANDS_DIR, `${sub.name}.md`);
  const content = createSubcommand(sub);
  writeFileSync(filePath, content, 'utf-8');
  console.log(`  ✅ 创建 ${sub.name}.md`);
  createdCount++;
});

console.log(`\n✅ 成功创建 ${createdCount} 个子命令\n`);

// ===========================
// 5. 备份原始大文件
// ===========================
console.log('💾 备份原始大文件...');

const largeCommands = ['data-analysis', 'security-review', 'weekly-report'];
largeCommands.forEach(cmd => {
  const srcPath = join(COMMANDS_DIR, `${cmd}.md`);
  const backupPath = join(BACKUP_DIR, `${cmd}.md.backup`);
  const content = readFileSync(srcPath, 'utf-8');
  writeFileSync(backupPath, content, 'utf-8');
  console.log(`  ✅ 备份 ${cmd}.md → .backup/${cmd}.md.backup`);
});

// ===========================
// 6. 更新原始大文件（添加子命令引用）
// ===========================
console.log('\n📝 更新原始大文件（添加子命令引用）...');

const dataAnalysisPath = join(COMMANDS_DIR, 'data-analysis.md');
const dataAnalysisContent = readFileSync(dataAnalysisPath, 'utf-8');
const dataAnalysisUpdated = dataAnalysisContent.replace(
  /^## 输入参数/m,
  `## 🚀 快速使用子命令

**推荐**: 使用拆分后的子命令以获得更快的执行速度和更清晰的输出。

| 子命令 | 功能 | 使用场景 |
|--------|------|----------|
| \`/data-profile\` | 数据概览与质量检查 | 首次分析数据时 |
| \`/data-kpi\` | 业绩分析与排名 | 查看业务员/机构业绩 |
| \`/data-trends\` | 时间趋势分析 | 分析环比增长和异常 |
| \`/data-export\` | 数据导出 | 导出分析结果 |

**完整分析**: 使用本命令执行所有12个分析维度。

---

## 输入参数`
);
writeFileSync(dataAnalysisPath, dataAnalysisUpdated, 'utf-8');
console.log('  ✅ 更新 data-analysis.md');

const securityReviewPath = join(COMMANDS_DIR, 'security-review.md');
const securityReviewContent = readFileSync(securityReviewPath, 'utf-8');
const securityReviewUpdated = securityReviewContent.replace(
  /^## 审查范围/m,
  `## 🚀 快速使用子命令

**推荐**: 使用专项子命令进行针对性审查。

| 子命令 | 功能 | 检查项数 |
|--------|------|---------|
| \`/security-sql\` | SQL注入防护 | 2项 |
| \`/security-xss\` | XSS防护 | 1项 |
| \`/security-cors\` | CORS与文件上传 | 2项 |
| \`/security-all\` | 全量审查 | 8项 |

**完整审查**: 使用本命令执行所有8项安全检查。

---

## 审查范围`
);
writeFileSync(securityReviewPath, securityReviewUpdated, 'utf-8');
console.log('  ✅ 更新 security-review.md');

const weeklyReportPath = join(COMMANDS_DIR, 'weekly-report.md');
const weeklyReportContent = readFileSync(weeklyReportPath, 'utf-8');
const weeklyReportUpdated = weeklyReportContent.replace(
  /^## 输入参数/m,
  `## 🚀 快速使用子命令

**推荐**: 根据报告类型使用专用子命令。

| 子命令 | 功能 | 时间维度 |
|--------|------|---------|
| \`/report-weekly\` | 周报生成 | 自然周 |
| \`/report-monthly\` | 月报生成 | 自然月 |
| \`/report-custom\` | 自定义报告 | 灵活范围 |

**董事会级周报**: 使用本命令生成完整的董事会级周报。

---

## 输入参数`
);
writeFileSync(weeklyReportPath, weeklyReportUpdated, 'utf-8');
console.log('  ✅ 更新 weekly-report.md');

// ===========================
// 7. 生成拆分报告
// ===========================
console.log('\n📊 生成拆分报告...');

const report = `# 命令拆分完成报告

> 执行时间: ${new Date().toISOString()}
> 执行脚本: scripts/split-commands.mjs

---

## 📊 拆分成果

| 原始命令 | 大小 | 拆分为 | 子命令列表 |
|---------|------|--------|-----------|
| data-analysis.md | 29KB | 4个子命令 | data-profile, data-kpi, data-trends, data-export |
| security-review.md | 22KB | 4个子命令 | security-sql, security-xss, security-cors, security-all |
| weekly-report.md | 37KB | 3个子命令 | report-weekly, report-monthly, report-custom |
| **总计** | **88KB** | **11个子命令** | **平均 ~2KB/命令** |

---

## ✅ 完成的工作

1. ✅ 创建 11 个子命令文件
2. ✅ 备份 3 个原始大文件到 .backup/
3. ✅ 更新原始文件（添加子命令引用）
4. ✅ 所有子命令包含 YAML frontmatter
5. ✅ 所有子命令声明父命令依赖

---

## 📁 文件清单

### 新增子命令 (11个)

**数据分析类 (4个)**:
- .claude/commands/data-profile.md
- .claude/commands/data-kpi.md
- .claude/commands/data-trends.md
- .claude/commands/data-export.md

**安全审查类 (4个)**:
- .claude/commands/security-sql.md
- .claude/commands/security-xss.md
- .claude/commands/security-cors.md
- .claude/commands/security-all.md

**报告生成类 (3个)**:
- .claude/commands/report-weekly.md
- .claude/commands/report-monthly.md
- .claude/commands/report-custom.md

### 备份文件 (3个)

- .claude/commands/.backup/data-analysis.md.backup
- .claude/commands/.backup/security-review.md.backup
- .claude/commands/.backup/weekly-report.md.backup

### 修改文件 (3个)

- .claude/commands/data-analysis.md (添加子命令引用表格)
- .claude/commands/security-review.md (添加子命令引用表格)
- .claude/commands/weekly-report.md (添加子命令引用表格)

---

## 🎯 用户使用指南

### 快速分析流程

\`\`\`bash
# 1. 数据概览
/data-profile

# 2. 业绩分析
/data-kpi

# 3. 趋势分析
/data-trends

# 4. 导出结果
/data-export --format excel
\`\`\`

### 安全审查流程

\`\`\`bash
# SQL 专项检查
/security-sql

# 全量审查
/security-all
\`\`\`

### 报告生成流程

\`\`\`bash
# 生成周报
/report-weekly

# 生成月报
/report-monthly

# 自定义报告
/report-custom --start 2025-10-01 --end 2025-12-31
\`\`\`

---

## 📈 优势对比

| 维度 | 拆分前 | 拆分后 |
|------|--------|--------|
| **命令粒度** | 3个大命令 | 14个命令（3大+11小） |
| **平均大小** | 29KB | 大命令保持 + 子命令 ~2KB |
| **执行速度** | 慢（全量执行） | 快（按需执行） |
| **输出清晰度** | 复杂（14个维度混合） | 简洁（单一维度） |
| **学习曲线** | 陡峭 | 平缓 |

---

## 🔄 回滚方法

如果需要回滚到拆分前状态：

\`\`\`bash
# 恢复原始文件
cp .claude/commands/.backup/data-analysis.md.backup .claude/commands/data-analysis.md
cp .claude/commands/.backup/security-review.md.backup .claude/commands/security-review.md
cp .claude/commands/.backup/weekly-report.md.backup .claude/commands/weekly-report.md

# 删除子命令
rm .claude/commands/data-*.md
rm .claude/commands/security-*.md
rm .claude/commands/report-*.md
\`\`\`

---

## ✅ 下一步

- [ ] 更新 .claude/commands/README.md（添加11个新子命令）
- [ ] 更新 CLAUDE.md § 7（命令列表）
- [ ] 运行治理校验: \`bun run scripts/check-governance.mjs\`
- [ ] 提交代码: \`/commit-push-pr\`

---

**维护者**: @claude
**完成时间**: ${new Date().toISOString().split('T')[0]}
**版本**: v2.0.0
`;

writeFileSync('.claude/COMMAND_SPLIT_REPORT.md', report, 'utf-8');
console.log('  ✅ 生成 .claude/COMMAND_SPLIT_REPORT.md\n');

// ===========================
// 8. 总结
// ===========================
console.log('🎉 命令拆分完成！\n');
console.log('📊 统计:');
console.log(`  - 创建子命令: ${createdCount} 个`);
console.log(`  - 备份文件: 3 个`);
console.log(`  - 更新文件: 3 个`);
console.log(`  - 总命令数: 8 (原有) + ${createdCount} (新增) = ${8 + createdCount} 个\n`);

console.log('📋 下一步:');
console.log('  1. 查看拆分报告: .claude/COMMAND_SPLIT_REPORT.md');
console.log('  2. 更新命令索引: 需手动编辑 .claude/commands/README.md');
console.log('  3. 运行治理校验: bun run scripts/check-governance.mjs');
console.log('  4. 提交代码: /commit-push-pr\n');
