/**
 * 省份隔离 · 出口零信任断言（防线④ · fail-closed）— 与 Python branch_assert.py 同款语义。
 *
 * 「四道防线」工程（BACKLOG uid=2026-06-29-claude-a5aa03 / PR #857）第④道兜底：
 * 数据出门（取数结果 / 企微写入 / ETL 落盘）那一刻强制体检，DISTINCT branch_code > 1
 * （跨省混入）即 fail-closed throw 中止。
 *
 * 设计要点（经 architect 评审，与 Python 侧逐项对齐）：
 * - mapping 唯一事实源 = server/src/config/field-registry/fields.json 的
 *   branch_code.derivation.mapping（610→SC / 618→SX），不另立第二套真值。
 * - fail-closed 三段优先级（deriveBranches）：① branch_code 字段（含 NULL 即 throw）；
 *   ② 否则 policy_no[:3] 映射（前缀未命中即 throw，不静默丢弃）；③ 两者皆无 throw。
 *   末尾校验省份值 ⊆ {SC,SX}，未知值 throw（提示同步 fields.json mapping + KNOWN_BRANCHES）。
 * - 空数组（0 行）放行；与「有行但判不出省」严格区分。
 * - national 例外只认显式 allowNational；assertSingleBranch 绝不内部隐式读 env
 *   （避免「误设 env → 断言全面失效」的 fail-open 后门）。env 解析独立成 isNationalView()。
 *
 * 纯函数，无 IO 副作用（仅启动时读一次 fields.json 缓存），可被 vitest 直接 import。
 * 单测见 tests/branch-assert.test.ts。
 */
import { readFileSync } from 'node:fs';

export class BranchIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BranchIsolationError';
  }
}

// fields.json 相对本文件：数据管理/lib/branch-assert.mjs → server/src/config/...
const FIELDS_JSON_URL = new URL('../../server/src/config/field-registry/fields.json', import.meta.url);

let _derivationCache = null;

/**
 * 读 fields.json branch_code.derivation（mapping + prefixLength），返回只读快照。
 * mapping 用 Object.freeze（防缓存被外部静默污染）；prefixLength 直接读 fields.json 的
 * prefixLength（唯一事实源，不从键长推导，防未来变长键省份漂移），缺省时兜底取首键长度。
 */
function loadBranchDerivation() {
  if (_derivationCache) return _derivationCache;
  const registry = JSON.parse(readFileSync(FIELDS_JSON_URL, 'utf-8'));
  const field = (registry.fields || []).find((f) => f.id === 'branch_code');
  const mapping = field?.derivation?.mapping;
  if (!mapping || Object.keys(mapping).length === 0) {
    throw new BranchIsolationError('fields.json branch_code 字段缺少 derivation.mapping');
  }
  const prefixLength = field.derivation.prefixLength || String(Object.keys(mapping)[0]).length;
  _derivationCache = { mapping: Object.freeze({ ...mapping }), prefixLength };
  return _derivationCache;
}

/**
 * 读取 branch_code 的 policy_no 前缀映射（唯一事实源 = fields.json）。
 * @returns {Readonly<Record<string,string>>} 只读视图，如 { '610': 'SC', '618': 'SX' }
 */
export function getBranchMapping() {
  return loadBranchDerivation().mapping;
}

/**
 * 读取 policy_no 前缀长度（唯一事实源 = fields.json branch_code.derivation.prefixLength）。
 * @returns {number}
 */
export function getBranchPrefixLength() {
  return loadBranchDerivation().prefixLength;
}

function isNullish(v) {
  return v === null || v === undefined || v === '';
}

/**
 * 从行集派生省份集合（fail-closed）。
 * @param {Array<Record<string,unknown>>} rows 对象数组（如 DuckDB 查询结果）
 * @returns {Set<string>} 省份集合（⊆ {SC,SX}）；空行集 → 空集合
 */
