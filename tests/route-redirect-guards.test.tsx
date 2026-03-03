import React from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthGuard } from '../src/features/auth/AuthGuard';
import { DataGuard } from '../src/components/layout/DataGuard';
import { RouteAccessGuard } from '../src/features/auth/RouteAccessGuard';
import { UserRole } from '../src/shared/config/organizations';
import { Logger } from '../src/shared/utils/logger';

const mockUsePermission = vi.fn();
const mockUseDataStatus = vi.fn();
const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

vi.mock('../src/shared/contexts/PermissionContext', () => ({
  usePermission: () => mockUsePermission(),
}));

vi.mock('../src/shared/contexts/DataContext', () => ({
  useDataStatus: () => mockUseDataStatus(),
}));

const StateEcho: React.FC = () => {
  const location = useLocation();
  return <pre data-testid="state-echo">{JSON.stringify(location.state ?? {})}</pre>;
};

describe('route redirect guards', () => {
  beforeEach(() => {
    mockUsePermission.mockReset();
    mockUseDataStatus.mockReset();
    debugSpy.mockClear();
  });

  afterAll(() => {
    debugSpy.mockRestore();
  });

  it('AuthGuard redirects unauthenticated requests with unified fromPath state', () => {
    mockUsePermission.mockReturnValue({ isAuthenticated: false, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/growth?token=abc']}>
        <Routes>
          <Route path="/growth" element={<AuthGuard><div>protected</div></AuthGuard>} />
          <Route path="/login" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state-echo').textContent).toContain('"fromPath":"/growth?token=abc"');
    expect(debugSpy).toHaveBeenCalledWith('Redirect unauthenticated request to login', { fromPath: '/growth' });
  });

  it('DataGuard redirects no-data requests with unified fromPath state', () => {
    mockUseDataStatus.mockReturnValue({ isDataLoaded: false, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/cross-sell?tab=1']}>
        <Routes>
          <Route path="/cross-sell" element={<DataGuard><div>protected</div></DataGuard>} />
          <Route path="/" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state-echo').textContent).toContain('"fromPath":"/cross-sell?tab=1"');
    expect(debugSpy).toHaveBeenCalledWith('Redirect to home because no data is loaded', { fromPath: '/cross-sell' });
  });

  it('RouteAccessGuard logs sanitized fromPath while preserving redirect state', () => {
    mockUsePermission.mockReturnValue({
      userPermission: {
        username: 'tester',
        displayName: 'tester',
        role: UserRole.ORG_USER,
        organization: '天府',
        allowedRoutes: ['/dashboard'],
        defaultRoute: '/dashboard',
      },
    });

    render(
      <MemoryRouter initialEntries={['/renewal?secret=yes']}>
        <Routes>
          <Route
            path="/renewal"
            element={
              <RouteAccessGuard routePath="/renewal">
                <div>protected</div>
              </RouteAccessGuard>
            }
          />
          <Route path="/dashboard" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state-echo').textContent).toContain('"fromPath":"/renewal?secret=yes"');
    expect(debugSpy).toHaveBeenCalledWith('Route access denied, redirect to fallback', {
      routePath: '/renewal',
      fallbackPath: '/dashboard',
      fromPath: '/renewal',
    });
  });

  it('DataGuard keeps current route while data status is still loading', () => {
    mockUseDataStatus.mockReturnValue({ isDataLoaded: false, isLoading: true });

    render(
      <MemoryRouter initialEntries={['/growth']}>
        <Routes>
          <Route path="/growth" element={<DataGuard><div>protected</div></DataGuard>} />
          <Route path="/" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('正在确认数据状态...')).toBeTruthy();
  });

  it('keeps children when auth and data prerequisites are satisfied', () => {
    mockUsePermission.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockUseDataStatus.mockReturnValue({ isDataLoaded: true, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <DataGuard>
                  <div>ready</div>
                </DataGuard>
              </AuthGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('ready')).toBeTruthy();
  });
});
