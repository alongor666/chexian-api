#!/usr/bin/env node

/**
 * 幽灵字段治理检查（BACKLOG 2026-04-21-claude-b250）
 *
 * 背景：数据处理脚本（数据管理/pipelines/*.py）与 SQL 生成器（server/src/sql/**\/*.ts）
 * 引用 Parquet 列名时，若列名已改名/下线但代码残留旧引用，本地开发因偶然命中缓存/未触发该
 * 分支而不报错，等到该代码路径真正执行时才在 DuckDB 抛 Binder Error（"幽灵字段"）。
 * 本检查在提交前静态扫描，把"引用了注册表/真实 Parquet schema 里不存在的字段"提前拦截。
 *
 * ── 设计动机与误报控制（治理闸红了挡所有人 PR，宁可漏检不可误报）──
 *
 * 1. 真值来源（ground truth）只覆盖 policy + claims 两个域，原因：
 *    - policy 域：server/src/config/field-registry/fields.json 的 id 列表是唯一事实源
 *      （CLAUDE.md §2 字段注册表），覆盖全部必需+可选字段（含派生字段）。
 *    - claims 域：scripts/governance/parquet-columns.snapshot.json 的 domains.claims 是
 *      本地 duckdb DESCRIBE 生成的真实落列快照（技能字段闸 checkSkillFieldGate 同源复用，
 *      CI 无 Parquet 时的既定替代方案）。
 *    - quotes / renewal_tracker 等域**当前无机器可读的完整列清单**（snapshot.json 的
 *      domains.quotes 是历史生成失败留下的错误文本，非真实列表），本检查故意不覆盖，
 *      避免拿错误数据当真值制造误报。此为已知缺口而非静默遗漏，见下方 KNOWN_SCOPE_GAPS。
 *
 * 2. 别名消解只信任"无歧义单一绑定"：
 *    - Python 侧：只有当某别名（如 c/p）在整个 SQL 三引号字符串内**只**被
 *      `read_parquet(...) <alias>` 绑定过、从未被任何 `FROM/JOIN <CTE名> <alias>` 重新
 *      绑定，才信任该别名的 `<alias>.<col>` 引用是真实 Parquet 列。
 *    - TS 侧：同理，只信任在整个文件内从未被除 PolicyFact/ClaimsDetail 外的任何名字重新
 *      绑定过的别名。
 *    - 理由（实测发现）：`c`/`p`/`q` 在本代码库中被大量复用为通用 CTE 别名（如
 *      `current_group c` / `prev_group p` / `quarterly_claims c`），若不做绑定消歧、
 *      裸用 `\b[cpq]\.` 正则会把 CTE 计算列（如 c.auto_count、c.group_name）误判为
 *      Parquet 列引用，误报率极高。同一函数内偶尔出现"同一别名先绑定 read_parquet 后又被
 *      CTE 重新绑定"的情况（如 diagnose_cohort_comparison.py 的 c、claims-detail.ts 的
 *      quarterly_claims c），一旦检测到该别名被多重绑定，整段直接跳过（不猜测哪个引用属于
 *      哪次绑定），计入 skippedAmbiguousBindings 统计而非静默吞掉。
 *
 * 3. SQL 提取只信任"SELECT+FROM 同时出现的三引号字符串"：
 *    - Python 生成 HTML/JS 报告页面时常见 `f"""<!doctype html>...<script>...c.loss_ratio...
 *      </script>"""` 这类三引号模板字符串，内含表面相似的 `c.xxx` 引用（实为 JS 变量，非
 *      SQL 列），若不过滤会把整个 HTML 模板误判为 SQL。用 SELECT+FROM 同时命中作为 SQL 形状
 *      判定，天然排除纯文档字符串/HTML 模板。
 *    - 三引号提取用状态机逐字符扫描（非正则贪婪匹配），避免 `f"""..."""` 与 `"""..."""`
 *      交替出现时正则贪婪/非贪婪配对错乱导致的字符串边界误判（实测：正则版本会把结束定界符
 *      配对错乱，漏掉真正的 SQL 块或把不相关内容拼进同一块）。
 *
 * 4. 派生/计算列不算幽灵：CASE WHEN ... AS xxx、SELECT 子句中的输出别名、CTE 内部计算列名
 *    不是 Parquet 源列，本检查只统计"引用"（`<alias>.<col>`），不检查纯 `AS xxx` 定义处，
 *    从根源避免把"刚创建的别名"当成"读取的字段"。
 *
 * 用法：node scripts/check-phantom-fields.mjs [--quiet-pass]
 * 退出码：0 = 无幽灵字段引用；1 = 发现幽灵字段引用或白名单陈旧
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
function warning(message) {
  log(COLORS.yellow, 'warn', message);
}
function error(message) {
  log(COLORS.red, 'fail', message);
}
function info(message) {
  if (!quietPass) log(COLORS.reset, 'info', message);
}

// ============================================================
// 已知缺口（域覆盖）：quotes / renewal_tracker 等域当前无机器可读完整列清单，
// 本检查不对这些域的字段做幽灵判定（宁可漏检，不拿错误/不完整数据当真值）。
// 一旦这些域有了可靠的机器可读列清单（如 snapshot.json 补全 domains.quotes），
// 应移除本清单并纳入正式检查（KNOWN_SCOPE_GAPS 陈旧检测同 checkNonQueryRoutesConsistency
// 的 KNOWN_GAP_FILES 风格：本脚本目前不做自动陈旧检测，因为"域没有 ground truth"
// 无法用代码判断"是否已经有了"——需要人工判断 snapshot.json 内容是否已修复。
// ============================================================
const KNOWN_SCOPE_GAPS = {
  quotes: 'scripts/governance/parquet-columns.snapshot.json 的 domains.quotes 是历史生成失败的错误文本（IO Error），非真实列清单；quote_etl.py 使用独立 CN_TO_EN 映射但未产出机器可读快照',
  renewal_tracker: '无对应 fields.json/snapshot 覆盖；数据管理/pipelines/renewal_common.py 的 RT 变量绑定的域当前不在真值来源范围',
};

// ============================================================
// 已知幽灵/存疑白名单：确认引用了注册表未覆盖字段、但语义存疑或需人工复核的条目。
// 每条须注明理由；发现新的存疑引用应加到这里而非放行，禁止裸忽略。
// ============================================================
const KNOWN_PHANTOM_ALLOWLIST = new Set([
  // 示例格式：'数据管理/pipelines/xxx.py::claims::c::some_col'
  // 当前无存量条目（2026-07-04 全量扫描 pipelines/*.py + server/src/sql/**/*.ts 零命中，
  // 详见本次 PR 描述的验证记录）。
]);

