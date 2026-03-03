import React from 'react';
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../src/features/auth/LoginPage';
import { Logger } from '../src/shared/utils/logger';

const mockUsePermission = vi.fn();

vi.mock('../src/shared/contexts/PermissionContext', () => ({
  usePermission: () => mockUsePermission(),
}));

describe('LoginPage log sanitization', () => {
  const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

  beforeEach(() => {
    debugSpy.mockClear();
    mockUsePermission.mockReset();
  });

  afterAll(() => {
    debugSpy.mockRestore();
  });

  it('masks username and strips querystring for login success log', async () => {
    const loginWithPassword = vi.fn().mockResolvedValue(true);

    mockUsePermission.mockReturnValue({
      loginWithPassword,
      loginWithWecomToken: vi.fn().mockResolvedValue(true),
      restoreSession: vi.fn().mockResolvedValue(true),
      isAuthenticated: false,
      userPermission: null,
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { fromPath: '/growth?token=abc' } }]}>
        <LoginPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'admin123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(loginWithPassword).toHaveBeenCalledWith('admin', 'admin123', true);
    });

    expect(debugSpy).toHaveBeenCalledWith('Login succeeded, navigate to target path', {
      username: 'ad***',
      targetPath: '/growth',
      fromPath: '/growth',
    });
  });
});
