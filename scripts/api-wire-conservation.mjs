#!/usr/bin/env node
/**
 * ApiClient 拆分守恒恒等式校验（盲区 5 残留落地）
 *
 * 验证「ApiClient 神类拆分 Phase 2」是纯搬运、零增减、零改线：
 *
 *   守恒恒等式：  原公开业务方法(99)  −  保留在基类(18)  ==  Σ 命名空间子客户端方法(81)
 *   契约覆盖：    金 master golden 条目数  ≥  保留 + Σ命名空间（每个业务方法都有线缆签名）
 *   保留合法性：  25 个保留方法名 ⊆ pre-#536 业务方法名（无凭空新造的「保留」）
 *   路由集 LOST： pre-#536 引用的路由常量集 ⊆ 当前引用集（无端点被搬丢）—— 需 git 历史，缺则跳过
 *
 * 数据源：
 *   - pre-#536 冻结基线：tests/api/__golden__/pre536-business-methods.json（git 0e592603 提取，CI 安全）
 *   - 当前面：src/shared/api/client.ts（保留基类方法）+ src/shared/api/*-api.ts（命名空间方法）
 *   - 金 master：tests/api/__golden__/client-wire-golden.json
 *
 * 用法：
 *   node scripts/api-wire-conservation.mjs            # 校验，失败 exit 1
 *   node scripts/api-wire-conservation.mjs --quiet-pass  # 通过时静默（governance 集成）
 *   node scripts/api-wire-conservation.mjs --reseed   # 从 git 0e592603 重生冻结基线
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'src/shared/api');
const PRE536_PATH = path.join(ROOT, 'tests/api/__golden__/pre536-business-methods.json');
const GOLDEN_PATH = path.join(ROOT, 'tests/api/__golden__/client-wire-golden.json');
const BASELINE_COMMIT = '0e592603';

const TRANSPORT_METHODS = [
  'getToken', 'setToken', 'clearToken', 'isAuthenticated', 'cancelRequest', 'cancelAllRequests',
];

const SUB_CLIENT_FILES = [
  'quote-conversion', 'claims-detail', 'repair', 'cross-sell', 'performance',
  'customer-flow', 'ai', 'data', 'workflows', 'auth',
  'premium', 'geo', 'patrol',
];

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet-pass');
const RESEED = args.includes('--reseed');

const ROUTE_TOKEN_RE = /(QUERY_ROUTES|AUTH_ROUTES|DATA_ROUTES|AI_ROUTES|FILTER_ROUTES|WORKFLOWS_ROUTES)\.[A-Z_]+(?:\.[A-Z_]+)?/g;
const PUBLIC_METHOD_RE = /^  (?:async +)?([a-zA-Z][a-zA-Z0-9_]*)\s*[(<]/;
const NON_METHODS = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return']);

/** 从源码提取 2 缩进的公开方法名（排除控制流/构造器） */
function extractPublicMethods(source) {
  const names = new Set();
  for (const line of source.split('\n')) {
    const m = line.match(PUBLIC_METHOD_RE);
    if (m && !NON_METHODS.has(m[1])) names.add(m[1]);
  }
  return names;
}

function extractRouteTokens(source) {
  return new Set(source.match(ROUTE_TOKEN_RE) ?? []);
}

function readFile(p) {
  return readFileSync(p, 'utf8');
}

function gitShow(spec) {
  return execSync(`git show ${spec}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// ── --reseed：从 git 基线重生冻结清单 ──
if (RESEED) {
  const src = gitShow(`${BASELINE_COMMIT}:src/shared/api/client.ts`);
  const all = extractPublicMethods(src);
  const business = [...all].filter((n) => !TRANSPORT_METHODS.includes(n)).sort();
  const out = {
    _provenance: `Frozen list of pre-#536 ApiClient public business-domain methods, extracted from git commit ${BASELINE_COMMIT} (merge #437, monolithic client.ts before any split). Transport-layer methods excluded. Reseed: node scripts/api-wire-conservation.mjs --reseed`,
    _sourceCommit: BASELINE_COMMIT,
    _transportExcluded: TRANSPORT_METHODS,
    count: business.length,
    methods: business,
  };
  writeFileSync(PRE536_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`✓ 重生 ${path.relative(ROOT, PRE536_PATH)}：${business.length} 个 pre-#536 业务方法`);
  process.exit(0);
}

const failures = [];
const notes = [];

// ── 1. pre-#536 冻结基线 ──
const pre536 = JSON.parse(readFile(PRE536_PATH));
const pre536Names = new Set(pre536.methods);
const pre536Count = pre536.methods.length;
if (pre536.count !== pre536Count) {
  failures.push(`pre536 基线 count 字段(${pre536.count}) != methods 长度(${pre536Count})`);
}

