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

// 白名单按"豁免什么"拆成两类，避免一个集合把两种语义混在一起削弱鉴权红线
// （修 codex PR#482 第三轮 P2：原 PUBLIC_ROUTES 同时跳过 auth + permission 检查，
//   一旦 /api/discover 误删 router.use(authMiddleware)，governance 也不会拦）。
//
// 类别 A：**免认证 + 免权限**（登录入口本身必须未登录可访问）
const UNAUTHENTICATED_ROUTES = new Set([
  '/api/auth',           // 登录入口
  '/api/auth/wecom',     // 企微免密登录回调
]);
//
// 类别 B：**仅免行级权限**（authMiddleware 仍是红线，必须挂；只是不挂 permissionMiddleware）
//   - /api/discover：Agent/CLI/MCP 元数据发现层（fields/metrics/presets 注册表全国通用，无业务数据）
//                   ⚠️ 0D phase 评估：若按 branchCode 裁剪可见路由 catalog，则从此白名单移除并挂 permissionMiddleware
const NO_PERMISSION_ROUTES = new Set([
  '/api/discover',
]);
// 注：/health 和其他系统级路由由 health 路由文件挂载（不在 /api 前缀，不在此扫描范围）

// 已知缺口（KNOWN_GAPS）：明知有跨分公司风险，但本 PR 范围外，留作 TODO。
// 加入此清单的路由不会让 governance 失败，但每次跑都会显式提醒（可见 + 可追溯）。
// 解锁条件：达成括号内的前置（多由 0C/0D Phase 提供），完成后从清单移除。
const KNOWN_GAPS = new Map([
  [
    '/api/reports',
    '报告托管改用 handler 级行级安全（assertReportAccess），非 permissionMiddleware（文件服务无 SQL '
    + 'permissionFilter 可注入），故仍列 known-gap。B328 phase-1 已堵跨机构泄漏（非 branch_admin fail-closed）；'
    + 'phase-2 已让 org_user 读归属本机构报告（sidecar .meta.json 解析 ownerOrg/ownerBranch，按 '
    + 'org_level_3 等值 + branch_code 校验）。残留：生产方 diagnose-*/push_html.py 尚未 emit sidecar，'
    + '故生产真实 org_user 200 仍 GATED（见 BACKLOG 缺口登记）。',
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

  // 1. 收集 import 的 default 名 → 文件路径映射
  //    支持的形态（捕获 default 名）：
  //      - `import xxxRoutes from '...'`
  //      - `import xxxRoutes, { named1, named2 } from '...'`     ← codex PR#482 修复
  //      - `import xxxRoutes, * as ns from '...'`
  //    不支持（也不应支持，这些不是顶层 router）：
  //      - `import { name } from '...'`（无 default，注定不是默认导出的 router 实例）
  //      - `import * as ns from '...'`（namespace 用法，与 router 注册无关）
  const imports = new Map(); // variableName -> filePath
  // 关键：default 之后允许可选的 `, { ... }` 或 `, * as Name`，再到 `from`
  const importRe = /import\s+(\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?\s+from\s+['"]([^'"]+)['"]/g;
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

/**
 * 剥掉源码中的注释（避免注释里出现的中间件名字误判为"已挂"）。
 *
 * 修 codex PR#482 第二轮 P2：原版用 `\bpermissionMiddleware\b` 字符串搜索，
 * 注释里写"不挂 permissionMiddleware"也会被认为已挂，造成 governance 假阴性。
 *
 * 实现策略（简易但够用）：先剥块注释 `/* ... *​/` 再剥单行 `// ...`。
 * 边界 case 不处理：字符串字面量里包含 `//`/`/*`（如 regex 字面量）。
 * 实际 router 文件极少出现这种情况；遗漏对中间件检测无实质风险。
 */
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/\/\/[^\n]*/g, '');        // 单行注释
}

function analyzeRouterFile(filePath, route) {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      route,
      error: 'file-not-found',
    };
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const content = stripComments(rawContent);

  // 关键：匹配 `router.xxx(... 中间件名 ...)` 真实调用，而不是裸字符串出现。
  // 这样：
  //   - `import { authMiddleware } from '...'` 不算挂载（不是 router.xx 调用）
  //   - `router.use(authMiddleware)` ✅ 算
  //   - `router.use(authMiddleware, readonlyMiddleware, permissionMiddleware)` ✅ 算
  //   - `router.post('/x', requireRole(BRANCH_ADMIN), handler)` ✅ 算（路由级挂载）
  // 正则：`router\s*\.\s*\w+\s*\(` 后面允许多行参数列表（DOTALL）+ 含中间件名
  const callMiddlewarePattern = (middleware) =>
    new RegExp(`router\\s*\\.\\s*\\w+\\s*\\([^)]*\\b${middleware}\\b`, 's');
  // 注：`[^)]*` 只匹配到第一个 `)`，无法跨越嵌套括号；对 router.use(mw1, mw2, mw3) 够用。
  // requireRole(...) 内部嵌套括号场景由它自身的"调用形态"判定（见下）。

  const hasAuth = callMiddlewarePattern('authMiddleware').test(content);
  const hasPermissionMw = callMiddlewarePattern('permissionMiddleware').test(content);
  // requireRole 是函数调用形式 `requireRole(UserRole.X)`，只需匹配存在即可（剥注释后）。
  // 它必然出现在 router.use / router.\w 的参数里，独立 `requireRole(` 字符串就已是"挂载证据"。
  const hasRequireRole = /\brequireRole\s*\(/.test(content);

  // 统计 SQL WHERE 上下文的 `|| '1=1'` fallback（在原内容上扫描，保留行号准确）
  const fileName = path.basename(filePath);
  const fallbackMatches = [];
  if (!CACHE_KEY_CONTEXT_FILES.has(fileName)) {
    const lines = rawContent.split('\n');
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

  const isUnauthenticated = UNAUTHENTICATED_ROUTES.has(mount.route);
  const isNoPermissionOnly = NO_PERMISSION_ROUTES.has(mount.route);
  const knownGap = KNOWN_GAPS.get(mount.route);

  // 鉴权红线（authMiddleware）：只有 UNAUTHENTICATED_ROUTES 才豁免；
  // NO_PERMISSION_ROUTES 类（如 /api/discover）仍强制必挂——这是关键修复点：
  // 一旦 discover 等"仅免行级权限"路由误删 router.use(authMiddleware)，governance 必须拦住。
  if (!isUnauthenticated && !a.hasAuth) {
    violations.push({
      route: mount.route,
      file: path.relative(REPO_ROOT, mount.filePath),
      rule: 'missing-auth',
      message: '未挂 authMiddleware（鉴权红线，仅 UNAUTHENTICATED_ROUTES 可豁免）',
    });
  }

  // 行级权限：UNAUTHENTICATED_ROUTES 和 NO_PERMISSION_ROUTES 两类都豁免
  if (!isUnauthenticated && !isNoPermissionOnly && !a.hasPermissionMw && !a.hasRequireRole) {
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
