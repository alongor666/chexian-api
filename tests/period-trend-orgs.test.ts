import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { BRANCH_CODE_RE, readBranchOrgUnits, skillSupportsOrgFlag } from '../数据管理/lib/period-trend-orgs.mjs';

/** B004 机构级报告的机构清单读取 — SSOT = config/branch-org-mapping/<branch>.json units */
describe('readBranchOrgUnits', () => {
  let configDir: string;

  const writeMapping = (branch: string, content: unknown) => {
    writeFileSync(
      join(configDir, 'branch-org-mapping', `${branch}.json`),
      JSON.stringify(content),
      'utf-8'
    );
  };

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'pt-orgs-'));
    mkdirSync(join(configDir, 'branch-org-mapping'), { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('正常读取 units（SC 14 机构形态）', () => {
    writeMapping('SC', { branch_code: 'SC', units: ['天府', '宜宾'] });
    expect(readBranchOrgUnits(configDir, 'SC')).toEqual(['天府', '宜宾']);
  });

  it('SSOT 文件不存在 → null（调用方告警跳过机构级，不臆造清单）', () => {
    expect(readBranchOrgUnits(configDir, 'SC')).toBeNull();
  });

  it('branchCode 非两位大写 → 抛错（fail-closed，与 parseStaticReportOwner schema 对齐）', () => {
    for (const bad of ['sc', 'S', 'SCX', 'S1', '四川', '', undefined]) {
      expect(() => readBranchOrgUnits(configDir, bad as string)).toThrow(/非法/);
    }
  });

  it('units 缺失或为空 → 抛错（SSOT 损坏要响，不静默吞）', () => {
    writeMapping('SC', { branch_code: 'SC' });
    expect(() => readBranchOrgUnits(configDir, 'SC')).toThrow(/units 缺失或为空/);
    writeMapping('SX', { branch_code: 'SX', units: [] });
    expect(() => readBranchOrgUnits(configDir, 'SX')).toThrow(/units 缺失或为空/);
  });

  it('units 含非法机构名（路径字符/空串/非字符串）→ 抛错', () => {
    for (const bad of ['a/b', 'a\\b', '..', '', 42, null]) {
      writeMapping('SC', { units: ['天府', bad] });
      expect(() => readBranchOrgUnits(configDir, 'SC')).toThrow(/非法机构名/);
    }
  });

  it('JSON 解析失败 → 抛错（不静默回落）', () => {
    writeFileSync(join(configDir, 'branch-org-mapping', 'SC.json'), '{broken', 'utf-8');
    expect(() => readBranchOrgUnits(configDir, 'SC')).toThrow();
  });
});

describe('BRANCH_CODE_RE', () => {
  it('与 server parseStaticReportOwner 的 branch 段 schema 一致（^[A-Z]{2}$）', () => {
    expect(BRANCH_CODE_RE.test('SC')).toBe(true);
    expect(BRANCH_CODE_RE.test('SX')).toBe(true);
    expect(BRANCH_CODE_RE.test('sc')).toBe(false);
    expect(BRANCH_CODE_RE.test('SCX')).toBe(false);
  });
});

/** B346 治理：skill --org 能力预检（版本落后时 fail-loud，不再逐机构静默失败） */
describe('skillSupportsOrgFlag', () => {
  it('argparse --help 含 --org（v2.3.0+ 各常见排版）→ true', () => {
    expect(skillSupportsOrgFlag('usage: cli.py [--view V] [--org ORG] [--branch BRANCH]')).toBe(true);
    expect(skillSupportsOrgFlag('options:\n  --org ORG        机构过滤\n  --branch BRANCH')).toBe(true);
  });

  it('无 --org（旧版 skill）→ false', () => {
    expect(skillSupportsOrgFlag('usage: cli.py [--view V] [--project-root DIR]')).toBe(false);
    // 相似但不同的 flag 不得误判
    expect(skillSupportsOrgFlag('  --organization X\n  --org-x Y')).toBe(false);
  });

  it('探测失败（空输出 / 非字符串）→ false（fail-closed）', () => {
    expect(skillSupportsOrgFlag('')).toBe(false);
    expect(skillSupportsOrgFlag(undefined)).toBe(false);
    expect(skillSupportsOrgFlag(null)).toBe(false);
  });
});
