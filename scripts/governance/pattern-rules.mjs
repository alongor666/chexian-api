#!/usr/bin/env node

/**
 * 治理「禁止模式族」规则表（governance 奥卡姆批次二，2026-07-05，backlog 2026-07-05-claude-e52a30）
 *
 * 每条规则的 pattern / 豁免语义 逐一保真移植自 check-governance.mjs 中被替换的手写函数
 * （历史实现见 git：checkDC002Compliance / checkEtlMultiSheetCompliance / checkEmptyCatchBlocks /
 * checkSalesmanAggKeyCaliber / checkFilterParamsBypass / checkBundleRoutesGuard /
 * checkCubeRoutesSSOT / checkBranchCodeFallbackAntipattern）。
 * 红绿 fixture 对照见 scripts/__tests__/pattern-engine.test.mjs——每条规则一红一绿，
 * 证明迁移后拦截能力不降。
 *
 * schema 说明见 pattern-engine.mjs 头注释。同 group 多条规则聚合为一个 governance 检查项。
 */

// —— 筛选参数绕过：buildFilterParams 产出的参数名清单（原 checkFilterParamsBypass 逐字保留）——
const FILTER_PARAM_NAMES =
  'customerCategories|coverageCombinations|renewalModes|tonnageSegments|insuranceGrades|isRenewal|isNewCar|isTransfer|isNev|isTelemarketing|insuranceType|isCommercialInsure|isRenewable|isCrossSell|vehicleQuickFilter|enterpriseCar|businessNature|fuelCategory';

