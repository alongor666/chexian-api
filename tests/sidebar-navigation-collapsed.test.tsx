import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarNavigation } from '../src/components/layout/SidebarNavigation';

const sidebarState = vi.hoisted(() => ({ isMobile: false }));

afterEach(() => {
  sidebarState.isMobile = false;
});

vi.mock('../src/components/layout/SidebarLayout', () => ({
  DESKTOP_SIDEBAR_WIDTH: 96,
  useSidebar: () => ({
    collapsed: true,
    toggle: vi.fn(),
    mobileOpen: false,
    setMobileOpen: vi.fn(),
    isMobile: sidebarState.isMobile,
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

  it('renders the six registry decision domains and their canonical entries on mobile', () => {
    sidebarState.isMobile = true;
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/home']}>
          <SidebarNavigation />
        </MemoryRouter>
      </QueryClientProvider>
    );

    for (const domain of ['经营总览', '增长达成', '成本质量', '客户经营', '专项资源', '平台管理']) {
      expect(screen.getByText(domain)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: '经营看板' }).getAttribute('href')).toBe('/dashboard');
    expect(screen.getByRole('link', { name: '赔案分析' }).getAttribute('href')).toBe('/claims-detail');
    expect(screen.getByRole('link', { name: '数据管理' }).getAttribute('href')).toBe('/data-import');
  });
});