export function deriveBranches(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return new Set();

  const mapping = getBranchMapping();
  const allowed = new Set(Object.values(mapping));
  const prefixLen = getBranchPrefixLength();
  const first = rows[0];

  let branches;
  if (first && Object.prototype.hasOwnProperty.call(first, 'branch_code')) {
    const vals = rows.map((r) => r.branch_code);
    const nullCnt = vals.filter(isNullish).length;
    if (nullCnt > 0) {
      throw new BranchIsolationError(
        `branch_code 列含 ${nullCnt} 行 NULL，无法判定省份（数据契约违规）— 出口断言 fail-closed 中止`,
      );
    }
    branches = new Set(vals.map(String));
  } else if (first && Object.prototype.hasOwnProperty.call(first, 'policy_no')) {
    const derived = rows.map((r) => (isNullish(r.policy_no) ? undefined : mapping[String(r.policy_no).slice(0, prefixLen)]));
    const missIdx = derived.map((v, i) => (v === undefined ? i : -1)).filter((i) => i >= 0);
    if (missIdx.length > 0) {
      const sample = missIdx
        .slice(0, 5)
        .map((i) => (isNullish(rows[i].policy_no) ? '<NULL>' : String(rows[i].policy_no).slice(0, prefixLen)));
      throw new BranchIsolationError(
        `policy_no 有 ${missIdx.length} 行前缀未命中省份 mapping（NULL/未知前缀），无法判定省份 — ` +
          `出口断言 fail-closed 中止。未命中前缀样例(top5): ${JSON.stringify(sample)}。` +
          `若为新省份上线，须同步 fields.json branch_code.mapping + diagnose_common.KNOWN_BRANCHES`,
      );
    }
    branches = new Set(derived);
  } else {
    throw new BranchIsolationError('行集既无 branch_code 也无 policy_no 字段，无法判定省份 — 出口断言 fail-closed 中止');
  }

  const unknown = [...branches].filter((b) => !allowed.has(b));
  if (unknown.length > 0) {
    throw new BranchIsolationError(
      `检出未知省份值 ${JSON.stringify(unknown.sort())}（不在已注册省份 ${JSON.stringify([...allowed].sort())}）— ` +
        `出口断言 fail-closed 中止。若为新省份上线，须同步 fields.json branch_code.mapping + diagnose_common.KNOWN_BRANCHES`,
    );
  }
  return branches;
}

/**
 * 出口零信任断言：rows 必须单省（DISTINCT branch_code ≤ 1），跨省 fail-closed throw 中止。
 * @param {Array<Record<string,unknown>>} rows
 * @param {{ allowNational?: boolean, context?: string }} [opts]
 *   allowNational: 仅超管全国视图显式声明时为 true（调用方传 isNationalView() 等）；
 *                  本函数绝不内部隐式读 env，避免 fail-open 后门。
 *   context: 错误信息中的调用点标签（如 'postal sync'）。
 */
export function assertSingleBranch(rows, { allowNational = false, context = '' } = {}) {
  const branches = deriveBranches(rows);
  if (branches.size <= 1) return;
  if (allowNational) return;
  const prefix = context ? `[${context}] ` : '';
  throw new BranchIsolationError(
    `${prefix}检出跨省混入 ${JSON.stringify([...branches].sort())}（DISTINCT branch_code > 1），` +
      `出口零信任断言 fail-closed 中止。如确为超管全国视图，须显式 allowNational=true`,
  );
}

/**
 * 解析「超管全国视图」显式声明：环境变量 PROVINCE=ALL（大小写/空白不敏感）。
 *
 * ⚠️ fail-open 风险：误设此 env 会使出口断言对相应调用放行。故仅用于超管全国视图调用点，
 * 且必须由调用方显式 `allowNational: isNationalView()` opt-in；assertSingleBranch 不调用本函数。
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {boolean}
 */
export function isNationalView(env = process.env) {
  return (env.PROVINCE || '').trim().toUpperCase() === 'ALL';
}