const COMMENT_LINE = [/^\s*\/\//, /^\s*\*/];

export const PATTERN_RULES = [
  // ============================================================
  // DC-002 合规（B106+B107 · 用户筛选优先）——3 条子规则聚合为一项
  // ============================================================
  {
    id: 'dc002-current-date',
    group: 'DC-002合规',
    intro: '检查 DC-002 合规性（用户筛选优先规则）...',
    kind: 'line',
    roots: ['src/shared/sql'],
    maxDepth: 0, // 原实现 readdirSync 非递归
    includeFile: (_rel, name) => name.endsWith('.ts'),
    patterns: [/CURRENT_DATE|current_date|CURDATE\(\)|NOW\(\)/i],
    linePreExempt: [...COMMENT_LINE, 'DC-002', '禁止'],
    allowContext: { pattern: 'DC-002 Exception', lines: 2 },
    firstHitPerFile: true,
    desc: '硬编码 CURRENT_DATE，违反 DC-002 §2.3',
    errorHeader: 'DC-002 合规性检查失败',
    skipWhenAllRootsMissing: 'src/shared/sql 目录不存在，跳过 DC-002 检查',
    fixHints: ['修复：日期一律从 filters 读取；确属合法例外在上一行加 // DC-002 Exception: <理由>'],
  },
  {
    id: 'dc002-or-filters',
    group: 'DC-002合规',
    kind: 'line',
    roots: ['src/shared/sql'],
    maxDepth: 0,
    includeFile: (_rel, name) => name.endsWith('.ts'),
    patterns: [/\|\|/],
    lineFilter: (line) => line.includes('filters.') || line.includes('policy_date'),
    linePreExempt: [...COMMENT_LINE, 'DC-002', 'Exception'],
    // 日期字段用 || 是 error（?? 语义差异会吞掉用户筛选），其余 filters 字段仅警告
    classify: (line) => (line.includes('startDate') || line.includes('endDate') ? 'error' : 'warning'),
    desc: '用 || 判断 filters 字段，DC-002 §2.1 要求 ??',
  },
  {
    id: 'dc002-optional-date',
    group: 'DC-002合规',
    kind: 'line',
    roots: ['src/shared/sql'],
    maxDepth: 0,
    includeFile: (_rel, name) => name.endsWith('.ts'),
    patterns: [/(startDate|endDate|start_date|end_date)\s*:\s*string\s*\?/],
    linePreExempt: ['DC-002'],
    firstHitPerFile: true,
    desc: '函数签名含可选日期参数，违反 DC-002 §2.4，应从 filters 读取',
  },

  // ============================================================
  // ETL 多 sheet 加载规范（governance 原 #24）
  // ============================================================
  {
    id: 'etl-multisheet',
    group: 'ETL多sheet规范',
    intro: '检查 ETL 管道是否使用 load_excel_all_sheets...',
    kind: 'line',
    roots: ['数据管理/pipelines'],
    maxDepth: 0, // 原实现只扫 pipelines/ 顶层
    includeFile: (_rel, name) => name.startsWith('convert_') || name === 'quote_etl.py',
    patterns: [/pd\.read_excel\s*\(/],
    linePreExempt: [/^\s*#/],
    desc: '裸 pd.read_excel()，多 sheet 续表会静默丢数据',
    errorHeader: 'ETL 多 sheet 加载规范检查失败',
    skipWhenAllRootsMissing: '数据管理/pipelines 目录不存在，跳过检查',
    fixHints: ['修复：改用 from pipelines.etl_validation import load_excel_all_sheets'],
  },

  // ============================================================
  // 空 catch 块禁令（静默失败 Law 1，原 #25）
  // ============================================================
  {
    id: 'empty-catch',
    group: '空catch禁令',
    intro: '检查空 catch 块（静默失败 Law 1）...',
    kind: 'content',
    roots: ['server/src', 'src'],
    includeFile: (_rel, name) => /\.(ts|tsx)$/.test(name),
    contentPattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/g,
    errorHeader: '发现空 catch 块（吞异常无痕迹）',
    fixHints: [
      '修复：catch 内至少记日志（含上下文），并重抛或返回带错误标记的结果',
      '依据：.claude/skills/silent-failure-guard.md 五律 Law 1',
    ],
  },

  // ============================================================
  // 业务员聚合键口径（2026-06-27 口径修复防回归，PR #830）
  // ============================================================
  {
    id: 'salesman-aggkey',
    group: '业务员聚合键口径',
    intro: '检查业务员聚合键口径（server/src/sql 禁去工号短名做聚合/JOIN/下钻键）...',
    kind: 'line',
    roots: ['server/src/sql'],
    excludeDirs: ['__tests__'],
    includeFile: (_rel, name) => /\.ts$/.test(name),
    patterns: [/REGEXP_REPLACE\([^)]*salesman_name/],
    allowMarker: /governance-allow:\s*salesman-aggkey/,
    desc: '同名不同工号真人会被合并',
    errorHeader: '发现业务员去工号短名做键（同名不同工号真人会被合并）',
    fixHints: [
      '修复：聚合/JOIN/下钻键改回带工号 salesman_name（人唯一键）；',
      'UI 短名从 group_name/dimension_name 别名去工号（display_name 列），勿直接对 salesman_name 列去工号。',
      '口径：数据管理/knowledge/rules/车险数据业务规则字典.md §业务员（聚合键 vs 展示口径 RED LINE）',
      '样板：server/src/sql/performance-analysis/*（PR #830）；逃生阀：governance-allow: salesman-aggkey <理由>',
    ],
  },

  // ============================================================
  // 筛选参数绕过（治理计划 2026-06-10 Task 1-D）
  // ============================================================
  {
    id: 'filter-params-bypass',
    group: '筛选参数绕过',
    intro: '检查筛选参数绕过（features/ 禁手写 buildFilterParams 产出的参数名赋值）...',
    kind: 'line',
    roots: ['src/features'],
    excludeDirs: ['__tests__'],
    includeFile: (_rel, name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name),
    // =(?!=) 负向断言：排除 ==/=== 比较，兼容赋值号在行尾的 prettier 断行风格
    patterns: [
      new RegExp(`\\.(${FILTER_PARAM_NAMES})\\s*=(?!=)`),
      new RegExp(`\\[\\s*['"](${FILTER_PARAM_NAMES})['"]\\s*\\]\\s*=(?!=)`),
    ],
    allowMarker: 'governance-allow: filter-params-mapping',
    errorHeader: '发现手写筛选参数映射（绕过 buildFilterParams）',
    fixHints: [
      '修复：改用 src/shared/utils/filterParams.ts:buildFilterParams（唯一事实源）',
      '确需按后端能力裁剪的映射层：命中行或上一行加 // governance-allow: filter-params-mapping',
      '依据：开发文档/筛选器联动治理计划_2026-06-10.md Task 1-D',
    ],
  },

  // ============================================================
  // Bundle 路由开关合规（PR #477 codex review 教训）
  // ============================================================
  {
    id: 'bundle-routes-guard',
    group: 'Bundle路由开关合规',
    intro: '检查 Bundle 路由开关合规（usePerformanceBundle 调用方须遵守 ENABLE_BUNDLE_ROUTES）...',
    kind: 'file-cond',
    roots: ['src'],
    includeFile: (rel, name) =>
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith('usePerformanceBundle.ts') &&
      !rel.includes('__tests__') &&
      !/\.test\.(ts|tsx)$/.test(name),
    triggerPattern: /\busePerformanceBundle\s*\(/,
    requiredPattern: /\bENABLE_BUNDLE_ROUTES\b/,
    condDesc: '调用 usePerformanceBundle 但未引用 ENABLE_BUNDLE_ROUTES（legacy 部署会 503 红卡）',
    errorHeader: 'Bundle 路由开关缺失',
    fixHints: [
      '修复：import { ENABLE_BUNDLE_ROUTES } from "@/shared/api/client";',
      '然后 usePerformanceBundle({ ..., enabled: <existing-condition> && ENABLE_BUNDLE_ROUTES })',
      '并在 render 阶段 if (!ENABLE_BUNDLE_ROUTES) 走 legacy fallback 或隐藏。',
      '依据：PR #477 codex review line 190；现有遵守者：PerformanceAnalysisPanel.tsx / PremiumDashboard.tsx',
    ],
  },

  // ============================================================
  // 5 路由清单 SSOT（PR #653 漏改 cube-promote-judge 教训）
  // ============================================================
  {
    id: 'cube-routes-ssot',
    group: '5路由清单SSOT',
    intro: '检查 5 路由清单 SSOT 漂移防回归（PR #653 教训）...',
    kind: 'content',
    roots: ['scripts', 'server/src'],
    includeFile: (rel, name) => /\.(mjs|js|ts)$/.test(name) && !rel.includes('__tests__'),
    exemptFiles: ['scripts/shared/cube-routes.mjs', 'scripts/governance/pattern-rules.mjs'],
    // 限定数组字面量：必须 [ 开头才报（防注释里的提示文字误命中）
    contentPattern:
      /\[\s*['"]trend['"]\s*,\s*['"]growth['"]\s*,\s*['"]cost['"]\s*,\s*['"]kpi['"]\s*,\s*['"]salesman-ranking['"]\s*\]/,
    desc: 'inline 定义 5 路由字面量数组',
    errorHeader: '5 路由清单 SSOT 漂移：以下文件 inline 定义了 5 路由字面量',
    fixHints: [
      '修复：从 scripts/shared/cube-routes.mjs import { SHADOW_KEYS } 或 { CUBE_ROUTES }，不要 inline 重复清单',
    ],
  },

  // ============================================================
  // 省份静默默认反模式（治理工程一，2026-06-28）
  // ============================================================
  {
    id: 'branch-code-fallback',
    group: '省份静默默认反模式',
    intro: "检查 ?? 'SC' / || 'SC' 省份静默默认反模式（数据路径）...",
    kind: 'line',
    roots: ['数据管理/daily.mjs', '数据管理/pipelines', 'server/src/config', 'server/src/services', 'scripts'],
    includeFile: (_rel, name) => /\.(ts|mjs|js)$/.test(name) && !/\.(test|spec)\.(ts|mjs|js)$/.test(name),
    exemptFiles: [
      '数据管理/lib/branch-naming.mjs', // 设计上处理 SC/空 等价
      'server/src/sql/kpi-detail.ts', // UI 显示回退，已文档化
      'scripts/check-governance.mjs', // 治理脚本自身的说明文本
      'scripts/governance/pattern-rules.mjs', // 本规则表自身
    ],
    patterns: [/\?\?\s*['"]SC['"]\s*|[|][|]\s*['"]SC['"]/],
    linePreExempt: [
      ...COMMENT_LINE,
      /resolveEnvBranchCode/, // 已用 fail-closed 函数替换
      /resolveBranchCode/,
      /assertBranchCodeSet/,
      /governance-allow:\s*branch-fallback/, // 显式豁免注释（2026-07-05 批次四并入统一命名空间，原词根零存量直接改名）
    ],
    desc: "数据路径静默默认四川，RLS 会静默失效",
    errorHeader: "发现省份静默默认反模式（数据路径中 ?? 'SC' / || 'SC'）",
    fixHints: [
      "修复（daily.mjs）：用 resolveEnvBranchCode('<context>') 替换 process.env.BRANCH_CODE || 'SC'",
      "修复（server TS）：用 resolveBranchCode(process.env.BRANCH_CODE, '<context>') 替换 ?? 'SC'",
      '或加豁免注释 // governance-allow: branch-fallback <理由>',
    ],
  },
];
