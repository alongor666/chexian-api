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