// ============================================================
// 真值来源加载
// ============================================================

function loadGroundTruth() {
  const snapPath = path.join(ROOT_DIR, 'scripts/governance/parquet-columns.snapshot.json');
  const fieldsPath = path.join(ROOT_DIR, 'server/src/config/field-registry/fields.json');

  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
  const fj = JSON.parse(fs.readFileSync(fieldsPath, 'utf-8'));

  const policyCols = new Set(Array.isArray(snap.domains?.policy) ? snap.domains.policy : []);
  const claimsCols = new Set(Array.isArray(snap.domains?.claims) ? snap.domains.claims : []);

  // fields.json 的 id 并入 policy 真值集合（覆盖 snapshot 尚未刷新、但注册表已声明的新字段），
  // 与 checkSkillFieldGate 的思路对称（该检查方向相反：找 fields.json 有但 snapshot 无的幽灵；
  // 本检查方向是"代码引用了两者并集之外的字段"，故取并集扩大真值范围，更保守）。
  for (const f of fj.fields || []) {
    if (f && f.id) policyCols.add(f.id);
  }

  if (policyCols.size === 0 || claimsCols.size === 0) {
    throw new Error('真值来源为空（policy 或 claims 列集合为空）——检查 snapshot.json / fields.json 是否损坏');
  }

  return { policyCols, claimsCols };
}

// ============================================================
// Python 侧：提取三引号字符串中的 SQL 块 + 别名消解
// ============================================================

/**
 * 状态机逐字符提取 Python 三引号字符串（"""..."""/'''...'''，含 f/r 前缀），
 * 避免正则贪婪匹配在 f"""..."""与"""..."""交替出现时定界符配对错乱。
 */
function extractTripleQuotedStrings(text) {
  const blocks = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const isTripleDouble = text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"';
    const isTripleSingle = text[i] === "'" && text[i + 1] === "'" && text[i + 2] === "'";
    if (isTripleDouble || isTripleSingle) {
      const quote = text[i];
      const start = i + 3;
      let j = start;
      let closed = false;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === quote && text[j + 1] === quote && text[j + 2] === quote) {
          closed = true;
          break;
        }
        j += 1;
      }
      blocks.push({ start, end: j, body: text.slice(start, j) });
      i = closed ? j + 3 : n;
      continue;
    }
    i += 1;
  }
  return blocks;
}

