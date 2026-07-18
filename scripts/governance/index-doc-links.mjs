/**
 * 治理检查：00_index 四索引内部引用死链闸（2026-07-16 知识体系审计）
 *
 * 背景：governance 此前只检查四索引「文件本身存在」，从不校验其内部引用路径的有效性。
 * 纯手工维护 + 零自动化闸 = 必然腐化——审计实测抽样 30 条路径 17 条死链（约 55%），
 * 含整表指向已删除架构（src/shared/{duckdb,normalize,sql}/）、整段指向老项目遗留目录
 * （签单清洗/）、以及 2026-07-09 BACKLOG.md 转 gitignored 派生视图后未同步的多处死引用。
 * 详见 开发文档/审计/2026-07-16-知识体系审计.md。
 *
 * 扫描契约（三规则）：
 *   R1 Markdown 链接 [text](target)——排除 http(s)/mailto/纯 #锚点；
 *   R2 反引号内联 + fenced code block 内的路径 token——含 `/` 且以已知扩展名或 `/` 结尾；
 *   R3 退役词硬禁列表（捕获裸文本，不依赖路径形态）：签单清洗/、src/shared/duckdb、
 *      src/shared/sql、src/shared/normalize、裸 BACKLOG.md（同行有「派生视图/gitignored」
 *      说明则放行——那是对派生视图机制的合法描述）。
 *
 * 归一化：剥 #锚点、剥 :行号 后缀、剥链接 title（`(x.md "标题")`）。判定语义（2026-07-16
 * 评审返工后收紧，无静默绿灯）：
 *   - R1 链接严格按 GitHub markdown 语义：`/` 开头锚定仓库根，否则相对本文档目录，
 *     **无仓库根兜底**；越出仓库的相对路径（../..）一律报错——外部资源必须写完整 URL。
 *   - R2 token 做仓库根锚定：首段是仓库顶层条目 → 校验存在性；首段未知且 token 是
 *     强路径断言（≥2 段或带扩展名）→ **报错**（改写 canonical 路径或 governance-allow 豁免）；
 *     仅单段目录简写（`routes/`、`cube/`）视为上下文速记跳过（弱断言，无从校验）。
 * 硬跳过：glob（* ? { }）、模板（< >）、a|b 择一简写（仅限单个 token）、占位（YYYY、${）、
 * ~ 开头、URL、worktrees 路径。fenced code block 逐行 token 扫描（管道符按分隔符处理，
 * 不因整行含 | 而跳过）。
 * 豁免两层：
 *   ① gitignored 派生/数据产物：路径在 git ignore 规则内（git check-ignore）→ 视为
 *      「本地产物，存在性机器相关」，不报死链（BACKLOG.md 派生视图、warehouse 数据均由此覆盖）；
 *   ② 行内标记 `<!-- governance-allow: index-doc-links <理由> -->`（同行或上一行）——
 *      复用治理豁免统一命名空间（harness H6），用于墓碑/变更记录里对已删除路径的历史性提及。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式）。
 * 红绿夹具测试：scripts/__tests__/index-doc-links.test.mjs。
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const INDEX_FILES = [
  '开发文档/00_index/DOC_INDEX.md',
  '开发文档/00_index/CODE_INDEX.md',
  '开发文档/00_index/DATA_INDEX.md',
  '开发文档/00_index/PROGRESS_INDEX.md',
  // 二期（2026-07-16）：导航型活文档纳入。刻意排除 PROGRESS.md——它已声明为
  // 「历史里程碑存档」，其证据引用记录的是当时存在的文件（实测 25 处“死链”全为
  // 历史快照语义），扫描它只会制造成片豁免噪声；活的接力指针已迁 PROGRESS_INDEX。
  'AGENTS.md',
  '.claude/AGENTS.md',
  '数据管理/knowledge/INDEX.md',
];

const ALLOW_MARKER = 'governance-allow: index-doc-links';

// R3 退役词：这些字符串在索引里出现即报错（除非有豁免标记 / 派生视图说明）
const BANNED_TOKENS = [
  { token: '签单清洗/', reason: '老项目（chexianYJFX）遗留目录，本仓库不存在' },
  { token: 'src/shared/duckdb', reason: '旧 DuckDB-WASM 架构，2026-02 API-only 拆分已删除' },
  { token: 'src/shared/sql', reason: '旧架构路径，现为 server/src/sql/' },
  { token: 'src/shared/normalize', reason: '旧架构路径，现为 server/src/normalize/' },
];

// 裸 BACKLOG.md 特例：同行有派生视图机制说明则放行
const BACKLOG_TOKEN = 'BACKLOG.md';
const BACKLOG_ALLOW_HINTS = ['派生视图', 'gitignored', 'gitignore'];

const KNOWN_EXTENSIONS = /\.(md|ts|tsx|js|mjs|cjs|py|json|jsonl|html|png|sh|ya?ml|csv|sql|xlsx|parquet|toml|ini|txt|lock)$/i;

export function runIndexDocLinksCheck({ rootDir, io, isGitIgnored = defaultIsGitIgnored }) {
  const { info, success, error } = io;
  info('检查索引/导航文档内部引用死链（知识体系审计闸）...');

  const problems = [];
  let scannedRefs = 0;
  const topLevelEntries = new Set(fs.readdirSync(rootDir));

  for (const rel of INDEX_FILES) {
    const filePath = path.join(rootDir, rel);
    if (!fs.existsSync(filePath)) continue; // 文件自身存在性由「必需文件与核心索引」检查负责
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

    let prevLine = '';
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        prevLine = line;
        continue;
      }
      const exempted = line.includes(ALLOW_MARKER) || prevLine.includes(ALLOW_MARKER);
      prevLine = line;
      if (exempted) continue;

      // R3 退役词
      for (const { token, reason } of BANNED_TOKENS) {
        if (line.includes(token)) {
          problems.push(`${rel}:${lineNo}: 退役词「${token}」（${reason}）——改指现行事实源，或墓碑行加 <!-- ${ALLOW_MARKER} 理由 -->`);
        }
      }
      if (line.includes(BACKLOG_TOKEN) && !line.includes('BACKLOG_LOG') ) {
        const allowed = BACKLOG_ALLOW_HINTS.some((h) => line.includes(h));
        if (!allowed) {
          problems.push(`${rel}:${lineNo}: 裸「BACKLOG.md」引用——它是 gitignored 派生视图（bun run backlog:render 生成），须写明派生视图口径或改指 BACKLOG_LOG.jsonl`);
        }
      }

      // R1 + R2 路径提取
      for (const ref of extractRefs(line, inFence)) {
        scannedRefs++;
        const verdict = checkTarget(ref, rel, rootDir, isGitIgnored, topLevelEntries);
        if (verdict) problems.push(`${rel}:${lineNo}: ${verdict}`);
      }
    }
  }

  if (problems.length === 0) {
    success(`索引死链检查通过（${INDEX_FILES.length} 个文档，${scannedRefs} 条路径引用）`);
    return true;
  }
  problems.forEach((p) => error(p));
  return false;
}

/** 从一行中提取待验证的引用（R1 markdown 链接 + R2 反引号/代码行路径 token），带 kind 标记 */
export function extractRefs(line, inFence = false) {
  const refs = [];

  // fenced code block 内：整行按 token 扫（shell 管道符 ` | ` 当分隔符，不整行跳过）。
  // 树形目录图行（├└│ 绘图符）跳过：树的叶 token 天然相对父行，无从锚定；层级根应写在树图首行。
  if (inFence) {
    if (/[├└│▼]/.test(line)) return refs;
    for (const t of extractPathTokens(line.split(/\s+\|+\s+/).join(' '))) {
      refs.push({ target: t, kind: 'token' });
    }
    return refs;
  }

  // R1: [text](target) / [text](target "title")
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(line)) !== null) {
    refs.push({ target: stripLinkTitle(m[1].trim()), kind: 'link' });
  }

  // R2: 反引号内联 span 中的路径 token
  const codeRe = /`([^`]+)`/g;
  while ((m = codeRe.exec(line)) !== null) {
    for (const t of extractPathTokens(m[1])) refs.push({ target: t, kind: 'token' });
  }

  // R2 补充：无反引号/链接的纯文本行按 token 扫（排除表格行——中文说明列会误扫）。
  if (!line.includes('|') && !line.includes('](') && !line.includes('`') && line.includes('/')) {
    for (const t of extractPathTokens(line)) refs.push({ target: t, kind: 'token' });
  }

  return refs;
}

