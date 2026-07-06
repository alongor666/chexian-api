#!/usr/bin/env node
/**
 * ApiClient 拆分守恒恒等式校验（盲区 5 残留落地）
 *
 * 验证「ApiClient 神类拆分 Phase 2」是纯搬运、零增减、零改线：
 *
 *   守恒恒等式：  pre-#536 业务方法(99) + 拆分后合法新增(POST_SPLIT_ADDITIONS)
 *                 == 保留在基类 + Σ 命名空间子客户端方法
 *   契约覆盖：    金 master golden 条目数  ≥  保留 + Σ命名空间（每个业务方法都有线缆签名）
 *   保留合法性：  保留方法名 ⊆ pre-#536 业务方法名 ∪ 新增清单（无凭空新造的「保留」）
 *   路由集 LOST： pre-#536 引用的路由常量集 ⊆ 当前引用集（无端点被搬丢）—— 需 git 历史，缺则跳过
 *
 * 数据源：
 *   - pre-#536 冻结基线：tests/api/__golden__/pre536-business-methods.json（git 0e592603 提取，CI 安全）
 *   - 当前面：src/shared/api/client.ts（保留基类方法）+ src/shared/api/*-api.ts（命名空间方法）
 *   - 金 master：tests/api/__golden__/client-wire-golden.json
 *
 * ## 演进通道（新增 API 方法的正规路径，缺它护栏会退化成路障）
 *
 * 本脚本不是「冻结 API 面」，而是「冻结无意识漂移」。合法新增一个业务方法时：
 *   1. 在下方 POST_SPLIT_ADDITIONS 登记方法名（基类用裸名，命名空间用 'ns.method'）+ PR 号
 *   2. 在 tests/api/__support__/wire-probe.ts 的 REGISTRY 补一条（金 master 才能覆盖它）
 *   3. `UPDATE_GOLDEN=1 bunx vitest run tests/api/client-wire-golden.test.ts` 重生 golden
 *   4. 本脚本 + `bun run governance` 重新通过
 *
 * 删除方法没有快捷通道——那是破坏性 API 变更，需先确认零调用方（前端 + CLI/MCP/scripts）
 * 再走评审。确认后走 POST_SPLIT_REMOVALS 登记通道（POST_SPLIT_ADDITIONS 的对称版本）：
 *   1. 从源码（*-api.ts）与 wire-probe.ts REGISTRY 删除该方法
 *   2. `UPDATE_GOLDEN=1 bunx vitest run tests/api/client-wire-golden.test.ts` 重生 golden
 *   3. 在下方 POST_SPLIT_REMOVALS 登记 { name, backlogUid/pr, note, routeToken? }
 *      （pre-#536 冻结基线本身**不改**——它是历史事实快照）
 *   4. 若同时保留了对应后端路由常量，routeToken 字段豁免路由集 LOST 检查
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
  'premium', 'geo',
];

/**
 * 拆分后合法新增的业务方法（演进通道，见文件头注释）。
 *
 * 每条：{ name: 方法名（基类裸名 / 命名空间 'ns.method'）, pr: 'PR #编号' }。
 * 登记 = 有意识承认 API 面扩张；不登记直接加方法 → 守恒恒等式红，错误信息会把你带回这里。
 * 计数口径：基类裸名计入「保留」侧，'ns.method' 计入「命名空间」侧（按文件提取自然包含），
 * 故恒等式右边无需改——只把左边期望值从 pre-#536 基数加上本清单长度。
 */
const POST_SPLIT_ADDITIONS = [
  // 例：{ name: 'premium.forecast', pr: 'PR #560' },
  { name: 'getPivot', pr: 'PR #876' }, // 图表账本页 /chart-ledger：维度×指标 pivot 只读查询
];