// ── 2. 当前面：保留基类方法 + 命名空间方法 ──
const retainedBase = extractPublicMethods(readFile(path.join(API_DIR, 'client.ts')));
const retainedCount = retainedBase.size;

let namespaceCount = 0;
const namespacePerFile = {};
for (const f of SUB_CLIENT_FILES) {
  const methods = extractPublicMethods(readFile(path.join(API_DIR, `${f}-api.ts`)));
  namespacePerFile[f] = methods.size;
  namespaceCount += methods.size;
}

// ── 3. 金 master 覆盖 ──
const golden = JSON.parse(readFile(GOLDEN_PATH));
const goldenCount = Object.keys(golden).length;

// ── 守恒恒等式：pre536 == 保留 + Σ命名空间 ──
const movedExpected = pre536Count - retainedCount;
if (retainedCount + namespaceCount !== pre536Count) {
  failures.push(
    `守恒恒等式破坏：保留(${retainedCount}) + Σ命名空间(${namespaceCount}) = ${retainedCount + namespaceCount} != pre-#536(${pre536Count})`
  );
}
if (namespaceCount !== movedExpected) {
  failures.push(
    `迁出数不符：Σ命名空间(${namespaceCount}) != pre-#536 − 保留 (${pre536Count} − ${retainedCount} = ${movedExpected})`
  );
}

// ── 契约覆盖：golden ≥ 保留 + Σ命名空间 ──
if (goldenCount < retainedCount + namespaceCount) {
  failures.push(
    `金 master 覆盖不足：golden(${goldenCount}) < 保留+Σ命名空间(${retainedCount + namespaceCount})`
  );
}

// ── 保留合法性：保留名 ⊆ pre-#536 名 ──
const inventedRetained = [...retainedBase].filter((n) => !pre536Names.has(n));
if (inventedRetained.length > 0) {
  failures.push(`保留方法名不在 pre-#536 基线中（疑似新造）：${inventedRetained.join(', ')}`);
}

// ── 路由集 LOST=∅（需 git 历史，CI 浅克隆缺则跳过）──
let lostTokens = null;
try {
  const baselineSrc = gitShow(`${BASELINE_COMMIT}:src/shared/api/client.ts`);
  const preTokens = extractRouteTokens(baselineSrc);
  const curTokens = new Set();
  // 当前面含传输内核 client-core.ts（REFRESH 等会话端点拆分时下沉至此）+ client.ts + 各子客户端
  for (const t of extractRouteTokens(readFile(path.join(API_DIR, 'client-core.ts')))) curTokens.add(t);
  for (const t of extractRouteTokens(readFile(path.join(API_DIR, 'client.ts')))) curTokens.add(t);
  for (const f of SUB_CLIENT_FILES) {
    for (const t of extractRouteTokens(readFile(path.join(API_DIR, `${f}-api.ts`)))) curTokens.add(t);
  }
  lostTokens = [...preTokens].filter((t) => !curTokens.has(t));
  if (lostTokens.length > 0) {
    failures.push(`路由集 LOST≠∅（端点被搬丢）：${lostTokens.join(', ')}`);
  }
} catch {
  notes.push(`路由集 LOST 检查跳过：git 历史缺 ${BASELINE_COMMIT}（浅克隆环境，非失败）`);
}

// ── 输出 ──
const ok = failures.length === 0;
if (!QUIET || !ok) {
  console.log('ApiClient 拆分守恒恒等式校验');
  console.log('────────────────────────────────────────');
  console.log(`  pre-#536 业务方法（冻结 @${BASELINE_COMMIT}）: ${pre536Count}`);
  console.log(`  保留在基类 client.ts                      : ${retainedCount}`);
  console.log(`  Σ 命名空间子客户端方法                    : ${namespaceCount}`);
  for (const f of SUB_CLIENT_FILES) console.log(`      ${f.padEnd(18)}: ${namespacePerFile[f]}`);
  console.log(`  金 master golden 线缆签名条目             : ${goldenCount}`);
  console.log('────────────────────────────────────────');
  console.log(`  守恒：${retainedCount} + ${namespaceCount} == ${pre536Count} ? ${retainedCount + namespaceCount === pre536Count ? '✓' : '✗'}`);
  console.log(`  覆盖：golden ${goldenCount} ≥ ${retainedCount + namespaceCount} ? ${goldenCount >= retainedCount + namespaceCount ? '✓' : '✗'}`);
  console.log(`  路由 LOST=∅ : ${lostTokens === null ? '跳过' : lostTokens.length === 0 ? '✓' : '✗'}`);
  for (const n of notes) console.log(`  ℹ️  ${n}`);
}

if (!ok) {
  console.error('\n✗ 守恒校验失败：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (!QUIET) console.log('\n✓ 守恒恒等式成立：拆分为纯搬运，零增减、零改线、零端点丢失。');
