#!/usr/bin/env node
/**
 * 路由权限覆盖校验（多分公司前置 · Phase 0A）
 *
 * 目的：扫描 server/src/app.ts 中 `app.use('/api/...', xxxRoutes)` 挂载的所有顶层 router，
 * 确认每个顶层 router 都挂了至少一个权限相关中间件（authMiddleware 必填、
 * permissionMiddleware 或 requireRole 二选一），避免再次出现 `/api/data` 漏挂权限事故。
 *
 * 校验逻辑（关键）：只扫描 app.ts 顶层挂载的 router 文件，**不递归校验子路由**——
 * 因为子路由（如 server/src/routes/query/*.ts）的权限挂在父级聚合器（query.ts）上，
 * 子文件本身 router.use 通常为空，递归校验会全部误报。
 *
 * 规则：
 *  - 顶层 router 必须 router.use(authMiddleware)（公开路由除外）
 *  - 顶层 router 必须挂 permissionMiddleware 或 requireRole（公开路由除外）
 *  - 公开路由（白名单）：见 PUBLIC_ROUTES 常量
 *
 * 同时统计 `|| '1=1'` fallback 在 SQL WHERE 上下文出现次数（cache key 上下文除外）
 * 作为 fail-closed 加固扩散信号。
 *
 * Usage:
 *   node scripts/check-permission-coverage.mjs            # 严格模式（缺权限即报错）
 *   node scripts/check-permission-coverage.mjs --warn     # 警告模式（只打印不退出非零）
 *
 * 关联：
 *  - 计划文档：/Users/alongor666/.claude/plans/indexed-tinkering-ritchie.md §0A
 *  - 触发原因：codex PR review 发现 /api/data 与 /api/filters/options 内 SalesmanTeamMapping 漏挂权限
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================
// 配置
// ============================================

const APP_TS = path.join(REPO_ROOT, 'server/src/app.ts');

// 公开 router 白名单（无需挂权限中间件）
//   - /api/auth/login：未登录就要能调
//   - /api/auth/wecom：企微免密登录回调
// 注：/health 和其他系统级路由由 health 路由文件挂载（不在 /api 前缀，不在此扫描范围）
const PUBLIC_ROUTES = new Set([
  '/api/auth',
  '/api/auth/wecom',
]);

// 已知缺口（KNOWN_GAPS）：明知有跨分公司风险，但本 PR 范围外，留作 TODO。
// 加入此清单的路由不会让 governance 失败，但每次跑都会显式提醒（可见 + 可追溯）。
// 解锁条件：达成括号内的前置（多由 0C/0D Phase 提供），完成后从清单移除。
const KNOWN_GAPS = new Map([
  [
    '/api/reports',
    'HTML 报告按文件名托管（如 天府_经营诊断_2026Q1.html），任何登录用户可读跨机构报告；'
    + '修复依赖 0C 字段 branch_code 落进报告元数据后按 user.branchCode 校验文件归属。'
    + '详见 plan §0A KNOWN GAPS。',
  ],
]);

// cache key 上下文（保留 '1=1' 而非 SQL WHERE）
const CACHE_KEY_CONTEXT_FILES = new Set([
  'shared.ts',         // server/src/routes/query/shared.ts → buildRouteCacheKey
  'cache-warmer.ts',   // server/src/services/cache-warmer.ts → buildSyntheticRouteCacheKey
]);

const MODE_WARN = process.argv.includes('--warn');

// ============================================
// 从 app.ts 解析顶层 router
// ============================================

function parseTopLevelRouters() {
  const content = fs.readFileSync(APP_TS, 'utf-8');

  // 1. 收集 import：`import xxxRoutes from './routes/...'`
  const imports = new Map(); // variableName -> filePath
  const importRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const varName = m[1];
    const importPath = m[2];
    if (importPath.includes('/routes/') || importPath.includes('/agent/routes/')) {
      // 转换为 .ts 路径（去 .js 后缀，加 .ts）
      const tsPath = path.resolve(
        path.dirname(APP_TS),
        importPath.replace(/\.js$/, '.ts'),
      );
      imports.set(varName, tsPath);
    }
  }

  // 2. 收集 `app.use('/api/xxx', xxxRoutes)`
  const mounts = []; // { route, variableName, filePath }
  const useRe = /app\.use\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  while ((m = useRe.exec(content)) !== null) {
    const route = m[1];
    const varName = m[2];
    if (!route.startsWith('/api/')) continue;
    if (!imports.has(varName)) continue;
    mounts.push({
      route,
      variableName: varName,
      filePath: imports.get(varName),
    });
  }

  return mounts;
}

// ============================================
// 分析 router 文件
// ============================================

function analyzeRouterFile(filePath, route) {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      route,
      error: 'file-not-found',
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  const hasAuth = /\bauthMiddleware\b/.test(content);
  const hasPermissionMw = /\bpermissionMiddleware\b/.test(content);
  const hasRequireRole = /\brequireRole\s*\(/.test(content);

  // 统计 SQL WHERE 上下文的 `|| '1=1'` fallback
  const fileName = path.basename(filePath);
  const fallbackMatches = [];
  if (!CACHE_KEY_CONTEXT_FILES.has(fileName)) {
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes("|| '1=1'")) {
        fallbackMatches.push({ line: idx + 1 });
      }
    });
  }

  return {
    filePath,
    route,
    hasAuth,
    hasPermissionMw,
    hasRequireRole,
    fallbackMatches,
  };
}

// ============================================
// 主流程
// ============================================

const mounts = parseTopLevelRouters();
console.log(`[permission-coverage] 解析到 ${mounts.length} 个顶层 router 挂载点`);

const violations = [];
const warnings = [];
const knownGaps = [];

for (const mount of mounts) {
  const a = analyzeRouterFile(mount.filePath, mount.route);

  if (a.error) {
    violations.push({
      route: mount.route,
      file: path.relative(REPO_ROOT, mount.filePath),
      rule: a.error,
      message: `路由文件不存在`,
    });
    continue;
  }

  const isPublic = PUBLIC_ROUTES.has(mount.route);
  const knownGap = KNOWN_GAPS.get(mount.route);

  if (!isPublic) {
    if (!a.hasAuth) {
      const entry = {
        route: mount.route,
        file: path.relative(REPO_ROOT, mount.filePath),
        rule: 'missing-auth',
        message: '未挂 authMiddleware',
      };
      // KNOWN_GAPS 仅豁免 missing-permission（缺权限），不豁免 missing-auth（缺认证更严重）
      violations.push(entry);
    }

    if (!a.hasPermissionMw && !a.hasRequireRole) {
      const entry = {
        route: mount.route,
        file: path.relative(REPO_ROOT, mount.filePath),
        rule: 'missing-permission',
        message: '未挂 permissionMiddleware 或 requireRole',
      };
      if (knownGap) {
        knownGaps.push({ ...entry, gapNote: knownGap });
      } else {
        violations.push(entry);
      }
    }
  }

  // 收集 fallback 警告（含 public 路由）
  for (const fm of a.fallbackMatches) {
    warnings.push({
      route: mount.route,
      file: `${path.relative(REPO_ROOT, mount.filePath)}:${fm.line}`,
      rule: 'unsafe-fallback',
      message: `SQL WHERE 上下文 \`|| '1=1'\` fallback，建议改为 '1=0'（fail-closed）`,
    });
  }
}

// ============================================
// 输出
// ============================================

if (violations.length === 0) {
  console.log('[permission-coverage] ✅ 所有顶层 router 权限覆盖正常');
} else {
  console.log(`\n❌ 致命违规（${violations.length} 处）：`);
  for (const v of violations) {
    console.log(`  - ${v.route}  (${v.file}) [${v.rule}]: ${v.message}`);
  }
}

if (knownGaps.length > 0) {
  console.log(`\n🟡 已知缺口（${knownGaps.length} 处，不阻断 build，但留作 TODO）：`);
  for (const g of knownGaps) {
    console.log(`  - ${g.route}  (${g.file}) [${g.rule}]`);
    console.log(`    备注：${g.gapNote}`);
  }
}

if (warnings.length > 0) {
  console.log(`\n⚠️  fail-closed 加固提示（${warnings.length} 处）：`);
  for (const w of warnings.slice(0, 30)) {
    console.log(`  - ${w.route}  (${w.file}) [${w.rule}]`);
  }
  if (warnings.length > 30) {
    console.log(`  ... 还有 ${warnings.length - 30} 处省略`);
  }
}

console.log();

if (violations.length > 0 && !MODE_WARN) {
  console.error('[permission-coverage] ❌ 校验失败：补齐权限中间件后重试');
  process.exit(1);
}

process.exit(0);
