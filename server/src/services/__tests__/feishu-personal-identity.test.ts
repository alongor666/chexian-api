import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret', FEISHU_TENANT_KEY: 'tenant',
  FEISHU_DEFAULT_BRANCH: 'SX', FEISHU_ADMIN_USERIDS: '', FEISHU_SALESMAN_FALLBACK: '',
  FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED: 'true',
}));
const appGet = vi.hoisted(() => vi.fn());

vi.mock('../../config/env.js', () => ({ feishuEnv: env }));
vi.mock('../feishu-app-client.js', () => ({ feishuAppGetJson: appGet }));
vi.mock('../../config/paths.js', () => ({
  getFeishuRoleMappingPath: () => '/missing/roles.json', getSalesmanMappingPaths: () => [],
  getFeishuDepartmentEntitlementsPath: () => '/missing/dept-entitlements.json',
}));

import { feishuService } from '../feishu.js';

beforeEach(() => {
  appGet.mockReset();
  env.FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED = 'true';
});

describe('飞书部门个人账号授权', () => {
  it('命中运城部门返回个人 org_user 权限', async () => {
    appGet.mockResolvedValue({ code: 0, data: { user: { department_ids: ['od-395bce9db9d4acccae3e6da8d25cb672'] } } });
    await expect(feishuService.resolveDepartmentEntitlement('u1')).resolves.toEqual({
      status: 'member', entitlement: expect.objectContaining({ organization: '运城', branchCode: 'SX' }),
    });
  });

  it('非成员与 API 不可用严格区分', async () => {
    appGet.mockResolvedValueOnce({ code: 0, data: { user: { department_ids: ['other'] } } });
    await expect(feishuService.resolveDepartmentEntitlement('u1')).resolves.toEqual({ status: 'not_member' });
    appGet.mockRejectedValueOnce(new Error('contact unavailable'));
    await expect(feishuService.resolveDepartmentEntitlement('u1')).resolves.toEqual({ status: 'unavailable', reason: 'contact unavailable' });
  });

  it('开关关闭时零网络调用', async () => {
    env.FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED = '';
    await expect(feishuService.resolveDepartmentEntitlement('u1')).resolves.toEqual({ status: 'not_member' });
    expect(appGet).not.toHaveBeenCalled();
  });
});

describe('飞书部门个人账号授权：多部门命中最小权限确定性选择（2026-07-14-claude-8ba910）', () => {
  // 运城 / 临汾两部门授权 role 同级（均 org_user），须按 organization 码点序确定性选择。
  // '临汾' < '运城'（码点序），故命中两者时必选中「临汾」，不得并集/升权/随机。
  const YUNCHENG_DEPT_ID = 'od-395bce9db9d4acccae3e6da8d25cb672';
  const LINFEN_DEPT_ID = 'od-8e26a9b703f7976f4590970af4564a51';

  it('一人挂运城+临汾两个授权部门 → 确定性选中码点序靠前的「临汾」', async () => {
    appGet.mockResolvedValue({
      code: 0,
      data: { user: { department_ids: [YUNCHENG_DEPT_ID, LINFEN_DEPT_ID] } },
    });
    await expect(feishuService.resolveDepartmentEntitlement('multi-dept-user')).resolves.toEqual({
      status: 'member',
      entitlement: expect.objectContaining({ organization: '临汾', branchCode: 'SX' }),
    });
  });

  it('命中顺序调换不影响结果（department_ids 顺序无关，仍确定性选中「临汾」）', async () => {
    appGet.mockResolvedValue({
      code: 0,
      data: { user: { department_ids: [LINFEN_DEPT_ID, YUNCHENG_DEPT_ID] } },
    });
    await expect(feishuService.resolveDepartmentEntitlement('multi-dept-user-2')).resolves.toEqual({
      status: 'member',
      entitlement: expect.objectContaining({ organization: '临汾', branchCode: 'SX' }),
    });
  });

  it('多部门命中时发出中文告警，列出全部命中与最终选中机构', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    appGet.mockResolvedValue({
      code: 0,
      data: { user: { department_ids: [YUNCHENG_DEPT_ID, LINFEN_DEPT_ID] } },
    });
    await feishuService.resolveDepartmentEntitlement('multi-dept-user');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('multi-dept-user'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('运城'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('临汾'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('个人映射条目'));
    warnSpy.mockRestore();
  });

  it('单部门命中时不发出多命中告警（回归：单部门行为不变）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    appGet.mockResolvedValue({ code: 0, data: { user: { department_ids: [YUNCHENG_DEPT_ID] } } });
    await feishuService.resolveDepartmentEntitlement('single-dept-user');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