/** 剥 markdown 链接的可选 title：`x.md "标题"` / `x.md '标题'` → `x.md` */
function stripLinkTitle(target) {
  const m = target.match(/^(\S+)\s+["'].*["']$/);
  return m ? m[1] : target;
}

/** 从任意文本片段提取形如路径的 token（含 / 且以已知扩展名或 / 结尾） */
function extractPathTokens(text) {
  const tokens = [];
  for (let word of text.split(/[\s，、；：（）()【】]+/)) {
    word = word.replace(/^[#'"“”‘’]+|['"“”‘’.,;:!?]+$/g, '');
    if (!word.includes('/')) continue;
    if (/^\/\//.test(word) || word.replace(/\//g, '') === '') continue; // 代码注释 // 与纯斜杠
    const stripped = stripSuffixes(word);
    if (KNOWN_EXTENSIONS.test(stripped) || stripped.endsWith('/')) tokens.push(word);
  }
  return tokens;
}

function stripSuffixes(target) {
  return target.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
}

/** 单个引用判定：返回 null=通过/跳过，否则返回问题描述 */
function checkTarget(ref, indexRel, rootDir, isGitIgnored, topLevelEntries) {
  const { kind } = ref;
  let target = ref.target.trim();

  // 硬跳过
  if (/^(https?|mailto|ftp):/i.test(target)) return null;
  if (target.startsWith('#')) return null; // 纯锚点
  if (/[*?{}<>|]/.test(target)) return null; // glob / 模板 / a|b 择一简写
  if (target.includes('YYYY') || target.includes('${')) return null; // 占位
  if (target.startsWith('~')) return null; // home 路径
  if (target.includes('.claude/worktrees/')) return null;
  if (!/[/.]/.test(target)) return null; // 既无 / 也无 . 的裸词

  target = stripSuffixes(target);
  if (!target) return null;

  let resolvedRel;
  if (kind === 'link') {
    // 严格 GitHub markdown 语义：/ 开头 = 仓库根；否则相对本文档目录。无仓库根兜底——
    // 兜底会让「本文档目录下不存在、恰好仓库根存在」的链接假绿（GitHub 上实际 404）。
    resolvedRel = target.startsWith('/')
      ? target.slice(1)
      : path.normalize(path.join(path.dirname(indexRel), target));
    if (resolvedRel.startsWith('..')) {
      return `相对链接「${ref.target}」越出仓库——仓外资源必须写完整 https:// URL`;
    }
    // 链接目标若无扩展名且不含 /，可能是纯文本（如「§2」）——跳过
    if (!resolvedRel.includes('/') && !KNOWN_EXTENSIONS.test(resolvedRel)) return null;
  } else {
    // token：仓库根锚定语义
    resolvedRel = path.normalize(target.replace(/^\.?\//, ''));
    if (resolvedRel.startsWith('..')) {
      return `路径 token「${ref.target}」越出仓库——仓外资源必须写完整 https:// URL`;
    }
    const segments = resolvedRel.split('/').filter(Boolean);
    if (!topLevelEntries.has(segments[0])) {
      // 仅单段目录简写（`routes/`、`cube/`）视为上下文速记：弱断言，无从校验，跳过。
      if (segments.length === 1 && !KNOWN_EXTENSIONS.test(resolvedRel)) return null;
      // ≥2 段或带扩展名 = 强路径断言：未知首段不静默放行。
      return `路径「${ref.target}」无法从仓库根解析（首段「${segments[0]}」非顶层条目）——改写为 canonical 全路径，或历史文本加 <!-- ${ALLOW_MARKER} 理由 -->`;
    }
  }

  if (fs.existsSync(path.join(rootDir, resolvedRel))) return null;

  // gitignored 产物（派生视图 / 本地数据）：存在性机器相关，不报死链
  if (isGitIgnored(rootDir, resolvedRel)) return null;

  return `死链「${ref.target}」（解析为 ${resolvedRel}，仓库内不存在且不在 gitignore 规则内）`;
}

function defaultIsGitIgnored(rootDir, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: rootDir, stdio: 'ignore' });
    return true; // exit 0 = ignored
  } catch {
    return false; // exit 1 = 未被 ignore；非 git 目录等异常同样视为未 ignore
  }
}
