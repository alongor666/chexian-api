import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockCancelAllRequests = vi.fn();
const mockSetTargetBranch = vi.fn();
const mockGetFilterOptions = vi.fn();

vi.mock('../../api/client', () => ({
  apiClient: {
    setTargetBranch: (...args: unknown[]) => mockSetTargetBranch(...args),
    cancelAllRequests: (...args: unknown[]) => mockCancelAllRequests(...args),
    getFilterOptions: (...args: unknown[]) => mockGetFilterOptions(...args),
  },
}));

const mockCancelQueries = vi.fn();
const mockClear = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    cancelQueries: (...args: unknown[]) => mockCancelQueries(...args),
    clear: (...args: unknown[]) => mockClear(...args),
  }),
}));

vi.mock('../DataContext', () => ({
  useDataStatus: () => ({ isDataLoaded: true }),
}));

vi.mock('../PermissionContext', () => ({
  usePermission: () => ({
    userPermission: {
      username: 'super-admin',
      displayName: '全国超管',
      role: 'branch_admin',
      branchCode: 'SC',
      visibleBranches: ['SC', 'SX'],
    },
  }),
}));

import { BranchProvider, useBranch } from '../BranchContext';
import { StableProvider, useStableContext } from '../StableContext';
import { FilterProvider, useGlobalFilters } from '../FilterContext';

const scOptions = {
  orgs: ['乐山'],
  salesmen: ['张三'],
  salesmenWithOrg: [{ salesman_name: '张三', org_level_3: '乐山' }],
  salesmenWithTeam: [],
  customerCategories: ['个人'],
  coverageCombinations: ['交三'],
  dateRange: { min_date: '2026-01-01', max_date: '2026-05-11' },
  availableYears: [2026],
  insuranceGrades: [],
};

const sxOptions = {
  orgs: ['太原一部'],
  salesmen: ['李四'],
  salesmenWithOrg: [{ salesman_name: '李四', org_level_3: '太原一部' }],
  salesmenWithTeam: [],
  customerCategories: ['企业'],
  coverageCombinations: ['主全'],
  dateRange: { min_date: '2026-01-01', max_date: '2026-05-12' },
  availableYears: [2026],
  insuranceGrades: [],
};

function FilterBranchProbe() {
  const { setBranch } = useBranch();
  const { filterOptions } = useStableContext();
  const { filters, setFilters } = useGlobalFilters();

  return (
    <div>
      <span data-testid="org-options">
        {(filterOptions.org_level_3 || []).map((option) => option.value).join(',')}
      </span>
      <span data-testid="salesman-options">
        {(filterOptions.salesman_name || []).map((option) => option.value).join(',')}
      </span>
      <span data-testid="selected-orgs">{(filters.org_level_3 || []).join(',')}</span>
      <span data-testid="selected-salesmen">{(filters.salesman_name || []).join(',')}</span>
      <button
        onClick={() =>
          setFilters((prev) => ({
            ...prev,
            org_level_3: ['乐山'],
            salesman_name: ['张三'],
          }))
        }
      >
        选中四川筛选
      </button>
      <button onClick={() => setBranch('SX')}>切换到SX</button>
    </div>
  );
}

function renderProviders() {
  return render(
    <BranchProvider>
      <StableProvider>
        <FilterProvider>
          <FilterBranchProbe />
        </FilterProvider>
      </StableProvider>
    </BranchProvider>
  );
}

describe('StableProvider + FilterProvider — 切省筛选器选项和已选值联动', () => {
  beforeEach(() => {
    mockCancelAllRequests.mockClear();
    mockSetTargetBranch.mockClear();
    mockGetFilterOptions.mockReset();
    mockCancelQueries.mockClear();
    mockClear.mockClear();
    mockGetFilterOptions
      .mockResolvedValueOnce(scOptions)
      .mockResolvedValueOnce(sxOptions);

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('全国超管切省后重新加载 /api/filters/options，不沿用旧省机构选项', async () => {
    renderProviders();

    await waitFor(() => expect(screen.getByTestId('org-options').textContent).toBe('乐山'));

    fireEvent.click(screen.getByText('切换到SX'));

    await waitFor(() => expect(mockGetFilterOptions).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('org-options').textContent).toBe('太原一部');
    expect(screen.getByTestId('salesman-options').textContent).toBe('李四');
  });

  it('切省后剔除不属于新省筛选选项的旧机构和旧业务员', async () => {
    renderProviders();

    await waitFor(() => expect(screen.getByTestId('org-options').textContent).toBe('乐山'));
    fireEvent.click(screen.getByText('选中四川筛选'));
    expect(screen.getByTestId('selected-orgs').textContent).toBe('乐山');
    expect(screen.getByTestId('selected-salesmen').textContent).toBe('张三');

    fireEvent.click(screen.getByText('切换到SX'));

    await waitFor(() => expect(screen.getByTestId('org-options').textContent).toBe('太原一部'));
    await waitFor(() => expect(screen.getByTestId('selected-orgs').textContent).toBe(''));
    expect(screen.getByTestId('selected-salesmen').textContent).toBe('');
  });
});
