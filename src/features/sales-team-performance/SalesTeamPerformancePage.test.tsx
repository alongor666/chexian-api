import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }));
vi.mock('./hooks/useSalesTeamPerformance', () => ({
  useSalesTeamPerformance: hookMock,
}));

import { SalesTeamPerformancePage } from './SalesTeamPerformancePage';

describe('SalesTeamPerformancePage', () => {
  beforeEach(() => {
    hookMock.mockReturnValue({ data: { rows: [], total: null }, isLoading: false, error: null });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('日期输入互相声明 min/max，浏览器层阻止逆序窗口', () => {
    render(<SalesTeamPerformancePage />);
    const start = screen.getByLabelText('起') as HTMLInputElement;
    const end = screen.getByLabelText('止') as HTMLInputElement;

    fireEvent.change(end, { target: { value: '2026-06-30' } });
    expect(start.max).toBe('2026-06-30');

    fireEvent.change(start, { target: { value: '2026-06-01' } });
    expect(end.min).toBe('2026-06-01');
  });

  it('错误态不向用户泄露 RLS/BACKLOG 等内部术语', () => {
    hookMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('RLS gate failed; see BACKLOG 123'),
    });
    render(<SalesTeamPerformancePage />);

    expect(screen.getByText('销售队伍业绩暂不可用')).toBeTruthy();
    expect(document.body.textContent).toContain('请稍后重试或联系系统管理员');
    expect(document.body.textContent).not.toContain('RLS');
    expect(document.body.textContent).not.toContain('BACKLOG');
  });

  it('空结果使用共享空态文案并明确当前筛选窗口', () => {
    render(<SalesTeamPerformancePage />);
    expect(screen.getByText('当前筛选条件下暂无销售队伍业绩数据')).toBeTruthy();
  });
});