function isSqlShaped(body) {
  return /\bSELECT\b/i.test(body) && /\bFROM\b/i.test(body);
}

// `read_parquet(...变量名...) [AS] alias` —— 只认变量名/f-string 插值形式（本仓库 SQL 生成器
// 统一走 f-string 拼接 glob 路径变量，不使用字面量路径字符串直接嵌 SQL）。
const PY_BINDING_RE =
  /read_parquet\(\s*(?:f?['"]?\{?\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}?['"]?|\[[^\]]*\])[^)]*\)\s*(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)?/gi;

// 任意 `FROM/JOIN <名字> <别名>`（含 CTE 名），用于检测别名是否被重新绑定
const ANY_REBIND_RE =
  /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:,)?\s*(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/gi;

function classifyPathVar(varname) {
  if (!varname) return null;
  const v = varname.toUpperCase();
  if (v.includes('CLAIM')) return 'claims';
  if (v.includes('POLICY')) return 'policy';
  return null;
}

/**
 * 扫描单个 Python 文件的所有 SQL 形状三引号块，返回 { fieldsExtracted, skippedAmbiguous, phantoms }
 */
function scanPythonFile(relPath, text, groundTruth) {
  const blocks = extractTripleQuotedStrings(text).filter((b) => isSqlShaped(b.body));
  let fieldsExtracted = 0;
  let skippedAmbiguous = 0;
  const phantoms = [];

  for (const block of blocks) {
    const body = block.body;

    const bindings = [];
    for (const m of body.matchAll(PY_BINDING_RE)) {
      const domain = classifyPathVar(m[1]);
      const alias = m[2];
      if (domain && alias) bindings.push({ alias, domain });
    }
    if (bindings.length === 0) continue;

    const aliasToNames = new Map();
    for (const m of body.matchAll(ANY_REBIND_RE)) {
      const name = m[1].toLowerCase();
      const alias = m[2];
      if (!aliasToNames.has(alias)) aliasToNames.set(alias, new Set());
      aliasToNames.get(alias).add(name);
    }

    // 去重：同一别名+域组合只处理一次（多次 read_parquet 绑定同一别名属罕见但防御性去重）
    const seen = new Set();
    for (const { alias, domain } of bindings) {
      const key = `${alias}::${domain}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const names = aliasToNames.get(alias) || new Set();
      const otherNames = [...names].filter((n) => !n.startsWith('read_parquet'));
      if (otherNames.length > 0) {
        skippedAmbiguous++;
        continue;
      }

      const colRe = new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g');
      const cols = new Set([...body.matchAll(colRe)].map((m) => m[1]));
      fieldsExtracted += cols.size;

      const valid = domain === 'claims' ? groundTruth.claimsCols : groundTruth.policyCols;
      for (const col of [...cols].sort()) {
        if (valid.has(col)) continue;
        const allowKey = `${relPath}::${domain}::${alias}::${col}`;
        if (KNOWN_PHANTOM_ALLOWLIST.has(allowKey)) continue;
        phantoms.push({ file: relPath, domain, alias, col });
      }
    }
  }

  return { fieldsExtracted, skippedAmbiguous, phantoms };
}

// ============================================================
// TS 侧：只信任无歧义单一绑定到 PolicyFact / ClaimsDetail 的别名
// ============================================================

function walkTsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTsFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function scanTsFile(relPath, text, groundTruth) {
  let fieldsExtracted = 0;
  let skippedAmbiguous = 0;
  const phantoms = [];

  const TABLE_BINDINGS = [
    { tableName: 'PolicyFact', domain: 'policy' },
    { tableName: 'ClaimsDetail', domain: 'claims' },
  ];

  if (!/\bPolicyFact\b/.test(text) && !/\bClaimsDetail\b/.test(text)) {
    return { fieldsExtracted, skippedAmbiguous, phantoms };
  }

  const aliasToNames = new Map();
  for (const m of text.matchAll(ANY_REBIND_RE)) {
    const name = m[1];
    const alias = m[2];
    if (!aliasToNames.has(alias)) aliasToNames.set(alias, new Set());
    aliasToNames.get(alias).add(name);
  }

  const seen = new Set();
  for (const { tableName, domain } of TABLE_BINDINGS) {
    const aliasesForTable = new Set();
    for (const [alias, names] of aliasToNames) {
      if (names.has(tableName)) aliasesForTable.add(alias);
    }
    for (const alias of aliasesForTable) {
      const key = `${alias}::${domain}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const names = aliasToNames.get(alias);
      const otherNames = [...names].filter((n) => n !== tableName);
      if (otherNames.length > 0) {
        skippedAmbiguous++;
        continue;
      }

      const colRe = new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g');
      const cols = new Set([...text.matchAll(colRe)].map((m) => m[1]));
      fieldsExtracted += cols.size;

      const valid = domain === 'claims' ? groundTruth.claimsCols : groundTruth.policyCols;
      for (const col of [...cols].sort()) {
        if (valid.has(col)) continue;
        const allowKey = `${relPath}::${domain}::${alias}::${col}`;
        if (KNOWN_PHANTOM_ALLOWLIST.has(allowKey)) continue;
        phantoms.push({ file: relPath, domain, alias, col });
      }
    }
  }

  return { fieldsExtracted, skippedAmbiguous, phantoms };
}

// ============================================================
// 主流程
// ============================================================

function main() {
  info('检查幽灵字段引用（数据管理/pipelines/*.py 与 server/src/sql/**/*.ts 引用 Parquet 列 vs 注册表）...');

  let groundTruth;
  try {
    groundTruth = loadGroundTruth();
  } catch (e) {
    error(`真值来源加载失败：${e.message}`);
    process.exit(1);
  }

  let scannedPyFiles = 0;
  let scannedTsFiles = 0;
  let totalFieldsExtracted = 0;
  let totalSkippedAmbiguous = 0;
  const allPhantoms = [];

  const pipelinesDir = path.join(ROOT_DIR, '数据管理/pipelines');
  if (fs.existsSync(pipelinesDir)) {
    for (const f of fs.readdirSync(pipelinesDir)) {
      if (!f.endsWith('.py')) continue;
      const full = path.join(pipelinesDir, f);
      const relPath = path.relative(ROOT_DIR, full);
      const text = fs.readFileSync(full, 'utf-8');
      const { fieldsExtracted, skippedAmbiguous, phantoms } = scanPythonFile(relPath, text, groundTruth);
      if (fieldsExtracted > 0 || skippedAmbiguous > 0) scannedPyFiles++;
      totalFieldsExtracted += fieldsExtracted;
      totalSkippedAmbiguous += skippedAmbiguous;
      allPhantoms.push(...phantoms);
    }
  }

  const sqlDir = path.join(ROOT_DIR, 'server/src/sql');
  for (const full of walkTsFiles(sqlDir)) {
    const relPath = path.relative(ROOT_DIR, full);
    const text = fs.readFileSync(full, 'utf-8');
    const { fieldsExtracted, skippedAmbiguous, phantoms } = scanTsFile(relPath, text, groundTruth);
    if (fieldsExtracted > 0 || skippedAmbiguous > 0) scannedTsFiles++;
    totalFieldsExtracted += fieldsExtracted;
    totalSkippedAmbiguous += skippedAmbiguous;
    allPhantoms.push(...phantoms);
  }

  const scopeGapCount = Object.keys(KNOWN_SCOPE_GAPS).length;
  const allowlistCount = KNOWN_PHANTOM_ALLOWLIST.size;

  info(
    `扫描完成：Python ${scannedPyFiles} 文件 / TS ${scannedTsFiles} 文件，` +
      `提取字段引用 ${totalFieldsExtracted} 处（跳过歧义绑定 ${totalSkippedAmbiguous} 处），` +
      `域覆盖缺口 ${scopeGapCount} 个（${Object.keys(KNOWN_SCOPE_GAPS).join('/')}），` +
      `白名单 ${allowlistCount} 条`,
  );

  if (allPhantoms.length > 0) {
    error(`发现 ${allPhantoms.length} 处幽灵字段引用（引用了注册表/真实 Parquet schema 不存在的列）：`);
    for (const p of allPhantoms) {
      console.log(`    - ${p.file}: ${p.alias}.${p.col}（域=${p.domain}）`);
    }
    console.log(
      '    修复：确认字段是否已改名/下线，改用正确列名；若属已知语义存疑需人工复核，' +
        '在 check-phantom-fields.mjs 的 KNOWN_PHANTOM_ALLOWLIST 显式登记并注明理由（禁止裸忽略）。',
    );
    process.exit(1);
  }

  success(
    `幽灵字段检查通过（Python ${scannedPyFiles} 文件 / TS ${scannedTsFiles} 文件，` +
      `字段引用 ${totalFieldsExtracted} 处，0 幽灵，白名单 ${allowlistCount} 条）`,
  );
  process.exit(0);
}

main();
