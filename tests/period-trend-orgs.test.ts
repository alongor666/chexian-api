import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import {
  BRANCH_CODE_RE,
  readBranchOrgUnits,
  skillSupportsOrgFlag,
  listBranchOrgMappingCodes,
  planProvinceMirror,
  parseSkillVersion,
  skillSupportsBranchOnlyMode,
  resolvePeriodTrendSkillDir,
} from '../数据管理/lib/period-trend-orgs.mjs';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import * as periodTrendOrgs from '../数据管理/lib/period-trend-orgs.mjs';
import { BRANCH_ORGANIZATIONS } from '../src/shared/config/organizations';
import { ORG_GROUPS_BY_BRANCH } from '../src/shared/config/org-groups';
import { PRESET_USERS } from '../server/src/config/preset-users.js';

/** 真仓 config 目录（对账用，非 tmp fixture；vitest 以仓库根为 cwd，同 customer-flow-etl-contract） */
const REAL_CONFIG_DIR = join(process.cwd(), '数据管理', 'config');

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

/** B346 SX follow-up P1：省级分省能力闸（可执行发布契约，按 SKILL.md 版本判定） */
describe('parseSkillVersion', () => {
  it('解析 frontmatter version: "X.Y.Z"', () => {
    expect(parseSkillVersion('---\nname: x\nversion: "2.5.0"\n---')).toEqual({ major: 2, minor: 5, patch: 0 });
    expect(parseSkillVersion('version: 2.4.1')).toEqual({ major: 2, minor: 4, patch: 1 });
    expect(parseSkillVersion('version: "10.0.3"')).toEqual({ major: 10, minor: 0, patch: 3 });
  });
  it('无版本行 / 非字符串 → null', () => {
    expect(parseSkillVersion('name: x')).toBeNull();
    expect(parseSkillVersion('')).toBeNull();
    expect(parseSkillVersion(undefined)).toBeNull();
  });
});

describe('skillSupportsBranchOnlyMode（v2.5.0+ 才支持「仅 --branch」省级模式）', () => {
  it('v2.5.0 / v2.6 / v3.0 → true', () => {
    expect(skillSupportsBranchOnlyMode({ major: 2, minor: 5, patch: 0 })).toBe(true);
    expect(skillSupportsBranchOnlyMode({ major: 2, minor: 6, patch: 0 })).toBe(true);
    expect(skillSupportsBranchOnlyMode({ major: 3, minor: 0, patch: 0 })).toBe(true);
  });
  it('v2.4.x / v2.3.0 → false（有 --org 但拒绝仅 --branch，会静默降级）', () => {
    expect(skillSupportsBranchOnlyMode({ major: 2, minor: 4, patch: 9 })).toBe(false);
    expect(skillSupportsBranchOnlyMode({ major: 2, minor: 3, patch: 0 })).toBe(false);
  });
  it('版本解析失败（null）→ false（fail-closed）', () => {
    expect(skillSupportsBranchOnlyMode(null)).toBe(false);
    expect(skillSupportsBranchOnlyMode(undefined)).toBe(false);
  });
});

/** B346 P1：report 发布入口不得把省级生成失败的陈旧产物同步上线。 */
describe('shouldAbortReportSync', () => {
  const shouldAbortReportSync = (periodTrendOrgs as Record<string, unknown>).shouldAbortReportSync as
    | ((result: { provinceContractFailed?: boolean; provinceGenFailures?: string[] } | undefined) => boolean)
    | undefined;

  it('能力闸失败或任一省级生成失败 → 中止 report 同步', () => {
    expect(shouldAbortReportSync).toBeTypeOf('function');
    expect(shouldAbortReportSync?.({ provinceContractFailed: true, provinceGenFailures: [] })).toBe(true);
    expect(shouldAbortReportSync?.({ provinceContractFailed: false, provinceGenFailures: ['SX'] })).toBe(true);
  });

  it('能力闸通过且全部省级生成成功 → 允许同步', () => {
    expect(shouldAbortReportSync?.({ provinceContractFailed: false, provinceGenFailures: [] })).toBe(false);
    expect(shouldAbortReportSync?.(undefined)).toBe(false);
  });
});

/** B346 治理：省份枚举数据驱动（新省 = 落一份 <branch>.json，禁硬编码 SC/SX） */
describe('listBranchOrgMappingCodes', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'pt-codes-'));
    mkdirSync(join(configDir, 'branch-org-mapping'), { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('仅识别 <两位大写>.json，排序返回', () => {
    for (const f of ['SX.json', 'SC.json', 'readme.md', 'sc.json', 'SCX.json', 'GD.json']) {
      writeFileSync(join(configDir, 'branch-org-mapping', f), '{}', 'utf-8');
    }
    expect(listBranchOrgMappingCodes(configDir)).toEqual(['GD', 'SC', 'SX']);
  });

  it('目录不存在 → []', () => {
    expect(listBranchOrgMappingCodes(join(configDir, 'nope'))).toEqual([]);
  });
});

