#!/usr/bin/env node
/**
 * vite chunk 图不变式回归闸（BACKLOG 2026-07-05-claude-7f984d）
 *
 * 背景：PR #904 手工修复两条构建不变式后仅靠人工肉眼守护，本脚本读 dist/ 产物自动断言：
 *   (a) chunk 静态依赖图无循环 —— echarts-for-react 必须与 React 同 chunk，否则 Rollup
 *       去重的 CJS interop helper 会让 vendor-react ↔ echarts 两 chunk 互相静态 import，
 *       运行期 React 导出在暂时性死区未就绪时被 extends，抛 "Class extends value
 *       undefined"（登录页白屏）。动态 import() 是懒加载边界、不构成加载期环，不计入。
 *   (b) dist/index.html 的 modulepreload 不含 echarts / zrender 命名 chunk ——
 *       echarts 引擎（约 674KB）必须跟随各图表页的动态 import() 边界按需加载，
 *       一旦回到首屏 modulepreload，每个用户登录首屏都要白白下载。
 *
 * 用法：
 *   bun run build && node scripts/check-chunk-invariants.mjs
 *   bun run check:chunks           # package.json 别名
 * 无 dist/ 时明确报错退出（exit 2），提示先 build；被 governance 引用时由
 * checkChunkInvariants 决定「无 dist 则跳过并提示」。
 */

import fs from 'fs';
import path from 'path';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

/** 首屏 modulepreload 禁止出现的 chunk 名关键字（不变式 b） */
export const FORBIDDEN_PRELOAD_PATTERNS = Object.freeze(['echarts', 'zrender']);

/**
 * 从单个构建产物 JS 内容里提取对同目录 chunk 的引用。
 * 静态边（参与环检测）：`import ... from"./x.js"` / `export ... from"./x.js"` / 裸 `import"./x.js"`；
 * 动态边（懒边界，不参与环检测）：`import("./x.js")`。
 *
 * @param {string} content 产物 JS 文本（minified ESM）
 * @returns {{staticImports: string[], dynamicImports: string[]}} 去重后的相对文件名（不含 ./）
 */
export function extractChunkImports(content) {
  const staticSet = new Set();
  const dynamicSet = new Set();
  // 动态 import 先行提取并从静态匹配里排除：`import("./x.js")` 也含 `import` 关键字
  for (const m of content.matchAll(/import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g)) {
    dynamicSet.add(m[1]);
  }
  // from"./x.js" 覆盖 import-from 与 re-export；裸 import"./x.js" 是副作用引入
  for (const m of content.matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)) {
    staticSet.add(m[1]);
  }
  for (const m of content.matchAll(/(?<![.\w$])import\s*["']\.\/([^"']+\.js)["']/g)) {
    staticSet.add(m[1]);
  }
  return { staticImports: [...staticSet], dynamicImports: [...dynamicSet] };
}

/**
 * 以静态边建 chunk 依赖图并找环（迭代三色 DFS，防大图递归爆栈）。
 *
 * @param {Array<{name: string, content: string}>} files 产物文件名与内容
 * @returns {{graph: Map<string, string[]>, cycle: string[]|null}}
 *          cycle 为首个发现的环路径（如 ['a.js','b.js','a.js']），无环为 null
 */
