#!/usr/bin/env node

/**
 * 声明式模式扫描引擎（governance 奥卡姆批次二，2026-07-05，backlog 2026-07-05-claude-e52a30）
 *
 * 背景：check-governance.mjs 曾有 8+ 个"禁止模式"检查函数，每个各自实现递归目录遍历
 * 与逐行正则，代码同构、彼此漂移。本引擎把它们收拢为「规则表 + 单执行器」：
 *   - 规则 = 纯数据声明（见 pattern-rules.mjs），新增一条闸 = 加一条配置
 *   - scanContentWithRule 为纯函数（无文件系统依赖），fixture 红绿测试直接喂字符串验证
 *   - 同组规则共享文件内容缓存（一个文件只读一次）
 *
 * 规则 schema（字段均可选，除 id/group/kind/roots）：
 *   id            规则唯一标识（fixture 测试引用）
 *   group         注册表显示名——同 group 多条规则聚合为一个 governance 检查项
 *   intro         组开场 info 文案（取组内第一条规则的）
 *   kind          'line' | 'content' | 'file-cond'
 *   roots         扫描根（仓库相对路径；可以是单个文件）
 *   maxDepth      目录递归深度（0=仅根目录直接子文件；缺省不限）
 *   includeFile   (relPosix, basename) => bool 文件级过滤
 *   excludeDirs   除默认（node_modules/dist/.git/.archive）外追加排除的目录名
 *   exemptFiles   仓库相对路径豁免清单
 *   —— kind='line'：
 *   patterns      正则数组，任一命中该行即候选违规
 *   lineFilter    (line) => bool 额外行级条件（与 patterns 同时满足）
 *   linePreExempt 正则/字符串数组，命中即跳过该行（注释前缀、已合规形态等）
 *   allowMarker   正则/字符串——本行或上一行命中即豁免（governance-allow 逃生阀）
 *   allowContext  { pattern: 字符串, lines: N }——上方 N 行内出现即豁免
 *   firstHitPerFile 每文件只报第一处（保持个别旧检查的语义）
 *   classify      (line) => 'error'|'warning'（缺省 'error'）
 *   —— kind='content'：
 *   contentPattern 对全文匹配的正则（自动补 g flag），逐命中定位行号
 *   —— kind='file-cond'：
 *   triggerPattern / requiredPattern  文件含 trigger 却缺 required 即违规
 *   condDesc      违规描述
 *   —— 报告：
 *   desc          单条违规行尾的说明
 *   errorHeader   组失败时的标题（组内第一条规则的生效）
 *   fixHints      修复指引行数组（组失败时打印，逐条去重）
 *   skipWhenAllRootsMissing  组内全部 root 缺失时的 warning 文案（打印后视为通过）
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', '.archive']);

/** 递归收集 root 下的文件（root 可为单个文件）。maxDepth=0 表示只取根目录直接子文件。 */
export function collectFiles(rootAbs, { maxDepth = Infinity, excludeDirs = [] } = {}) {
  const excl = new Set([...DEFAULT_EXCLUDE_DIRS, ...excludeDirs]);
  const out = [];
  const visit = (p, depth) => {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      return;
    }
    if (stat.isFile()) {
      out.push(p);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        if (excl.has(ent.name)) continue;
        if (depth + 1 > maxDepth) continue;
        visit(full, depth + 1);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  };
  visit(rootAbs, 0);
  return out;
}

const hit = (matcher, s) => (typeof matcher === 'string' ? s.includes(matcher) : matcher.test(s));

/**
 * 纯函数核心：按单条规则扫描一段文本，返回违规列表 [{line, text, severity}]。
 * 无文件系统依赖——fixture 红绿测试直接调用。
 */
export function scanContentWithRule(rule, content) {
  const violations = [];

  if (rule.kind === 'content') {
    const src = rule.contentPattern;
    const flags = src.flags.includes('g') ? src.flags : `${src.flags}g`;
    const re = new RegExp(src.source, flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split('\n').length;
      violations.push({ line, text: m[0].split('\n')[0].slice(0, 80), severity: 'error' });
      if (rule.firstHitPerFile) break;
      if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
    }
    return violations;
  }

  if (rule.kind === 'file-cond') {
    if (rule.triggerPattern.test(content) && !rule.requiredPattern.test(content)) {
      violations.push({ line: 0, text: rule.condDesc ?? '', severity: 'error' });
    }
    return violations;
  }

  // kind === 'line'
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!rule.patterns.some((re) => re.test(line))) continue;
    if (rule.lineFilter && !rule.lineFilter(line)) continue;
    if ((rule.linePreExempt ?? []).some((ex) => hit(ex, line))) continue;
    if (rule.allowMarker) {
      const prev = i > 0 ? lines[i - 1] : '';
      if (hit(rule.allowMarker, line) || hit(rule.allowMarker, prev)) continue;
    }
    if (rule.allowContext) {
      let exempted = false;
      for (let j = Math.max(0, i - rule.allowContext.lines); j < i; j++) {
        if (lines[j].includes(rule.allowContext.pattern)) {
          exempted = true;
          break;
        }
      }
      if (exempted) continue;
    }
    const severity = rule.classify ? rule.classify(line) : 'error';
    violations.push({ line: i + 1, text: line.trim().slice(0, 100), severity });
    if (rule.firstHitPerFile) break;
  }
  return violations;
}

