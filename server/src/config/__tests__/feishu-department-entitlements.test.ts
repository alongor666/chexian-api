import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS,
  loadFeishuDepartmentEntitlements,
  validateDepartmentEntitlements,
  selectMinimalPrivilegeEntitlement,
  type FeishuDepartmentEntitlement,
} from '../feishu-department-entitlements.js';

const ENV_KEY = 'FEISHU_DEPARTMENT_ENTITLEMENTS_PATH';
let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(async () => {
  prevEnv = process.env[ENV_KEY];
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-dept-ent-'));
});

afterEach(async () => {
  if (prevEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeConfig(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, content, 'utf8');
  return p;
}

describe('内置默认表不变量（回归底线）', () => {
  it('默认表为山西 10 部门、全部 org_user + SX，逐项与历史硬编码一致', () => {
    expect(DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS).toHaveLength(10);
    for (const e of DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS) {
      expect(e.role).toBe('org_user');
      expect(e.branchCode).toBe('SX');
      expect(e.organization).toBeTruthy();
      expect(e.feishuDeptId).toMatch(/^od-/);
    }
    const ids = DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS.map(e => e.feishuDeptId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS.map(e => e.organization)).toContain('运城');
  });
});

describe('loadFeishuDepartmentEntitlements — 加载/回退三路径', () => {
  it('文件缺失（ENOENT）→ 回退内置默认表（零配置行为不变）', async () => {
    process.env[ENV_KEY] = path.join(tmpDir, 'does-not-exist.json');
    const loaded = await loadFeishuDepartmentEntitlements();
    expect(loaded).toEqual(DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS);
  });

  it('文件合法存在 → 整体接管默认表（非合并）', async () => {
    process.env[ENV_KEY] = await writeConfig('ok.json', JSON.stringify({
      entitlements: [
        { feishuDeptId: 'od-new-1', feishuDeptName: '新部门甲', role: 'org_user', organization: '甲机构', branchCode: 'SC' },
      ],
    }));
    const loaded = await loadFeishuDepartmentEntitlements();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({
      feishuDeptId: 'od-new-1', feishuDeptName: '新部门甲', role: 'org_user', organization: '甲机构', branchCode: 'SC',
    });
    // 默认表的部门不再出现 —— 证明是接管而非合并
    expect(loaded.some(e => e.organization === '运城')).toBe(false);
  });

  it('JSON 解析失败 → 回退默认表 + 中文告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[ENV_KEY] = await writeConfig('broken.json', '{ this is not json ]');
    const loaded = await loadFeishuDepartmentEntitlements();
    expect(loaded).toEqual(DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JSON 解析失败'));
  });

  it('文件存在但 entitlements 全非法 → 返回空数组（显式配置 fail-closed，不回退默认）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[ENV_KEY] = await writeConfig('all-bad.json', JSON.stringify({
      entitlements: [{ feishuDeptId: 'od-x', role: 'org_user', organization: '', branchCode: 'SX' }],
    }));
    const loaded = await loadFeishuDepartmentEntitlements();
    expect(loaded).toEqual([]);
  });

  it('运维改文件后无需重启即生效（每次调用实时读盘）', async () => {
    const p = await writeConfig('live.json', JSON.stringify({
      entitlements: [{ feishuDeptId: 'od-a', feishuDeptName: 'A', role: 'org_user', organization: 'A机构', branchCode: 'SX' }],
    }));
    process.env[ENV_KEY] = p;
    expect(await loadFeishuDepartmentEntitlements()).toHaveLength(1);
    await fs.writeFile(p, JSON.stringify({
      entitlements: [
        { feishuDeptId: 'od-a', feishuDeptName: 'A', role: 'org_user', organization: 'A机构', branchCode: 'SX' },
        { feishuDeptId: 'od-b', feishuDeptName: 'B', role: 'org_user', organization: 'B机构', branchCode: 'SX' },
      ],
    }), 'utf8');
    expect(await loadFeishuDepartmentEntitlements()).toHaveLength(2);
  });
});

describe('validateDepartmentEntitlements — 逐条 fail-closed 清洗', () => {
  it('合法条目原样保留，缺 feishuDeptName 时以 ID 兜底', () => {
    const out = validateDepartmentEntitlements([
      { feishuDeptId: 'od-1', feishuDeptName: '甲', role: 'org_user', organization: '甲', branchCode: 'SX' },
      { feishuDeptId: 'od-2', role: 'org_user', organization: '乙', branchCode: 'SC' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].feishuDeptName).toBe('od-2');
  });

  it('非数组输入 → 空数组 + 告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateDepartmentEntitlements({ nope: true })).toEqual([]);
    expect(validateDepartmentEntitlements(undefined)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('逐类非法条目被跳过，合法条目不受连累', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = validateDepartmentEntitlements([
      null,
      'not-an-object',
      { role: 'org_user', organization: '甲', branchCode: 'SX' },                       // 缺 feishuDeptId
      { feishuDeptId: 'od-role', role: 'branch_admin', organization: '甲', branchCode: 'SX' }, // role 非法
      { feishuDeptId: 'od-org', role: 'org_user', organization: '', branchCode: 'SX' },  // organization 空
      { feishuDeptId: 'od-bc1', role: 'org_user', organization: '甲', branchCode: 'sx' }, // branchCode 小写非法
      { feishuDeptId: 'od-bc2', role: 'org_user', organization: '甲', branchCode: 'SXX' },// branchCode 长度非法
      { feishuDeptId: 'od-good', feishuDeptName: '好', role: 'org_user', organization: '好', branchCode: 'SX' }, // 合法
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].feishuDeptId).toBe('od-good');
  });

  it('feishuDeptId 重复 → 保留首条，跳过后续', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = validateDepartmentEntitlements([
      { feishuDeptId: 'od-dup', feishuDeptName: '首', role: 'org_user', organization: '首', branchCode: 'SX' },
      { feishuDeptId: 'od-dup', feishuDeptName: '次', role: 'org_user', organization: '次', branchCode: 'SC' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].organization).toBe('首');
  });
});

describe('selectMinimalPrivilegeEntitlement — 回归：确定性最小权限选择行为不变', () => {
  const mk = (org: string): FeishuDepartmentEntitlement =>
    ({ feishuDeptId: `od-${org}`, feishuDeptName: org, role: 'org_user', organization: org, branchCode: 'SX' });

  it('同级角色按 organization 码点序取首（临汾 < 运城）', () => {
    expect(selectMinimalPrivilegeEntitlement([mk('运城'), mk('临汾')]).organization).toBe('临汾');
    expect(selectMinimalPrivilegeEntitlement([mk('临汾'), mk('运城')]).organization).toBe('临汾');
  });

  it('单条命中原样返回', () => {
    expect(selectMinimalPrivilegeEntitlement([mk('大同')]).organization).toBe('大同');
  });
});
