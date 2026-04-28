import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigation } from '../src/components/layout/SidebarNavigation';

vi.mock('../src/components/layout/SidebarLayout', () => ({
  DESKTOP_SIDEBAR_WIDTH: 96,
  useSidebar: () => ({
    collapsed: true,
    toggle: vi.fn(),
    mobileOpen: false,
    setMobileOpen: vi.fn(),
    isMobile: false,
    sidebarWidth: 96,
    setSidebarWidth: vi.fn(),
    isDragging: false,
    setIsDragging: vi.fn(),
  }),
}));

vi.mock('../src/components/layout/SidebarUserPanel', () => ({
  SidebarUserPanel: () => null,
}));

vi.mock('../src/shared/contexts/PermissionContext', () => ({
  usePermission: () => ({
    userPermission: null,
  }),
}));

vi.mock('../src/shared/contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: {},
  }),
}));

vi.mock('../src/shared/hooks/useRBAC', () => ({
  useRBAC: () => ({
    isOrgUser: false,
    userOrg: undefined,
  }),
}));

describe('SidebarNavigation compact rail', () => {
  it('uses a fixed compact rail with visible nav icon and two-character short label', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/performance-analysis']}>
          <SidebarNavigation />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const performanceLink = screen.getByRole('link', { name: '业绩分析' });
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    expect(performanceLink.getAttribute('href')).toBe('/performance-analysis');
    expect(screen.getByText('业绩')).toBeTruthy();
    expect(sidebar.getAttribute('style')).toContain('width: 96px');
    expect(screen.queryByRole('button', { name: /收起侧边栏|展开侧边栏/ })).toBeNull();
  });
});
