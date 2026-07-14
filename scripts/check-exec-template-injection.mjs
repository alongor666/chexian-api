#!/usr/bin/env node

/**
 * execSync/execFileSync 模板拼接注入检测（BACKLOG 2026-06-12-claude-27972c 子项 1）
 *
 * 背景：`child_process.execSync(cmd)` / `exec(cmd)` 把整个字符串交给 shell 解析（区别于
 * `execFileSync(file, argsArray)` 的数组参数形式，后者不经 shell、天然不受此类注入影响）。
 * 若字符串是**带插值的模板字面量**（如 `` execSync(`git show ${spec}`) ``），且插值来源不可信
 * （用户输入 / 文件枚举结果 / 网络响应 / 环境变量原样透传），攻击者可构造含 `; rm -rf /` 或
 * `$(...)`  的值注入任意命令。本检查静态扫描 `scripts/` 与 `server/src/` 下所有
 * `execSync`/`exec`（`child_process` 的 shell 形式 API）调用，命中"参数是含插值的模板字面量"
 * 即报告，要求逐一在调用点/上一行显式登记白名单理由，或改写为不经 shell 的安全形式。
 *
 * ── 设计取舍：全量登记优先于"智能"风险分级 ──
 *
 * 本仓库现存的 execSync 模板插值调用点（2026-07-04 首次全量扫描 ~12 处）插值来源均为：
 * 数字强制转换（`Number(pid)`）、硬编码常量（`ALIAS`/`VPS_HOST`）、正则白名单过滤后的值
 * （`SAFE_REF` 校验过的 git ref 名）——当前均安全。但"安全"是运行时性质，静态扫描无法通用
 * 判定插值表达式的可信度（要做到需要完整数据流分析，超出本检查的规模）。因此本检查采取
 * **保守策略**：只要是模板插值就必须显式登记，而非尝试自动判断"这处安全所以放行"。
 * 这样能拦住的正是任务描述最担心的模式——"插值来自文件枚举结果直接进 shell"这类**未来新增**
 * 的危险调用不会被静默放过，因为白名单要求逐条列出文件+函数名+一句语义注释，新增未登记的
 * 调用点会被无情况拦下，倒逼作者显式思考插值来源是否可信。
 *
 * ── 识别范围 ──
 *
 * 1. `execSync(\`...${expr}...\`)` —— child_process.execSync 的模板字面量参数，且模板含至少
 *    一个 `${...}` 插值（无插值的纯字面量模板天然安全，不在扫描范围）。
 * 2. `exec(\`...${expr}...\`)` —— 同上，覆盖回调式 exec（本仓库当前未发现使用，防未来引入）。
 * 3. **不扫描** `execFileSync`/`spawnSync`/`spawn`（数组参数形式，不经 shell 解析，天然安全，
 *    除非数组内部又出现模板插值字符串元素——那属于 checkSpawnArgQuoteSafety 覆盖的另一种
 *    引号纪律问题，非本检查范围）。
 *
 * ── 白名单机制（KNOWN_SAFE_INTERPOLATIONS）──
 *
 * 每条 `相对路径:行号` 需登记：
 *   - `reason`: 插值来源的语义说明（为何可信，如"Number() 强制转换为数字"/"正则白名单过滤过
 *     的 git ref 名"/"硬编码常量"）
 *   - 登记后若代码改动导致行号漂移，本检查按"该文件是否仍存在等价 execSync 模板调用总数
 *     不小于登记数"做宽松匹配（行号仅作定位提示，不做精确断言，避免正常代码改动频繁破坏白名单）。
 *
 * 用法：node scripts/check-exec-template-injection.mjs [--quiet-pass]
 * 退出码：0 = 无未登记的模板插值调用；1 = 发现未登记项或白名单登记数与实际不符（陈旧登记）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
// 已知白名单：确认"模板插值但可信"的 execSync/exec 调用点
// （新增调用点必须先在此登记 + 注明理由，禁止裸放行）
// ============================================================
const KNOWN_SAFE_INTERPOLATIONS = {
  'scripts/api-wire-conservation.mjs': [
    { line: 159, reason: 'spec 来自脚本内硬编码 BASELINE_COMMIT 或 CLI --spec 固定 git 引用格式，非任意外部输入' },
  ],
  'scripts/benchmark-key-routes-soak.mjs': [
    { line: 131, reason: 'Number(pid) 强制转换为数字，非数字值转换后为 NaN 已被上一行 Number.isFinite 拦截' },
  ],
  'scripts/benchmark-key-routes.mjs': [
    { line: 411, reason: 'Number(pid) 强制转换为数字，非数字值转换后为 NaN 已被上一行 Number.isFinite 拦截' },
  ],
  'scripts/start.mjs': [
    { line: 63, reason: 'checkCmd 为脚本内硬编码 which/where 二选一；command 调用点均为字面量 bun/node' },
    { line: 75, reason: 'command 调用点均为字面量 bun/node，非外部输入' },
    { line: 185, reason: 'port 参数来自本地固定端口常量（3000/5173 等），非外部输入' },
    { line: 307, reason: 'port 参数来自本地固定端口常量（3000/5173 等），非外部输入' },
  ],
  'scripts/setup-local-env.mjs': [
    { line: 62, reason: 'ALIAS 为脚本内硬编码常量 "chexian-vps-deploy"，非外部输入' },
  ],
  'scripts/loop/dispatch.mjs': [
    { line: 530, reason: 'cmd 调用点均为脚本内硬编码 git 子命令；ref 名经上方 SAFE_REF 正则白名单（仅 \\w./- ）过滤后才拼入' },
  ],
};

const SCAN_ROOTS = ['scripts', 'server/src'];
const EXCLUDE_DIR_SEGMENTS = new Set(['node_modules', 'dist', 'build']);

function isTestFile(relPath) {
  return (
    relPath.includes('__tests__') ||
    /\.test\.(m?js|tsx?)$/.test(relPath) ||
    /test-utils/i.test(relPath)
  );
}

function walkFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIR_SEGMENTS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, out);
    } else if (
      ent.isFile() &&
      (ent.name.endsWith('.mjs') || ent.name.endsWith('.js') || ent.name.endsWith('.ts'))
    ) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  info('检查 execSync/exec 模板插值调用（scripts/ + server/src/，禁止未登记的 shell 拼接）...');

  const require = createRequire(import.meta.url);
  let ts;
  try {
    ts = require('typescript');
  } catch {
    error('typescript 未安装，无法做 AST 扫描（应在 devDependencies）');
    process.exit(1);
  }

  const SHELL_EXEC_NAMES = new Set(['execSync', 'exec']);

  const allFiles = [];
  for (const root of SCAN_ROOTS) {
    walkFiles(path.join(ROOT_DIR, root), allFiles);
  }

  let scannedFiles = 0;
  let totalInterpolatedCalls = 0;
  const unlisted = [];
  const seenAllowlistHits = new Map(); // relPath -> count actually found

  for (const full of allFiles) {
    const relPath = path.relative(ROOT_DIR, full).split(path.sep).join('/');
    if (isTestFile(relPath)) continue; // 测试文件用例常构造字符串，不纳入扫描（避免误报）

    const text = fs.readFileSync(full, 'utf-8');
    if (!/\bexecSync\s*\(|(?<![.\w])exec\s*\(/.test(text)) continue;

    let sf;
    try {
      sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    } catch (e) {
      error(`AST 解析失败：${relPath} — ${e.message}`);
      process.exit(1);
    }

    scannedFiles++;
    const allowlist = KNOWN_SAFE_INTERPOLATIONS[relPath] || [];
    const allowedLines = new Set(allowlist.map((a) => a.line));
    let foundInFile = 0;

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        SHELL_EXEC_NAMES.has(node.expression.text)
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isTemplateExpression(firstArg)) {
          // 含至少一个 ${...} 插值的模板字面量（ts.isTemplateExpression 本身即代表
          // "有插值"的模板；无插值的模板是 NoSubstitutionTemplateLiteral，不在此分支）
          const line = sf.getLineAndCharacterOfPosition(firstArg.getStart(sf)).line + 1;
          totalInterpolatedCalls++;
          foundInFile++;
          if (!allowedLines.has(line)) {
            unlisted.push({
              file: relPath,
              line,
              snippet: firstArg.getText(sf).trim().slice(0, 80),
              fn: node.expression.text,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (foundInFile > 0) {
      seenAllowlistHits.set(relPath, foundInFile);
    }
  }

  // 陈旧白名单检测：登记了但实际扫描不到同等数量的插值调用（说明代码已改写/删除，
  // 白名单条目应同步清理，防止白名单越滚越大掩盖真实风险面）
  const staleAllowlistFiles = [];
  for (const [relPath, entries] of Object.entries(KNOWN_SAFE_INTERPOLATIONS)) {
    const actualCount = seenAllowlistHits.get(relPath) || 0;
    if (actualCount < entries.length) {
      staleAllowlistFiles.push(`${relPath}（登记 ${entries.length} 条，实际扫描到 ${actualCount} 处）`);
    }
  }

  info(
    `扫描完成：${scannedFiles} 个含 execSync/exec 调用的文件，发现模板插值调用 ${totalInterpolatedCalls} 处，` +
      `白名单覆盖 ${Object.values(KNOWN_SAFE_INTERPOLATIONS).reduce((s, a) => s + a.length, 0)} 条`,
  );

  if (unlisted.length > 0) {
    error(`发现 ${unlisted.length} 处未登记的 execSync/exec 模板插值调用（潜在 shell 注入面）：`);
    for (const u of unlisted) {
      console.log(`    - ${u.file}:${u.line}  ${u.fn}(${u.snippet}...)`);
    }
    console.log(
      '    修复：若插值来源可信（数字强制转换/硬编码常量/正则白名单过滤值），在本脚本 ' +
        'KNOWN_SAFE_INTERPOLATIONS 显式登记该文件+行号+理由；若插值来自用户输入/文件枚举结果/' +
        '网络响应等不可信来源，改写为 execFileSync(file, argsArray) 数组参数形式（不经 shell）。',
    );
    process.exit(1);
  }

  if (staleAllowlistFiles.length > 0) {
    error(`白名单登记陈旧（代码已变化但登记数未同步）：`);
    for (const s of staleAllowlistFiles) console.log(`    - ${s}`);
    console.log('    修复：更新本脚本 KNOWN_SAFE_INTERPOLATIONS 使登记数与实际扫描结果一致');
    process.exit(1);
  }

  success(
    `execSync/exec 模板插值检查通过（${totalInterpolatedCalls} 处插值调用均已登记白名单并注明理由）`,
  );
  process.exit(0);
}

main();