export function buildGraphAndFindCycle(files) {
  const graph = new Map();
  const known = new Set(files.map((f) => f.name));
  for (const f of files) {
    const { staticImports } = extractChunkImports(f.content);
    // 只保留指向本次扫描集合内的边（外部路径如 ../ 不属于 chunk 图）
    graph.set(f.name, staticImports.filter((t) => known.has(t)));
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
  for (const start of graph.keys()) {
    if (color.get(start) !== WHITE) continue;
    // 栈帧：[节点, 下一个待访问邻居下标]；pathStack 维护当前灰色路径用于还原环
    const stack = [[start, 0]];
    const pathStack = [start];
    color.set(start, GRAY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [node] = frame;
      const neighbors = graph.get(node) || [];
      if (frame[1] < neighbors.length) {
        const next = neighbors[frame[1]++];
        if (color.get(next) === GRAY) {
          const cycleStart = pathStack.indexOf(next);
          return { graph, cycle: [...pathStack.slice(cycleStart), next] };
        }
        if (color.get(next) === WHITE) {
          color.set(next, GRAY);
          stack.push([next, 0]);
          pathStack.push(next);
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
        pathStack.pop();
      }
    }
  }
  return { graph, cycle: null };
}

/**
 * 从 index.html 提取所有 modulepreload 的 href。
 * @param {string} html
 * @returns {string[]}
 */
export function extractModulepreloadHrefs(html) {
  const hrefs = [];
  for (const m of html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/g)) {
    const hrefMatch = m[0].match(/href=["']([^"']+)["']/);
    if (hrefMatch) hrefs.push(hrefMatch[1]);
  }
  return hrefs;
}

/**
 * 命中禁配名单的 modulepreload href 子集（大小写不敏感）。
 * @param {string[]} hrefs
 * @param {readonly string[]} patterns
 * @returns {string[]}
 */
export function findForbiddenPreloads(hrefs, patterns = FORBIDDEN_PRELOAD_PATTERNS) {
  const lowered = patterns.map((p) => p.toLowerCase());
  return hrefs.filter((h) => {
    const base = h.toLowerCase();
    return lowered.some((p) => base.includes(p));
  });
}

/**
 * 对 dist/ 跑两条不变式。纯读文件系统，不改任何状态。
 *
 * @param {string} distDir dist 目录绝对路径
 * @returns {{status: 'missing-dist'|'pass'|'fail', messages: string[]}}
 *          messages 为面向人的中文说明（含通过时的规模概览）
 */
export function runChunkInvariantsCheck(distDir) {
  const indexHtml = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(indexHtml) || !fs.existsSync(assetsDir)) {
    return {
      status: 'missing-dist',
      messages: [`dist 产物不完整（缺 ${fs.existsSync(indexHtml) ? 'assets/' : 'index.html'}）：请先 bun run build 再跑本检查`],
    };
  }

  const messages = [];
  let failed = false;

  // 不变式 (a)：chunk 静态依赖图无环
  const files = fs.readdirSync(assetsDir)
    .filter((n) => n.endsWith('.js'))
    .map((name) => ({ name, content: fs.readFileSync(path.join(assetsDir, name), 'utf-8') }));
  const { graph, cycle } = buildGraphAndFindCycle(files);
  const edgeCount = [...graph.values()].reduce((acc, v) => acc + v.length, 0);
  if (cycle) {
    failed = true;
    messages.push(`不变式(a)失败：chunk 静态依赖图存在循环 —— ${cycle.join(' → ')}`);
    messages.push('  风险：环上 chunk 运行期初始化顺序无保证，可能复现 "Class extends value undefined" 白屏（PR #904）');
    messages.push('  修复方向：检查 vite.config.ts manualChunks —— React 绑定库（如 echarts-for-react）必须与 React 同 chunk');
  } else {
    messages.push(`不变式(a)通过：${files.length} 个 chunk / ${edgeCount} 条静态依赖边，零循环`);
  }

  // 不变式 (b)：首屏 modulepreload 不含 echarts / zrender
  const hrefs = extractModulepreloadHrefs(fs.readFileSync(indexHtml, 'utf-8'));
  const forbidden = findForbiddenPreloads(hrefs);
  if (forbidden.length > 0) {
    failed = true;
    messages.push(`不变式(b)失败：index.html 首屏 modulepreload 含 echarts/zrender chunk —— ${forbidden.join(', ')}`);
    messages.push('  风险：echarts 引擎（约 674KB）回到登录首屏必载，按需加载收益全废（PR #904）');
    messages.push('  修复方向：echarts/zrender 不得进 manualChunks 命名分组，必须跟随图表页动态 import() 懒边界');
  } else {
    messages.push(`不变式(b)通过：index.html ${hrefs.length} 条 modulepreload 均不含 echarts/zrender`);
  }

  return { status: failed ? 'fail' : 'pass', messages };
}

/**
 * check-governance.mjs 挂载入口（H5 棘轮：新检查放独立模块，主文件只留注册行）。
 * 日常提交多半没有 dist/ 产物 → 跳过并提示（与「文件不存在跳过」类检查同风格）；
 * 有 dist/ 时（本地 build 后 / CI 部署链）即真实校验。
 *
 * @param {{info: Function, warning: Function, error: Function, success: Function}} loggers
 * @param {string} distDir dist 目录绝对路径
 * @returns {boolean} governance 检查协议：true=通过/跳过，false=失败
 */
export function governanceCheckChunkInvariants({ info, warning, error, success }, distDir) {
  info('检查 vite chunk 图不变式（静态依赖零循环 + 首屏 modulepreload 无 echarts/zrender）...');
  const { status, messages } = runChunkInvariantsCheck(distDir);
  if (status === 'missing-dist') {
    warning('dist/ 产物不存在，跳过（bun run build 后可用 bun run check:chunks 单独校验）');
    return true;
  }
  if (status === 'fail') {
    for (const msg of messages) error(msg);
    return false;
  }
  success(`vite chunk 图不变式通过（${messages.join('；')}）`);
  return true;
}

function main() {
  const distDir = path.join(ROOT_DIR, 'dist');
  const { status, messages } = runChunkInvariantsCheck(distDir);
  for (const msg of messages) console.log(msg);
  if (status === 'missing-dist') process.exit(2);
  if (status === 'fail') {
    console.error('\n❌ vite chunk 图不变式校验失败（详见上方修复方向）');
    process.exit(1);
  }
  console.log('\n✅ vite chunk 图不变式校验通过');
}

// 仅直接执行时跑 main()；被 check-governance.mjs import 时不触发
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
