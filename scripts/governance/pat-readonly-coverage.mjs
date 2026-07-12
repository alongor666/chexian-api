/**
 * 治理检查：PAT 只读约束的端点级覆盖（安全审查 M7）
 *
 * 背景：readonlyMiddleware 依赖前序 authMiddleware 写入 req.pat 才能识别 PAT 调用；红线要求
 * 「authMiddleware → readonlyMiddleware」顺序（server/src/middleware/readonly.ts:7）。当前所有
 * PAT 可达的写端点都已覆盖，但覆盖是「每条路由人工挂对」的结果，无结构性保证——未来新增写路由
 * 漏挂即成 PAT 提权面，且无闸可拦。本闸把该不变量固化。
 *
 * 判定（端点级，不接受「文件里出现 readonlyMiddleware 就算覆盖」的文件级正则）：
 *   对每个 authMiddleware 门控的写端点（router.post/put/delete），必须满足其一：
 *     (a) 有效的 router 级 readonly：router.use(readonlyMiddleware) 出现在 router.use(authMiddleware)
 *         之后、且在该端点定义之前（顺序正确才真生效）；
 *     (b) 该端点自身中间件链里 readonlyMiddleware 出现在 authMiddleware 之后；
 *     (c) 该端点 handler 体含 requireSessionAuth(（比只读更严：直接全拒 PAT）。
 *   未认证写端点（如 /login、/activate、/reset-password：链中无 authMiddleware）不是 PAT 可达，
 *   不要求覆盖。纯 GET 文件天然无写端点，不触发。
 *
 * 逃生阀：在端点区域内写 `// governance-allow: pat-readonly <理由>` 显式豁免（极少用）。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式）。
 */

import fs from 'fs';
import path from 'path';

/** 递归收集目录下所有 .ts 文件（跳过 __tests__） */
function collectRouteFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...collectRouteFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const ROUTE_DIRS = ['server/src/routes', 'server/src/agent/routes'];

/** 剥离行/块注释（防端点区域读到下一路由的 JSDoc 里 authMiddleware 等字样造成误判） */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 找到所有 router.(get|post|put|delete|use)( 边界，返回 {method, index} 有序数组 */
function findRouteBoundaries(src) {
  const re = /router\.(get|post|put|delete|use)\s*\(/g;
  const marks = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    marks.push({ method: m[1], index: m.index });
  }
  return marks;
}

export function runPatReadonlyCoverageCheck({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查 PAT 只读约束端点级覆盖（安全审查 M7）...');

  const files = ROUTE_DIRS.flatMap((rel) => collectRouteFiles(path.join(rootDir, rel)));
  const offenders = [];
  const orderingWarnings = [];

  for (const filePath of files) {
    const src = fs.readFileSync(filePath, 'utf-8');
    if (!/\brouter\.(get|post|put|delete|use)\s*\(/.test(src)) continue;

    // router 级中间件位置（顺序正确性：auth 必须在 readonly 之前）
    const authUseIdx = src.search(/router\.use\(\s*authMiddleware/);
    const readonlyUseIdx = src.search(/router\.use\(\s*readonlyMiddleware/);
    const relPath = path.relative(rootDir, filePath);

    // 检出「router 级 readonly 挂在 auth 之前（或无 auth）」的失效挂载（P0 场景）
    if (readonlyUseIdx !== -1 && (authUseIdx === -1 || readonlyUseIdx < authUseIdx)) {
      orderingWarnings.push(relPath);
    }

    const boundaries = findRouteBoundaries(src);
    for (let i = 0; i < boundaries.length; i++) {
      const { method, index } = boundaries[i];
      if (method === 'get' || method === 'use') continue; // 只审写端点
      const regionEnd = i + 1 < boundaries.length ? boundaries[i + 1].index : src.length;
      const rawRegion = src.slice(index, regionEnd);

      // 逃生阀（marker 本身是注释，必须在剥注释之前用原文匹配）
      if (/governance-allow:\s*pat-readonly\b/.test(rawRegion)) continue;

      // 剥注释：端点区域到下一路由边界之间常夹着下一路由的 JSDoc（会提到 authMiddleware 等），
      // 不剥会把下一路由的文档误算进本端点。
      const region = stripComments(rawRegion);

      const hasAuthInRegion = /\bauthMiddleware\b/.test(region);
      const routerAuthEff = authUseIdx !== -1 && authUseIdx < index;
      const needsCoverage = hasAuthInRegion || routerAuthEff;
      if (!needsCoverage) continue; // 未认证写端点非 PAT 可达

      const authPos = region.indexOf('authMiddleware');
      const readonlyPos = region.indexOf('readonlyMiddleware');
      const readonlyAfterAuthInRegion =
        readonlyPos !== -1 && authPos !== -1 && authPos < readonlyPos;
      const routerReadonlyEff =
        readonlyUseIdx !== -1 &&
        readonlyUseIdx < index &&
        authUseIdx !== -1 &&
        authUseIdx < readonlyUseIdx;
      const hasRequireSession = /requireSessionAuth\s*\(/.test(region);

      const covered = routerReadonlyEff || readonlyAfterAuthInRegion || hasRequireSession;
      if (!covered) {
        offenders.push(`${relPath} 的 router.${method}(...) 端点（约第 ${lineOf(src, index)} 行）`);
      }
    }
  }

  let ok = true;

  if (orderingWarnings.length > 0) {
    error('PAT 只读挂载顺序错误：以下文件 router.use(readonlyMiddleware) 挂在 authMiddleware 之前（或缺 router 级 auth），readonly 拿不到 req.pat 会空放行：');
    for (const f of orderingWarnings) error(`  - ${f}`);
    error('  修复：确保 router.use(authMiddleware) 在 router.use(readonlyMiddleware) 之前。');
    ok = false;
  }

  if (offenders.length > 0) {
    error('PAT 只读端点级覆盖失败：以下 authMiddleware 门控的写端点未挡 PAT（无 readonly-after-auth，也无 requireSessionAuth）：');
    for (const o of offenders) error(`  - ${o}`);
    error('  修复其一：');
    error('    (a) router.use(authMiddleware) 后 router.use(readonlyMiddleware)（router 级统一）；');
    error('    (b) 该端点中间件链在 authMiddleware 后加 readonlyMiddleware；');
    error('    (c) handler 内调 requireSessionAuth(req)（全拒 PAT）；');
    error('    (d) 确属公开/无副作用可在端点区域加 `// governance-allow: pat-readonly <理由>`。');
    ok = false;
  }

  if (ok) {
    success(`PAT 只读端点级覆盖通过（扫描 ${files.length} 个路由文件，所有认证写端点均挡 PAT）`);
  }
  return ok;
}

/** 1-indexed 行号（用于报错定位） */
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}
