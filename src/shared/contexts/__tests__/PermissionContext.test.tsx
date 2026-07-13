import { describe, expect, it } from 'vitest';
import { normalizeAuthCapabilities } from '../PermissionContext';

describe('PermissionContext auth capabilities', () => {
  it('旧响应默认保留密码能力', () => {
    expect(normalizeAuthCapabilities({})).toEqual({ authMethods: ['password'], canChangePassword: true });
  });

  it('飞书-only 响应显式禁止改密', () => {
    expect(normalizeAuthCapabilities({ authMethods: ['feishu'], canChangePassword: false }))
      .toEqual({ authMethods: ['feishu'], canChangePassword: false });
  });
});