/** B346 治理：省级产物镜像到 branches/<部署省>/ 的选组逻辑 */
describe('planProvinceMirror', () => {
  it('取最新 cutoff 的一组文件（含多视图），忽略非报告文件', () => {
    expect(
      planProvinceMirror([
        '2026-07-06-dashboard.html',
        '2026-07-06-narrative.html',
        '2026-06-29-dashboard.html',
        'manifest.json',
        'orgs',
        'branches',
      ])
    ).toEqual({
      date: '2026-07-06',
      files: ['2026-07-06-dashboard.html', '2026-07-06-narrative.html'],
    });
  });

  it('裸日期文件名（旧版 <cutoff>.html）也识别', () => {
    expect(planProvinceMirror(['2026-07-06.html'])).toEqual({
      date: '2026-07-06',
      files: ['2026-07-06.html'],
    });
  });

  it('无匹配 → null', () => {
    expect(planProvinceMirror([])).toBeNull();
    expect(planProvinceMirror(['manifest.json'])).toBeNull();
  });
});

/**
 * 真仓 SSOT 对账（山西 SX / 四川 SC 双省，禁硬编码漂移）：
 * 机构清单 JSON（生成端 SSOT）↔ ORG_GROUPS_BY_BRANCH（分组权威定义）
 * ↔ BRANCH_ORGANIZATIONS（权限侧机构注册表）↔ PRESET_USERS（预置账号）。
 * 任一方增删机构/省份而未同步，此处变红。
 */
describe('真仓对账：branch-org-mapping ↔ 注册表 ↔ 预置账号', () => {
  const registeredBranches = Object.keys(BRANCH_ORGANIZATIONS);

  it('每个已注册省份都有 branch-org-mapping/<省>.json（机构级报告生成覆盖所有省）', () => {
    const codes = listBranchOrgMappingCodes(REAL_CONFIG_DIR);
    for (const b of registeredBranches) {
      expect(codes, `缺 数据管理/config/branch-org-mapping/${b}.json`).toContain(b);
    }
  });

  it('各省 units ≡ ORG_GROUPS_BY_BRANCH 同城∪异地（分组权威定义零漂移）', () => {
    for (const b of registeredBranches) {
      const units = readBranchOrgUnits(REAL_CONFIG_DIR, b) as string[];
      const groups = ORG_GROUPS_BY_BRANCH[b];
      expect(groups, `ORG_GROUPS_BY_BRANCH 缺省份 ${b}`).toBeDefined();
      expect([...units].sort(), `省 ${b} units 与分组定义不一致`).toEqual(
        [...groups.SAME_CITY, ...groups.REMOTE].sort()
      );
    }
  });

  it('权限侧机构注册表 ⊆ units（每个可开账号的机构都有报告生成单元）', () => {
    for (const b of registeredBranches) {
      const units = new Set(readBranchOrgUnits(REAL_CONFIG_DIR, b) as string[]);
      for (const org of BRANCH_ORGANIZATIONS[b]) {
        expect(units.has(org), `省 ${b} 机构「${org}」不在 units（该机构账号将永无机构级报告）`).toBe(true);
      }
    }
  });

  it('每个活跃预置 org_user 的 organization ∈ 本省 units（账号必有对应机构级报告目录）', () => {
    // active:false 的退役墓碑账号（如 sx_jdcszk，其 organization 是已拆除的旧合并值
    // 「经代、车商、重客」，2026-07-15 拆分为 经代/车商/重客）不参与对账——
    // 墓碑保留是防 preset 兜底写回复活，不代表该机构仍需报告目录。
    const orgUsers = Object.values(PRESET_USERS).filter(
      (u) => u.role === 'org_user' && u.active !== false
    );
    expect(orgUsers.length).toBeGreaterThan(0);
    for (const u of orgUsers) {
      expect(u.branchCode, `org_user ${u.username} 缺 branchCode`).toMatch(/^[A-Z]{2}$/);
      const units = readBranchOrgUnits(REAL_CONFIG_DIR, u.branchCode as string) as string[];
      expect(units, `${u.username}（${u.branchCode}/${u.organization}）不在机构清单`).toContain(
        u.organization
      );
    }
  });
});

/** 技能根目录解析 — env 覆盖优先，缺省回退 ~/.claude/skills（发布链 pin 私有快照根治用） */
describe('resolvePeriodTrendSkillDir', () => {
  const HOME = '/home/tester';
  const DEFAULT = join(HOME, '.claude/skills/diagnose-period-trend');

  it('未设 env → 回退 ~/.claude/skills（零行为变化）', () => {
    expect(resolvePeriodTrendSkillDir({}, HOME)).toBe(DEFAULT);
  });

  it('PERIOD_TREND_SKILL_DIR 非空 → 采用 env 值', () => {
    const pinned = '/root/workspace/release-skills/skills/diagnose-period-trend';
    expect(resolvePeriodTrendSkillDir({ PERIOD_TREND_SKILL_DIR: pinned }, HOME)).toBe(pinned);
  });

  it('env 值前后空白被 trim', () => {
    const pinned = '/srv/skills/diagnose-period-trend';
    expect(resolvePeriodTrendSkillDir({ PERIOD_TREND_SKILL_DIR: `  ${pinned}  ` }, HOME)).toBe(pinned);
  });

  it('env 为空串 / 纯空白 → 视同未设，回退缺省', () => {
    expect(resolvePeriodTrendSkillDir({ PERIOD_TREND_SKILL_DIR: '' }, HOME)).toBe(DEFAULT);
    expect(resolvePeriodTrendSkillDir({ PERIOD_TREND_SKILL_DIR: '   ' }, HOME)).toBe(DEFAULT);
  });

  it('env 为 undefined（对象无此键）→ 回退缺省', () => {
    expect(resolvePeriodTrendSkillDir({ OTHER: 'x' }, HOME)).toBe(DEFAULT);
  });
});
