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
 * 归一化：剥 #锚点、剥 :行号 后缀。R1 链接按 markdown 语义解析（`/` 开头锚定仓库根、
 * 相对路径相对索引文件目录）；R2 token 只做仓库根锚定，且**首段必须是仓库顶层条目**
 * （动态读 rootDir，无人工清单）——索引表格里大量「子目录简写」（如 `routes/`、`cube/`，
 * 依上下文挂在某父目录下）无法机械判定，不在校验范围。
 * 硬跳过：glob（* ? { }）、模板（< >）、占位（YYYY、${）、~ 开头、URL、worktrees 路径。
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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
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
      for (const ref of extractRefs(line)) {
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
export function extractRefs(line) {
  const refs = [];

  // R1: [text](target)
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(line)) !== null) {
    refs.push({ target: m[1].trim(), kind: 'link' });
  }

  // R2: 反引号内联 span 中的路径 token
  const codeRe = /`([^`]+)`/g;
  while ((m = codeRe.exec(line)) !== null) {
    for (const t of extractPathTokens(m[1])) refs.push({ target: t, kind: 'token' });
  }

  // R2 补充：整行是代码（fenced block 内容或缩进代码）时按 token 扫。
  // 索引文件的 fenced block 都是 bash/路径示例，直接对非反引号残余文本做 token 提取
  // 会把表格里的中文说明误扫，故仅当行不含 `|`（非表格）且含 `/` 时做整行 token 提取。
  if (!line.includes('|') && !line.includes('](') && !line.includes('`') && line.includes('/')) {
    for (const t of extractPathTokens(line)) refs.push({ target: t, kind: 'token' });
  }

  return refs;
}

/** 从任意文本片段提取形如路径的 token（含 / 且以已知扩展名或 / 结尾） */
function extractPathTokens(text) {
  const tokens = [];
  for (let word of text.split(/[\s，、；：（）()【】]+/)) {
    word = word.replace(/^[#'"“”‘’]+|['"“”‘’.,;:!?]+$/g, '');
    if (!word.includes('/')) continue;
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
    // markdown 语义：/ 开头 = 仓库根；否则相对索引文件目录
    resolvedRel = target.startsWith('/')
      ? target.slice(1)
      : path.normalize(path.join(path.dirname(indexRel), target));
    if (resolvedRel.startsWith('..')) return null; // 越出仓库，无法校验，放行
    // 链接目标若无扩展名且不含 /，可能是纯文本（如「§2」）——跳过
    if (!resolvedRel.includes('/') && !KNOWN_EXTENSIONS.test(resolvedRel)) return null;
  } else {
    // token：仅校验「仓库根锚定」写法——首段必须是仓库顶层条目，否则视为上下文简写跳过
    resolvedRel = path.normalize(target.replace(/^\.?\//, ''));
    if (resolvedRel.startsWith('..')) return null;
    const firstSegment = resolvedRel.split('/')[0];
    if (!topLevelEntries.has(firstSegment)) return null;
  }

  if (fs.existsSync(path.join(rootDir, resolvedRel))) return null;

  // 链接的相对解析失败时，退一步试仓库根锚定（索引里存在「仓库根相对」写法不带前导 /）
  if (kind === 'link' && !target.startsWith('/') && fs.existsSync(path.join(rootDir, target))) return null;
  const rootRel = target.startsWith('/') ? resolvedRel : path.normalize(target);

  // gitignored 产物（派生视图 / 本地数据）：存在性机器相关，不报死链
  if (isGitIgnored(rootDir, resolvedRel) || isGitIgnored(rootDir, rootRel)) return null;

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
