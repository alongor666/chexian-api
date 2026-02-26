import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe('WeCom mapping path fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.WECOM_ADMIN_USERIDS = '';
  });

  it('falls back to server/data mapping when warehouse path is unavailable', async () => {
    const readFileMock = vi.mocked(fs.readFile);

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

    const { wecomService } = await import('../../server/src/services/wecom');
    const user = await wecomService.resolvePermission('u1001', '测试用户');

    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(user).toEqual({
      username: 'u1001',
      displayName: '测试用户',
      role: 'org_user',
      organization: '乐山',
    });
  });

  it('does not try fallback when primary mapping loads successfully', async () => {
    const readFileMock = vi.mocked(fs.readFile);

    readFileMock.mockResolvedValueOnce(JSON.stringify({
      salesman_mapping: [
        {
          business_no: 'u2002',
          team: '成都一部',
        },
      ],
    }));

    const { wecomService } = await import('../../server/src/services/wecom');
    const user = await wecomService.resolvePermission('u2002');

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(user).toEqual({
      username: 'u2002',
      displayName: 'u2002',
      role: 'org_user',
      organization: '成都一部',
    });
  });
});
