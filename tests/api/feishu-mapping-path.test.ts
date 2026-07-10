import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

/** 角色映射文件缺失（ENOENT），让 resolvePermission 回退到下一层 */
function mockRoleMappingAbsent(readFileMock: ReturnType<typeof vi.mocked<typeof fs.readFile>>) {
  const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  readFileMock.mockRejectedValueOnce(enoent);
}

describe('Feishu role mapping（分层授权）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.FEISHU_ADMIN_USERIDS = '';
    process.env.FEISHU_TENANT_KEY = '';
    process.env.BRANCH_CODE = 'SC';
    process.env.FEISHU_SALESMAN_FALLBACK = '';
  });

  it('maps a user to branch_admin tier by user_id', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { user_id: 'boss01' }, role: 'branch_admin', displayName: '王总' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'boss01', name: '王总' });

    expect(user).toEqual({
      username: 'boss01',
      displayName: '王总',
      role: 'branch_admin',
      branchCode: 'SC',
    });
  });

  it('maps a user to org_user tier by mobile (with +86 normalization)', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { mobile: '13800000001' }, role: 'org_user', organization: '乐山' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'u1', name: '李四', mobile: '+8613800000001' });

    expect(user).toEqual({
      username: 'u1',
      displayName: '李四',
      role: 'org_user',
      organization: '乐山',
      branchCode: 'SC',
    });
  });

  it('maps a user to telemarketing tier by email', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { email: 'dianxiao@corp.com' }, role: 'telemarketing_user' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'u2', email: 'dianxiao@corp.com' });

    expect(user).toEqual({
      username: 'u2',
      displayName: 'u2',
      role: 'telemarketing_user',
      branchCode: 'SC',
    });
  });

  it('skips invalid entries (org_user without organization) and falls through', async () => {
    process.env.FEISHU_SALESMAN_FALLBACK = 'true';
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({
        users: [
          { feishu: { user_id: 'u3' }, role: 'org_user' }, // 缺 organization → 非法，跳过
        ],
      }))
      // 业务员映射（第一路径）也未命中
      .mockResolvedValueOnce(JSON.stringify({ salesman_mapping: [] }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'u3' });

    expect(user).toBeNull();
  });

  it('prefers entry-level username over feishu user_id/open_id', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { open_id: 'ou_xue' }, role: 'branch_admin', displayName: '薛成龙', username: 'xuechenglong' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ open_id: 'ou_xue', name: '薛成龙' });

    expect(user).toEqual({
      username: 'xuechenglong',
      displayName: '薛成龙',
      role: 'branch_admin',
      branchCode: 'SC',
    });
  });

  it('prefers entry-level branchCode over global default (per-user province)', async () => {
    process.env.FEISHU_DEFAULT_BRANCH = 'SX';
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { open_id: 'ou_xue' }, role: 'branch_admin', username: 'xuechenglong', branchCode: 'SC' },
        { feishu: { open_id: 'ou_yang' }, role: 'branch_admin', username: 'yangjie0621' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const sichuanAdmin = await feishuService.resolvePermission({ open_id: 'ou_xue', name: '薛成龙' });
    expect(sichuanAdmin?.branchCode).toBe('SC');

    delete process.env.FEISHU_DEFAULT_BRANCH;
  });

  it('falls back to global branch when entry has no branchCode', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { open_id: 'ou_yang' }, role: 'branch_admin', username: 'yangjie0621' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ open_id: 'ou_yang', name: '杨杰' });

    expect(user?.branchCode).toBe('SC'); // BRANCH_CODE=SC，条目未覆盖 → 跟随部署省份
  });

  it('skips entries with malformed branchCode (fail-closed, no silent SC fallback)', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { open_id: 'ou_bad' }, role: 'branch_admin', branchCode: 'shanxi' }, // 非 CHAR(2) 大写 → 整条跳过
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ open_id: 'ou_bad', name: '误配用户' });

    expect(user).toBeNull(); // 兜底默认关闭 → 直接拒绝，而不是带着回退省份放行
  });

  it('rejects users matching an explicit deny entry even when salesman fallback would grant access', async () => {
    process.env.FEISHU_SALESMAN_FALLBACK = 'true';
    const readFileMock = vi.mocked(fs.readFile);
    // 只 mock 角色映射一次读取：deny 命中后不应再读业务员映射
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      users: [
        { feishu: { open_id: 'ou_liangbin_unauthorized' }, role: 'deny', displayName: '梁彬（财产险部）' },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ open_id: 'ou_liangbin_unauthorized', name: '梁彬' });

    expect(user).toBeNull();
    expect(readFileMock).toHaveBeenCalledTimes(1); // deny 即终止，未触达业务员映射
  });
});

