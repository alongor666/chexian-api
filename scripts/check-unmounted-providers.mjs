#!/usr/bin/env node

/**
 * Context Provider 未挂载治理检查（BACKLOG 2026-06-12-claude-27972c 子项 2b）
 *
 * 背景：2026-07-04 静态检查专项（bug-hunt 沉淀）核实发现 `src/shared/contexts/AuthContext.tsx`
 * 定义了完整的 `createContext` + `AuthProvider` + `useAuth`，但 `AuthProvider` 从未在任何 JSX
 * 中被挂载（App.tsx 的 Provider 树里没有 `<AuthProvider>`）——真实登录早已改走 `PermissionContext`
 * （`usePermission()`），`useRBAC.ts` 的注释里也留了这段历史（"AuthContext/AuthProvider 从未挂载
 * 到 Provider 树"）。本检查已删除 AuthContext.tsx 死代码，本脚本把这类"定义了但从未挂载"的模式
 * 固化为静态闸，防止同类死代码日后再度悄悄堆积。
 *
 * ── 识别的两种合法挂载模式（避免误报）──
 *
 * 1. **独立 Provider 组件模式**：文件内 `export const XxxProvider = ...` / `export function
 *    XxxProvider(...)`，其 JSX 标签 `<XxxProvider` 必须在仓库任意 `.tsx` 文件中出现（挂载点通常
 *    在 `src/app/App.tsx`，但本检查不限定挂载文件，只要求"存在"）。
 * 2. **自挂载模式**：`createContext` 后没有导出独立命名的 `XxxProvider` 组件，而是把
 *    `XxxContext.Provider` 直接内联写在同文件的另一个导出组件里返回（如
 *    `src/components/layout/SidebarLayout.tsx` 的 `SidebarContext` / `SidebarLayout`）。
 *    只要 `<XxxContext.Provider` 与 `createContext` 出现在同一文件，就视为"挂载点随宿主组件
 *    走"，不算未挂载（宿主组件本身是否被路由挂载，属于更宽泛的"未使用组件"问题，不在本检查
 *    范围内）。
 *
 * ── 误报控制：测试专用 Provider 白名单 ──
 *
 * 单测里常见"仅测试用的 test-utils Provider"（如 render helper 里包一层 Provider 供
 * renderHook 用），这类不应被当作业务死代码。策略：
 *   - `__tests__/` 目录、`*.test.ts(x)` 文件、文件名含 `test-utils`/`testUtils` 的文件，其内
 *     定义的 Provider **不纳入扫描**（业务组件不应该从测试文件 import Provider，若真的发生
 *     那是另一个问题）。
 *   - 若未来出现"业务 Provider 只在测试里挂载、生产从未挂载"的情况，属于本检查设计上应该
 *     命中的死代码信号，不应特殊放行——不设"业务文件+仅测试挂载"的豁免。
 *
 * 用法：node scripts/check-unmounted-providers.mjs [--quiet-pass]
 * 退出码：0 = 无未挂载 Provider；1 = 发现未挂载 Provider
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

const quietPass = process.argv.includes('--quiet-pass');

function log(color, tag, message) {
  console.log(`${color}${COLORS.bold}[${tag}]${COLORS.reset} ${message}`);
}
function success(message) {
  if (!quietPass) log(COLORS.green, 'pass', message);
}
function error(message) {
  log(COLORS.red, 'fail', message);
}
function info(message) {
  if (!quietPass) log(COLORS.reset, 'info', message);
}

// ============================================================
// 已知白名单：确认"未挂载但保留"的 Provider（须注明理由，禁止裸忽略）
// ============================================================
const KNOWN_UNMOUNTED_ALLOWLIST = new Set([
  // 示例格式：'相对路径::ProviderName'
  // 当前无存量条目（2026-07-04 首次全量扫描零命中）。
]);

const SCAN_ROOTS = ['src'];
const EXCLUDE_DIR_SEGMENTS = new Set(['node_modules', '__tests__', 'dist', 'build']);

function isTestFile(relPath) {
  return (
    relPath.includes('__tests__') ||
    /\.test\.tsx?$/.test(relPath) ||
    /test-utils/i.test(relPath) ||
    /testUtils/i.test(relPath)
  );
}

function walkFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIR_SEGMENTS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, out);
    } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

// `const XxxContext = createContext<...>(...)` —— 提取 Context 变量名
const CREATE_CONTEXT_RE = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*createContext\s*[<(]/g;

// `export const XxxProvider` / `export function XxxProvider`
const EXPORT_PROVIDER_RE =
  /export\s+(?:const|function)\s+([A-Za-z_][A-Za-z0-9_]*Provider)\b/g;

function scanFile(full) {
  const text = fs.readFileSync(full, 'utf-8');
  if (!/createContext/.test(text)) return { contexts: [], providers: [] };

  const contexts = [...text.matchAll(CREATE_CONTEXT_RE)].map((m) => m[1]);
  const providers = [...text.matchAll(EXPORT_PROVIDER_RE)].map((m) => m[1]);

  return { contexts, providers, text };
}

function main() {
  info('检查 Context Provider 定义未挂载（createContext + export XxxProvider vs 全仓库 <XxxProvider> JSX 挂载）...');

  const allFiles = [];
  for (const root of SCAN_ROOTS) {
    walkFiles(path.join(ROOT_DIR, root), allFiles);
  }

  // 收集全仓库（含测试文件——测试里挂载也算"被使用"，避免误杀）所有 JSX `<XxxProvider` 出现
  // 与所有 `<XxxContext.Provider` 出现，用于判定挂载点存在性。
  const jsxProviderTagUsage = new Set(); // 形如 <FooProvider
  const contextDotProviderUsageByContext = new Map(); // ContextName -> Set<relPath>（同文件自挂载判定用文件级）

  for (const full of allFiles) {
    const text = fs.readFileSync(full, 'utf-8');
    for (const m of text.matchAll(/<([A-Za-z_][A-Za-z0-9_]*Provider)\b/g)) {
      jsxProviderTagUsage.add(m[1]);
    }
    for (const m of text.matchAll(/<([A-Za-z_][A-Za-z0-9_]*)\.Provider\b/g)) {
      const ctxName = m[1];
      if (!contextDotProviderUsageByContext.has(ctxName)) {
        contextDotProviderUsageByContext.set(ctxName, new Set());
      }
      contextDotProviderUsageByContext.get(ctxName).add(path.relative(ROOT_DIR, full));
    }
  }

  let scannedDefinitionFiles = 0;
  let totalContextsFound = 0;
  let totalProvidersFound = 0;
  const unmounted = [];

  for (const full of allFiles) {
    const relPath = path.relative(ROOT_DIR, full);
    if (isTestFile(relPath)) continue; // 测试专用 Provider 不纳入扫描（见头部注释）

    const { contexts, providers, text } = scanFile(full);
    if (contexts.length === 0 && providers.length === 0) continue;
    scannedDefinitionFiles++;
    totalContextsFound += contexts.length;
    totalProvidersFound += providers.length;

    for (const providerName of providers) {
      // 模式 1：独立 Provider 组件 —— 全仓库任意 tsx 是否出现 <XxxProvider JSX 标签
      if (jsxProviderTagUsage.has(providerName)) continue;

      // 模式 2：自挂载 —— 该文件内是否存在对应 ContextName.Provider（Provider 名去掉
      // 'Provider' 后缀通常等于 Context 变量名前缀，如 AuthProvider ⟷ AuthContext）
      const ctxPrefix = providerName.replace(/Provider$/, '');
      const matchingContext = contexts.find((c) => c === `${ctxPrefix}Context` || c === ctxPrefix);
      const selfMounted =
        matchingContext &&
        contextDotProviderUsageByContext.has(matchingContext) &&
        contextDotProviderUsageByContext.get(matchingContext).has(relPath);
      if (selfMounted) continue;

      const allowKey = `${relPath}::${providerName}`;
      if (KNOWN_UNMOUNTED_ALLOWLIST.has(allowKey)) continue;

      unmounted.push({ file: relPath, provider: providerName });
    }
  }

  info(
    `扫描完成：定义文件 ${scannedDefinitionFiles} 个（Context ${totalContextsFound} 处 / 导出 Provider ${totalProvidersFound} 处），` +
      `白名单 ${KNOWN_UNMOUNTED_ALLOWLIST.size} 条`,
  );

  if (unmounted.length > 0) {
    error(`发现 ${unmounted.length} 处未挂载的 Context Provider（定义了但全仓库无 JSX 挂载）：`);
    for (const u of unmounted) {
      console.log(`    - ${u.file}: <${u.provider}>`);
    }
    console.log(
      '    修复：若确认死代码，删除该 Provider/Context 定义及所有残留 import；' +
        '若确认后续会挂载，在 check-unmounted-providers.mjs 的 KNOWN_UNMOUNTED_ALLOWLIST 显式登记并注明理由（禁止裸忽略）。',
    );
    process.exit(1);
  }

  success(
    `Context Provider 挂载检查通过（定义文件 ${scannedDefinitionFiles} 个，0 处未挂载，白名单 ${KNOWN_UNMOUNTED_ALLOWLIST.size} 条）`,
  );
  process.exit(0);
}

main();