/** 跑单条规则（真实文件系统），contentCache 供同组规则共享（Map<absPath, string|null>）。 */
export function runPatternRule(rule, rootDir, contentCache = new Map()) {
  const result = { violations: [], missingRoots: [] };
  for (const root of rule.roots) {
    const abs = path.join(rootDir, root);
    if (!fs.existsSync(abs)) {
      result.missingRoots.push(root);
      continue;
    }
    for (const fileAbs of collectFiles(abs, rule)) {
      const rel = path.relative(rootDir, fileAbs).split(path.sep).join('/');
      const name = path.basename(fileAbs);
      if (rule.includeFile && !rule.includeFile(rel, name)) continue;
      if ((rule.exemptFiles ?? []).includes(rel)) continue;
      let content = contentCache.get(fileAbs);
      if (content === undefined) {
        try {
          content = fs.readFileSync(fileAbs, 'utf-8');
        } catch {
          content = null; // 二进制/不可读文件跳过
        }
        contentCache.set(fileAbs, content);
      }
      if (content === null) continue;
      for (const v of scanContentWithRule(rule, content)) {
        result.violations.push({ file: rel, rule, ...v });
      }
    }
  }
  return result;
}

/**
 * 把规则表按 group 聚合为 governance 检查项数组 [{name, fn}]。
 * io = { info, success, error, warning }（由 check-governance.mjs 注入，保持输出风格统一）。
 */
export function buildPatternChecks(rules, { rootDir, io }) {
  const groups = [];
  const byName = new Map();
  for (const rule of rules) {
    let g = byName.get(rule.group);
    if (!g) {
      g = { name: rule.group, rules: [] };
      byName.set(rule.group, g);
      groups.push(g);
    }
    g.rules.push(rule);
  }
  return groups.map((g) => ({ name: g.name, fn: () => runPatternGroup(g, rootDir, io) }));
}

function runPatternGroup(group, rootDir, io) {
  const first = group.rules[0];
  io.info(first.intro ?? `检查 ${group.name}...`);

  const cache = new Map();
  const errors = [];
  const warnings = [];
  let totalRoots = 0;
  let missingRoots = 0;

  for (const rule of group.rules) {
    totalRoots += rule.roots.length;
    const r = runPatternRule(rule, rootDir, cache);
    missingRoots += r.missingRoots.length;
    for (const v of r.violations) {
      const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
      const detail = v.text ? `  ${v.text}` : '';
      const desc = v.rule.desc ? `（${v.rule.desc}）` : '';
      (v.severity === 'warning' ? warnings : errors).push(`${loc}${detail}${desc}`);
    }
  }

  // 组内全部扫描根都不存在 → 按声明跳过（保持旧检查"目录不存在则跳过"语义）
  if (missingRoots === totalRoots && first.skipWhenAllRootsMissing) {
    io.warning(first.skipWhenAllRootsMissing);
    return true;
  }

  const scanned = [...cache.values()].filter((c) => c !== null).length;

  if (errors.length > 0) {
    io.error(`${first.errorHeader ?? group.name} = ${errors.length} 处：`);
    for (const e of errors) console.log(`    - ${e}`);
    if (warnings.length > 0) {
      io.warning(`另有 ${warnings.length} 条警告：`);
      for (const w of warnings) console.log(`    - ${w}`);
    }
    for (const hint of new Set(group.rules.flatMap((r) => r.fixHints ?? []))) {
      console.log(`    ${hint}`);
    }
    return false;
  }

  if (warnings.length > 0) {
    io.warning(`${group.name}：通过但有 ${warnings.length} 条警告：`);
    for (const w of warnings) console.log(`    - ${w}`);
    return true;
  }

  io.success(`${group.name}：通过（扫描 ${scanned} 个文件）`);
  return true;
}