describe('Feishu salesman fallback 开关（第 3 层默认关闭 fail-closed）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.FEISHU_ADMIN_USERIDS = '';
    process.env.FEISHU_TENANT_KEY = '';
    process.env.BRANCH_CODE = 'SC';
    process.env.FEISHU_SALESMAN_FALLBACK = '';
  });

  it('rejects name-matched salesman when fallback switch is off (default)', async () => {
    const readFileMock = vi.mocked(fs.readFile);
    mockRoleMappingAbsent(readFileMock);
    // 不再 mock 业务员映射：开关关闭时根本不应读取

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ open_id: 'ou_stranger', name: '梁彬' });

    expect(user).toBeNull();
    expect(readFileMock).toHaveBeenCalledTimes(1); // 仅读了角色映射
  });
});

describe('Feishu mapping path fallback（角色映射缺失时回退业务员映射，需显式开启开关）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.FEISHU_ADMIN_USERIDS = '';
    process.env.FEISHU_TENANT_KEY = '';
    process.env.BRANCH_CODE = 'SC';
    process.env.FEISHU_SALESMAN_FALLBACK = 'true';
  });

  it('falls back to server/data mapping when warehouse path is unavailable', async () => {
    const readFileMock = vi.mocked(fs.readFile);

    mockRoleMappingAbsent(readFileMock);
    readFileMock
      .mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))
      .mockResolvedValueOnce(JSON.stringify({
        salesman_mapping: [
          {
            business_no: 'u1001',
            organization: '乐山',
          },
        ],
      }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'u1001', name: '测试用户' });

    expect(readFileMock).toHaveBeenCalledTimes(3);
    expect(user).toEqual({
      username: 'u1001',
      displayName: '测试用户',
      role: 'org_user',
      organization: '乐山',
      branchCode: 'SC',
    });
  });

  it('does not try fallback when primary mapping loads successfully', async () => {
    const readFileMock = vi.mocked(fs.readFile);

    mockRoleMappingAbsent(readFileMock);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      salesman_mapping: [
        {
          business_no: 'u2002',
          team: '成都一部',
        },
      ],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'u2002' });

    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(user).toEqual({
      username: 'u2002',
      displayName: 'u2002',
      role: 'org_user',
      organization: '成都一部',
      branchCode: 'SC',
    });
  });

  it('rejects users not in role mapping, admin list nor salesman mapping', async () => {
    const readFileMock = vi.mocked(fs.readFile);

    mockRoleMappingAbsent(readFileMock);
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      salesman_mapping: [],
    }));

    const { feishuService } = await import('../../server/src/services/feishu');
    const user = await feishuService.resolvePermission({ user_id: 'stranger' });

    expect(user).toBeNull();
  });
});

describe('Feishu tenant gate (组织门禁 fail-closed)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.BRANCH_CODE = 'SC';
  });

  it('denies everyone when FEISHU_TENANT_KEY is not configured (fail-closed)', async () => {
    process.env.FEISHU_TENANT_KEY = '';
    const { feishuService } = await import('../../server/src/services/feishu');

    expect(feishuService.isTenantAllowed('any_tenant')).toBe(false);
    expect(feishuService.isTenantAllowed(undefined)).toBe(false);
  });

  it('denies users from a different tenant', async () => {
    process.env.FEISHU_TENANT_KEY = 'tenant_abc';
    const { feishuService } = await import('../../server/src/services/feishu');

    expect(feishuService.isTenantAllowed('tenant_other')).toBe(false);
    expect(feishuService.isTenantAllowed(undefined)).toBe(false);
  });

  it('allows users from the configured tenant only', async () => {
    process.env.FEISHU_TENANT_KEY = 'tenant_abc';
    const { feishuService } = await import('../../server/src/services/feishu');

    expect(feishuService.isTenantAllowed('tenant_abc')).toBe(true);
  });
});
