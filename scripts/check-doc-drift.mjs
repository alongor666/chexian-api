#!/usr/bin/env node

/**
 * 架构文档防漂移检查（ARCHITECTURE.md + CODE_INDEX.md vs 代码库实况）
 *
 * 背景：2026-07-08 事实核对（PR #978）发现两份架构文档累计 20+ 处与代码实况不符——
 * 硬编码计数腐烂（features 21→20、routes 12→14、services 28→34）、同文档自相矛盾
 * （19 vs 23 子路由）、引用已删除实体（useApiQuery/patrol/widgets/export）。根因是
 * 文档快照没有任何机器对账机制，只能靠周期性人工审计（且人工也会漏：本脚本首跑即
 * 抓出人工审计漏掉的 `archive/legacy-code/` 失效引用）。本脚本把「文档声称的事实」
 * 与文件系统对账，作为 governance 阻断闸，使漂移在引入的那次提交就红灯。
 *
 * ── 三族检查 ──
 *
 * 1. **路径存在性**（阻断）：文档中引用的仓库路径必须真实存在。
 *    识别范围（保守取高置信 token，控误报）：
 *    a) 全文任意位置的「带扩展名文件路径」（如 server/src/sql/kpi.ts）
 *    b) 反引号包裹、以 / 结尾的目录路径（如 `server/src/agent/routes/`）
 *    c) markdown 相对链接（如 [x](../../src/shared/INDEX.md)，按文档所在目录解析）
 *    跳过规则：含占位符（YYYY、尖括号、星号、省略号、波浪线、美元符）；首段不是仓库根下真实存在的顶层条目
 *    （因此「已下线 `sql-query/`」这类相对片段、`widgets/export` 这类子片段不会误报）；
 *    行内含移除标记（已退役/已删除/已移除/已下线/已清退/已归档/物理删除）——历史记录行
 *    刻意提及已删实体是合法的（变更日志、归档说明）。
 *    ⚠️ 边界（诚实声明）：不带斜杠的裸文件名（如表格里的 `useApiQuery.ts`）不在
 *    本族覆盖内——由第 2 族的反向完整性 + 计数对账间接兜住模块级漂移。
 *
 * 2. **计数对账**（阻断）：文档中保留的少数精确计数必须与文件系统一致——
 *    - CODE_INDEX「共 N 个模块」        == src/features/ 一级目录数
 *    - 「N 个子路由」（所有出现处）      == routes/query.ts 实际挂载的子路由 import 数
 *    - 「共享基础设施（N 个顶层文件）」+「业务域生成器（N 个顶层文件）」
 *                                        == server/src/sql/ 顶层 .ts 文件数
 *    - 「N 个技能定义」                  == server/src/skills/skills/*.skill.ts 数
 *    - 「N 业务子目录」（两份文档）      == server/src/sql/ 业务子目录数（除 __tests__）
 *    文档若把某计数改成「以目录为准」指针（推荐，见 CLAUDE.md 黄金标准），对应断言
 *    自动失效（找不到数字即跳过）——本闸不强迫文档保留数字，只保证保留的数字为真。
 *
 * 3. **反向完整性**（阻断）：代码里新增了模块但文档没登记——
 *    - src/ 与 server/src/ 每个一级目录，必须以 `名字/` 形式出现在两份文档中
 *    - src/features/ 每个模块目录，必须以 `名字/` 形式出现在 CODE_INDEX 中
 *
 * 用法：node scripts/check-doc-drift.mjs [--quiet-pass]
 * 退出码：0 = 无漂移；1 = 发现漂移（列出逐条差异与修复指引）
 *
 * 关联：CLAUDE.md §1（索引与文档）· checkClaudeMdNoStaleCounts（CLAUDE.md 计数启发式，
 * 警告级）是姊妹检查——那边管「不要写会漂的数字」，这边管「写了的必须为真」。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const quietPass = process.argv.includes('--quiet-pass');

const DOCS = [
  'ARCHITECTURE.md',
  '开发文档/00_index/CODE_INDEX.md',
];

const problems = [];

function addProblem(doc, line, kind, detail, fix) {
  problems.push({ doc, line, kind, detail, fix });
}

function listDirs(rel) {
  const abs = path.join(ROOT_DIR, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name);
}

// ============================================================
// 事实采集（文件系统侧）
// ============================================================

const rootEntries = new Set(fs.readdirSync(ROOT_DIR));

const facts = {
  featureDirs: listDirs('src/features'),
  srcTopDirs: listDirs('src'),
  serverTopDirs: listDirs('server/src'),
  sqlTopFiles: fs.existsSync(path.join(ROOT_DIR, 'server/src/sql'))
    ? fs.readdirSync(path.join(ROOT_DIR, 'server/src/sql')).filter((f) => f.endsWith('.ts')).length
    : 0,
  sqlBizSubdirs: listDirs('server/src/sql').filter((d) => d !== '__tests__').length,
  skillFiles: fs.existsSync(path.join(ROOT_DIR, 'server/src/skills/skills'))
    ? fs.readdirSync(path.join(ROOT_DIR, 'server/src/skills/skills')).filter((f) => f.endsWith('.skill.ts')).length
    : 0,
  querySubroutes: (() => {
    const p = path.join(ROOT_DIR, 'server/src/routes/query.ts');
    if (!fs.existsSync(p)) return 0;
    const content = fs.readFileSync(p, 'utf-8');
    // 只数「默认导入自 ./query/」的路由模块（shared 是命名导入工具模块，天然不计入）
    return (content.match(/^import\s+\w+\s+from\s+'\.\/query\//gm) || []).length;
  })(),
};

// ============================================================
// 第 1 族：路径存在性
// ============================================================

const PLACEHOLDER_RE = /YYYY|<|>|\*|…|~|\$|\{|\}/;

function firstSegmentIsRepoRoot(token) {
  return rootEntries.has(token.split('/')[0]);
}

function checkPathToken(doc, lineNo, token) {
  if (PLACEHOLDER_RE.test(token)) return;
  if (token.startsWith('http') || token.startsWith('..') || token.startsWith('/')) return;
  if (!firstSegmentIsRepoRoot(token)) return;
  const abs = path.join(ROOT_DIR, token.replace(/\/$/, ''));
  if (!fs.existsSync(abs)) {
    addProblem(doc, lineNo, '失效路径', `引用了不存在的路径 \`${token}\``,
      '实体已删除/移动 → 更新或删除该引用（若是刻意记录历史，去掉路径反引号改为纯文字）');
  }
}

function checkPaths(doc, content) {
  const lines = content.split('\n');
  const docDir = path.dirname(path.join(ROOT_DIR, doc));

  // 带扩展名的文件路径（全文任意位置）
  const FILE_RE = /(?<![\w/.])((?:[A-Za-z0-9_.\-一-龥]+\/)+[A-Za-z0-9_.\-一-龥]+\.(?:ts|tsx|js|mjs|cjs|md|json|py|yml|yaml|html|css|jsonl))(?![\w/])/g;
  // 反引号包裹、以 / 结尾的目录路径
  const DIR_RE = /`((?:[A-Za-z0-9_.\-一-龥]+\/)+)`/g;
  // markdown 相对链接（按文档所在目录解析）
  const LINK_RE = /\]\((\.{1,2}\/[^)#]+)\)/g;
  // 历史记录行豁免：刻意提及已删实体（变更日志/归档说明）不算失效引用
  const REMOVAL_MARKER_RE = /已(退役|删除|移除|下线|清退|归档)|物理删除/;

  lines.forEach((line, i) => {
    if (REMOVAL_MARKER_RE.test(line)) return;
    for (const m of line.matchAll(FILE_RE)) checkPathToken(doc, i + 1, m[1]);
    for (const m of line.matchAll(DIR_RE)) checkPathToken(doc, i + 1, m[1]);
    for (const m of line.matchAll(LINK_RE)) {
      const abs = path.resolve(docDir, m[1]);
      if (!fs.existsSync(abs)) {
        addProblem(doc, i + 1, '失效链接', `相对链接目标不存在：${m[1]}`,
          '更新链接目标或删除该链接');
      }
    }
  });
}

// ============================================================
// 第 2 族：计数对账
// ============================================================

function assertCount(doc, content, re, actual, label, ssotHint) {
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      const claimed = parseInt(m[1], 10);
      if (claimed !== actual) {
        addProblem(doc, i + 1, '计数漂移', `声称「${m[0]}」，实际 ${label} = ${actual}`,
          `更新数字，或改为「以 ${ssotHint} 为准」指针（推荐，见 CLAUDE.md 黄金标准）`);
      }
    }
  });
}

function checkCounts(doc, content) {
  if (doc.endsWith('CODE_INDEX.md')) {
    assertCount(doc, content, /共 (\d+) 个模块/g, facts.featureDirs.length,
      'src/features/ 一级目录数', 'src/features/ 目录');
    assertCount(doc, content, /(\d+) 个子路由/g, facts.querySubroutes,
      'routes/query.ts 挂载的子路由数', 'routes/query.ts import 清单');
    assertCount(doc, content, /(\d+) 个技能定义/g, facts.skillFiles,
      'server/src/skills/skills/*.skill.ts 数', '该目录');

    // 共享基础设施 N + 业务域生成器 M 必须 == sql 顶层 .ts 总数
    const shared = content.match(/共享基础设施（(\d+) 个顶层文件）/);
    const biz = content.match(/业务域生成器（(\d+) 个顶层文件）/);
    if (shared && biz) {
      const sum = parseInt(shared[1], 10) + parseInt(biz[1], 10);
      if (sum !== facts.sqlTopFiles) {
        addProblem(doc, 0, '计数漂移',
          `SQL 生成器表声称顶层 ${shared[1]} + ${biz[1]} = ${sum} 个文件，实际 server/src/sql/ 顶层 .ts = ${facts.sqlTopFiles}`,
          '新增/删除了顶层生成器 → 同步 SQL 生成器表（含分组小标题计数）');
      }
    }
  }
  // 两份文档都可能声称「N 业务子目录」
  assertCount(doc, content, /(\d+) 业务子目录/g, facts.sqlBizSubdirs,
    'server/src/sql/ 业务子目录数（除 __tests__）', '该目录');
}

// ============================================================
// 第 3 族：反向完整性（代码有、文档无）
// ============================================================

function checkReverseCompleteness(doc, content) {
  const requireMention = (names, scope) => {
    for (const name of names) {
      if (!content.includes(`${name}/`)) {
        addProblem(doc, 0, '未登记模块', `${scope} 存在 \`${name}/\`，但本文档未提及`,
          '新模块须在目录结构/全景表登记一行（职责一句话即可）');
      }
    }
  };
  requireMention(facts.srcTopDirs, 'src/');
  requireMention(facts.serverTopDirs, 'server/src/');
  if (doc.endsWith('CODE_INDEX.md')) {
    requireMention(facts.featureDirs, 'src/features/');
  }
}

// ============================================================
// 主流程
// ============================================================

function main() {
  for (const doc of DOCS) {
    const abs = path.join(ROOT_DIR, doc);
    if (!fs.existsSync(abs)) {
      addProblem(doc, 0, '文档缺失', '文档不存在', '恢复文档或从 DOCS 清单移除');
      continue;
    }
    const content = fs.readFileSync(abs, 'utf-8');
    checkPaths(doc, content);
    checkCounts(doc, content);
    checkReverseCompleteness(doc, content);
  }

  if (problems.length > 0) {
    console.error(`✗ 架构文档漂移：${problems.length} 处（文档声称 ≠ 代码实况）`);
    for (const p of problems) {
      const loc = p.line > 0 ? `${p.doc}:${p.line}` : p.doc;
      console.error(`  - [${p.kind}] ${loc}`);
      console.error(`      ${p.detail}`);
      console.error(`      ▶ ${p.fix}`);
    }
    console.error('  说明：本闸只对账「文档写出的事实」；把易漂计数改为「以 X 为准」指针可让对应断言自然退场。');
    process.exit(1);
  }

  if (!quietPass) {
    console.log(
      `✓ 架构文档无漂移（路径存在性 + 计数对账 + 反向完整性；` +
        `features=${facts.featureDirs.length} · query子路由=${facts.querySubroutes} · ` +
        `sql顶层=${facts.sqlTopFiles} · 技能=${facts.skillFiles}）`
    );
  }
  process.exit(0);
}

main();
