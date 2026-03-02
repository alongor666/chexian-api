import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthGuard } from '../src/features/auth/AuthGuard';
import { DataGuard } from '../src/components/layout/DataGuard';

const mockUsePermission = vi.fn();
const mockUseDataStatus = vi.fn();

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
  it('AuthGuard redirects unauthenticated requests with unified fromPath state', () => {
    mockUsePermission.mockReturnValue({ isAuthenticated: false, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/growth']}>
        <Routes>
          <Route path="/growth" element={<AuthGuard><div>protected</div></AuthGuard>} />
          <Route path="/login" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state-echo').textContent).toContain('"fromPath":"/growth"');
  });

  it('DataGuard redirects no-data requests with unified fromPath state', () => {
    mockUseDataStatus.mockReturnValue({ isDataLoaded: false, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/cross-sell']}>
        <Routes>
          <Route path="/cross-sell" element={<DataGuard><div>protected</div></DataGuard>} />
          <Route path="/" element={<StateEcho />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state-echo').textContent).toContain('"fromPath":"/cross-sell"');
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
