// @vitest-environment node
// 本工具是 node-only 数据出口断言（生产由 daily.mjs/sync 脚本以 node import）；
// 读 fields.json 依赖 file:// scheme 的 import.meta.url，jsdom 环境下其 base 为 http:// 会失败，
// 故显式走 node 环境（与 vite.config environmentMatchGlobs 中 server 测试走 node 同理）。
/**
 * 省份隔离 · 出口零信任断言（防线④）JS 单测 — 与 Python branch_assert.py 同款语义。
 *
 * 锁定：
 * - 单省 / 空 / 单行 → 放行；跨省（DISTINCT branch_code > 1）→ fail-closed throw
 * - 无 branch_code 字段时从 policy_no[:3] 按 fields.json mapping(610→SC/618→SX) 派生
 * - fail-closed 漏洞：未知 policy_no 前缀不得静默丢弃；branch_code 含 NULL 不得当空集放行
 * - national 例外只认显式 allowNational；assertSingleBranch 绝不内部隐式读 env
 */
import { describe, it, expect } from 'vitest';
import {
  BranchIsolationError,
  assertSingleBranch,
  deriveBranches,
  getBranchMapping,
  getBranchPrefixLength,
  isNationalView,
} from '../数据管理/lib/branch-assert.mjs';

describe('getBranchMapping', () => {
  it('从 fields.json 读取 mapping（唯一事实源）', () => {
    const m = getBranchMapping();
    expect(m['610']).toBe('SC');
    expect(m['618']).toBe('SX');
  });

  it('返回只读对象（防缓存污染 · code-review HIGH-2）', () => {
    expect(Object.isFrozen(getBranchMapping())).toBe(true);
  });
});

describe('getBranchPrefixLength', () => {
  it('从 fields.json prefixLength 读取（非键长推导 · code-review HIGH-1）', () => {
    expect(getBranchPrefixLength()).toBe(3);
  });
});

describe('deriveBranches', () => {
  it('branch_code 字段单省', () => {
    expect(deriveBranches([{ branch_code: 'SC' }, { branch_code: 'SC' }])).toEqual(new Set(['SC']));
  });

  it('branch_code 字段混省', () => {
    expect(deriveBranches([{ branch_code: 'SC' }, { branch_code: 'SX' }])).toEqual(new Set(['SC', 'SX']));
  });

  it('从 policy_no 派生单省', () => {
    expect(deriveBranches([{ policy_no: '6100001' }, { policy_no: '6100002' }])).toEqual(new Set(['SC']));
  });

  it('从 policy_no 派生混省（核心：企微邮政 618 混入 610）', () => {
    expect(deriveBranches([{ policy_no: '6100001' }, { policy_no: '6180001' }])).toEqual(new Set(['SC', 'SX']));
  });

  it('两字段都在 → branch_code 优先', () => {
    expect(deriveBranches([{ branch_code: 'SC', policy_no: '6100001' }])).toEqual(new Set(['SC']));
  });

  it('有 branch_code 无 policy_no → 第 1 段命中', () => {
    expect(deriveBranches([{ branch_code: 'SX' }, { branch_code: 'SX' }])).toEqual(new Set(['SX']));
  });

  it('空数组 → 空集合', () => {
    expect(deriveBranches([])).toEqual(new Set());
  });

  // fail-closed 漏洞 A：未知 policy_no 前缀不得静默丢弃
  it('未知 policy_no 前缀 → throw', () => {
    expect(() => deriveBranches([{ policy_no: '9990001' }, { policy_no: '6100002' }])).toThrow(BranchIsolationError);
  });

  it('policy_no 为 null → throw', () => {
    expect(() => deriveBranches([{ policy_no: '6100001' }, { policy_no: null }])).toThrow(BranchIsolationError);
  });

  // fail-closed 漏洞 B：branch_code 含 NULL 不得当空集放行
  it('branch_code 全 null → throw', () => {
    expect(() => deriveBranches([{ branch_code: null }, { branch_code: null }])).toThrow(BranchIsolationError);
  });

  it('branch_code 部分 null → throw', () => {
    expect(() => deriveBranches([{ branch_code: 'SC', policy_no: '6100001' }, { branch_code: null, policy_no: '6100002' }])).toThrow(
      BranchIsolationError,
    );
  });

  it('未知 branch_code 值（非 SC/SX）→ throw', () => {
    expect(() => deriveBranches([{ branch_code: 'SC' }, { branch_code: 'XX' }])).toThrow(BranchIsolationError);
  });

  it('既无 branch_code 也无 policy_no → throw', () => {
    expect(() => deriveBranches([{ foo: 1 }, { foo: 2 }])).toThrow(BranchIsolationError);
  });

  // code-review MEDIUM-2：schema 不统一（首行有 branch_code、后续行缺该字段）→ undefined 视为 NULL，fail-closed
  it('schema 不统一（首行有 branch_code、后续行无）→ throw', () => {
    expect(() => deriveBranches([{ branch_code: 'SC' }, { policy_no: '6100001' }])).toThrow(BranchIsolationError);
  });
});

describe('assertSingleBranch', () => {
  it('单省 → 放行', () => {
    expect(() => assertSingleBranch([{ branch_code: 'SC' }, { branch_code: 'SC' }])).not.toThrow();
  });

  it('从 policy_no 派生单省 → 放行', () => {
    expect(() => assertSingleBranch([{ policy_no: '6100001' }, { policy_no: '6100002' }])).not.toThrow();
  });

  it('单行 → 放行', () => {
    expect(() => assertSingleBranch([{ policy_no: '6100001' }])).not.toThrow();
  });

  it('空数组 → 放行', () => {
    expect(() => assertSingleBranch([])).not.toThrow();
  });

  it('混省（branch_code）→ throw', () => {
    expect(() => assertSingleBranch([{ branch_code: 'SC' }, { branch_code: 'SX' }])).toThrow(BranchIsolationError);
  });

  it('混省（policy_no 派生）→ throw', () => {
    expect(() => assertSingleBranch([{ policy_no: '6100001' }, { policy_no: '6180001' }], { context: 'postal sync' })).toThrow(
      BranchIsolationError,
    );
  });

  it('allowNational=true → 放行混省', () => {
    expect(() => assertSingleBranch([{ branch_code: 'SC' }, { branch_code: 'SX' }], { allowNational: true })).not.toThrow();
  });

  it('默认 fail-closed（不传 allowNational）', () => {
    expect(() => assertSingleBranch([{ branch_code: 'SC' }, { branch_code: 'SX' }])).toThrow(BranchIsolationError);
  });

  it('context 出现在错误信息中', () => {
    expect(() => assertSingleBranch([{ branch_code: 'SC' }, { branch_code: 'SX' }], { context: 'postal sync' })).toThrow(
      /postal sync/,
    );
  });
});

describe('isNationalView', () => {
  it('PROVINCE=ALL → true（大小写/空白不敏感）', () => {
    expect(isNationalView({ PROVINCE: 'ALL' })).toBe(true);
    expect(isNationalView({ PROVINCE: 'all' })).toBe(true);
    expect(isNationalView({ PROVINCE: ' All ' })).toBe(true);
  });

  it('其它值 → false', () => {
    expect(isNationalView({ PROVINCE: 'SC' })).toBe(false);
    expect(isNationalView({})).toBe(false);
    expect(isNationalView({ PROVINCE: '' })).toBe(false);
  });
});