/**
 * 拆分后合法删除的业务方法（POST_SPLIT_ADDITIONS 的对称通道，首次使用于 B44f2ca）。
 *
 * 与「新增」不同，脚本文件头明确写明"删除方法没有快捷通道——那是破坏性 API 变更，需先确认
 * 零调用方再走评审"。本清单是那次评审确认后的登记点，不是绕过评审的捷径：
 *   1. 已完成：grep 全前端/CLI/MCP/scripts 零真实调用点确认（区分测试自证 vs 真实消费）
 *   2. 在下方登记 { name, backlogUid/pr, note }
 *   3. 从 wire-probe.ts REGISTRY 删除对应条目 + UPDATE_GOLDEN=1 重生 golden
 *   4. pre-#536 冻结基线（pre536-business-methods.json）**不改**——它是历史事实快照，删除
 *      不代表方法在 #536 前不存在；恒等式改为在 pre536Count 上减本清单长度
 *   5. 若同时保留了对应的路由常量（如仍有后端路由但去掉前端唯一调用方），在 routeToken 里
 *      标注该常量令牌，豁免路由集 LOST 检查（否则会被误判为"端点被搬丢"）
 */
const POST_SPLIT_REMOVALS = [
  {
    name: 'ai.analyzeTrend',
    backlogUid: '2026-06-09-claude-44f2ca',
    note: 'PR #547 评审发现零前端调用点；commit 5a759d10（2026-03-10）起 CrossSellOrgTrendChart 改用客户端「程序解读」，之后无组件调用。后端 /api/ai/trend-analysis 路由保守保留。',
    routeToken: 'AI_ROUTES.TREND_ANALYSIS',
  },
  {
    name: 'customerFlow.inflow',
    backlogUid: '2026-06-11-claude-02aa70',
    note: '产品层冗余裁剪 c 点：前端 CustomerFlowPage 仅渲染「流失去向」，从未调用 inflow()（全 src 零 .inflow 调用点）。后端 /api/query/customer-flow/inflow 路由保守保留——服务 agent 诊断链（tool-registry customer_flow.inflow / agent-customer-flow-diagnosis-service）。',
    routeToken: 'QUERY_ROUTES.CUSTOMER_FLOW.INFLOW',
  },
  {
    name: 'patrol.report',
    backlogUid: '2026-07-05-claude-da5ac0',
    note: 'patrol 功能链整链退役：前端零消费（「经营巡检」抽屉走 workflows.run 而非 apiClient.patrol）、引擎无任何调度、产物目录（数据管理/patrol_reports/）从未生成致路由必 404；业务意图（续保盯盘巡检）已由同数据源的 diagnose-renewal v2.2 实质覆盖。与前两条不同：后端 /patrol/:domain 路由、patrol_engine.py、patrol-api.ts、types/patrol.ts 全部同步删除（整链退役，非「路由保留」型豁免）。',
    routeToken: 'QUERY_ROUTES.PATROL',
  },
  {
    name: 'patrol.narrative',
    backlogUid: '2026-07-05-claude-da5ac0',
    note: '同 patrol.report（整链退役，共用 QUERY_ROUTES.PATROL 令牌豁免）。',
  },
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

// ── 守恒恒等式：pre536 + 合法新增 - 合法删除 == 保留 + Σ命名空间 ──
const EVOLUTION_HINT =
  '若是合法新增方法：在本脚本 POST_SPLIT_ADDITIONS 登记（方法名 + PR 号）→ wire-probe.ts REGISTRY 补条目 → UPDATE_GOLDEN=1 重生 golden（详见文件头「演进通道」）；若非有意新增，说明拆分面发生了无意识漂移，须先定位';
const expectedTotal = pre536Count + POST_SPLIT_ADDITIONS.length - POST_SPLIT_REMOVALS.length;
if (retainedCount + namespaceCount !== expectedTotal) {
  failures.push(
    `守恒恒等式破坏：保留(${retainedCount}) + Σ命名空间(${namespaceCount}) = ${retainedCount + namespaceCount} != pre-#536(${pre536Count}) + 新增清单(${POST_SPLIT_ADDITIONS.length}) - 删除清单(${POST_SPLIT_REMOVALS.length})。${EVOLUTION_HINT}`
  );
}

// ── 契约覆盖：golden ≥ 保留 + Σ命名空间 ──
if (goldenCount < retainedCount + namespaceCount) {
  failures.push(
    `金 master 覆盖不足：golden(${goldenCount}) < 保留+Σ命名空间(${retainedCount + namespaceCount})`
  );
}

// ── 保留合法性：保留名 ⊆ pre-#536 名 ∪ 新增清单（基类裸名）──
const additionNames = new Set(POST_SPLIT_ADDITIONS.map((a) => a.name));
const inventedRetained = [...retainedBase].filter((n) => !pre536Names.has(n) && !additionNames.has(n));
if (inventedRetained.length > 0) {
  failures.push(`保留方法名不在 pre-#536 基线也不在新增清单中（疑似未登记新造）：${inventedRetained.join(', ')}。${EVOLUTION_HINT}`);
}

// ── 新增清单自身合法性：登记的方法必须真实存在且已入金 master（防「登记了但没实现/没覆盖」）──
const goldenKeys = new Set(Object.keys(golden));
for (const a of POST_SPLIT_ADDITIONS) {
  if (!a.pr) failures.push(`新增清单条目缺 PR 号：${a.name}（登记必须可追溯）`);
  if (!goldenKeys.has(a.name)) {
    failures.push(`新增清单方法未入金 master golden：${a.name}（先补 wire-probe REGISTRY 再 UPDATE_GOLDEN=1 重生）`);
  }
}

// ── 删除清单自身合法性：登记的方法必须已真实清空（防「登记了但没删干净」）──
for (const r of POST_SPLIT_REMOVALS) {
  if (!r.backlogUid && !r.pr) failures.push(`删除清单条目缺 backlogUid/PR 号：${r.name}（登记必须可追溯）`);
  if (goldenKeys.has(r.name)) {
    failures.push(`删除清单方法仍在金 master golden 中：${r.name}（先从 wire-probe REGISTRY 删除再 UPDATE_GOLDEN=1 重生）`);
  }
  const [ns, bareName] = r.name.includes('.') ? r.name.split('.') : [null, r.name];
  const stillRetained = ns === null && retainedBase.has(bareName);
  const stillNamespaced = ns !== null && (() => {
    try {
      return extractPublicMethods(readFile(path.join(API_DIR, `${ns}-api.ts`))).has(bareName);
    } catch {
      return false;
    }
  })();
  if (stillRetained || stillNamespaced) {
    failures.push(`删除清单方法仍存在于源码：${r.name}（未真正删除，或命名空间/裸名判断有误）`);
  }
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
  const exemptedTokens = new Set(POST_SPLIT_REMOVALS.map((r) => r.routeToken).filter(Boolean));
  const rawLost = [...preTokens].filter((t) => !curTokens.has(t));
  lostTokens = rawLost.filter((t) => !exemptedTokens.has(t));
  const exemptedLost = rawLost.filter((t) => exemptedTokens.has(t));
  if (lostTokens.length > 0) {
    failures.push(`路由集 LOST≠∅（端点被搬丢）：${lostTokens.join(', ')}`);
  }
  if (exemptedLost.length > 0) {
    notes.push(`路由令牌 ${exemptedLost.join(', ')} 因 POST_SPLIT_REMOVALS 登记豁免 LOST 检查（调用方已删；路由保留或随链退役，见各条 note）`);
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
  console.log(`  拆分后合法新增（POST_SPLIT_ADDITIONS）    : ${POST_SPLIT_ADDITIONS.length}`);
  console.log(`  拆分后合法删除（POST_SPLIT_REMOVALS）     : ${POST_SPLIT_REMOVALS.length}`);
  console.log('────────────────────────────────────────');
  console.log(`  守恒：${retainedCount} + ${namespaceCount} == ${pre536Count} + ${POST_SPLIT_ADDITIONS.length} - ${POST_SPLIT_REMOVALS.length} ? ${retainedCount + namespaceCount === expectedTotal ? '✓' : '✗'}`);
  console.log(`  覆盖：golden ${goldenCount} ≥ ${retainedCount + namespaceCount} ? ${goldenCount >= retainedCount + namespaceCount ? '✓' : '✗'}`);
  console.log(`  路由 LOST=∅ : ${lostTokens === null ? '跳过' : lostTokens.length === 0 ? '✓' : '✗'}`);
  for (const n of notes) console.log(`  ℹ️  ${n}`);
}

if (!ok) {
  console.error('\n✗ 守恒校验失败：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (!QUIET) {
  console.log(
    POST_SPLIT_ADDITIONS.length === 0
      ? '\n✓ 守恒恒等式成立：拆分为纯搬运，零增减、零改线、零端点丢失。'
      : `\n✓ 守恒恒等式成立：拆分纯搬运 + ${POST_SPLIT_ADDITIONS.length} 个已登记合法新增（零无意识漂移、零端点丢失）。`
  );
}
