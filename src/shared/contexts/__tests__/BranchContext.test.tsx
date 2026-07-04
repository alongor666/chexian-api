/**
 * BranchContext.setBranch — 切省 in-flight 回填回归测试
 *
 * 背景（codex 闸-2 P2-2 / BACKLOG 2026-06-27-claude-ddd89e）：
 * 全国超管切省时，若仅 queryClient.clear() 而不先取消在飞的旧省请求，
 * 旧省（如 SC）请求可能晚于 clear() 返回，按同一 query key 回填缓存，
 * 界面显示"新省数据"实为旧省残留（跨省串读）。
 *
 * BranchContext.setBranch 已实现四步清理链：
 *   1) apiClient.setTargetBranch(branch)   — 后续请求带新省 targetBranch
 *   2) apiClient.cancelAllRequests()       — 同步 abort 所有在飞旧省 GET
 *   3) queryClient.cancelQueries()         — 取消 React Query 进行中查询
 *   4) queryClient.clear()                 — 清空缓存（防旧省数据残留）
 *   5) FORCE_REFRESH postMessage           — 通知 Service Worker 清缓存键
 *
 * 本测试断言该调用链顺序不被静默打乱（重构/合并冲突时最容易踩的回归点）。
 * 不测试真实网络竞态（那是 E2E 范畴），只测试"清理编排顺序"这一契约。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─────────────────────────── mock: apiClient ───────────────────────────
// BranchContext 只依赖 apiClient.setTargetBranch / cancelAllRequests，
// 其余方法在本测试路径不会被调用，用 vi.fn() 占位即可。
const mockSetTargetBranch = vi.fn();
const mockCancelAllRequests = vi.fn();

vi.mock('../../api/client', () => ({
  apiClient: {
    setTargetBranch: (...args: unknown[]) => mockSetTargetBranch(...args),
    cancelAllRequests: (...args: unknown[]) => mockCancelAllRequests(...args),
  },
}));

// ─────────────────────────── mock: @tanstack/react-query ───────────────────────────
// 只需要 useQueryClient 返回一个可断言调用顺序的假 queryClient；
// BranchContext 不使用 QueryClientProvider 之外的任何 react-query API。
const mockCancelQueries = vi.fn();
const mockClear = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    cancelQueries: (...args: unknown[]) => mockCancelQueries(...args),
    clear: (...args: unknown[]) => mockClear(...args),
  }),
}));

// ─────────────────────────── mock: PermissionContext ───────────────────────────
// BranchContext 从 usePermission() 读 userPermission.visibleBranches 判断 isMultiBranch。
// 需要 ≥2 个可见省份才会渲染切省 UI（这里通过测试组件里的按钮直接调用 setBranch，
// 不依赖具体下拉 UI，但仍需 isMultiBranch=true 使 setBranch 语义与全国超管场景一致）。
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

// ─────────────────────────── 测试组件：暴露 setBranch 触发点 ───────────────────────────

function SetBranchProbe({ target }: { target: string }) {
  const { setBranch, currentBranch } = useBranch();
  return (
    <div>
      <span data-testid="current-branch">{currentBranch ?? 'null'}</span>
      <button onClick={() => setBranch(target)}>切换到{target}</button>
    </div>
  );
}

describe('BranchContext.setBranch — in-flight 回填回归测试', () => {
  beforeEach(() => {
    mockSetTargetBranch.mockClear();
    mockCancelAllRequests.mockClear();
    mockCancelQueries.mockClear();
    mockClear.mockClear();

    // FORCE_REFRESH 依赖 navigator.serviceWorker.controller；jsdom 默认无该对象，
    // 显式打桩以覆盖第 5 步（postMessage）并可断言调用顺序。
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {
          postMessage: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // @ts-expect-error 测试后移除打桩，避免污染其他测试文件的 navigator
    delete navigator.serviceWorker;
  });

  it('切省时按顺序调用 setTargetBranch → cancelAllRequests → cancelQueries → clear → FORCE_REFRESH', () => {
    const postMessageSpy = (navigator as unknown as {
      serviceWorker: { controller: { postMessage: ReturnType<typeof vi.fn> } };
    }).serviceWorker.controller.postMessage;

    render(
      <BranchProvider>
        <SetBranchProbe target="SX" />
      </BranchProvider>
    );

    // 挂载时的初始化 effect（同步默认省）也会调用 setTargetBranch，
    // 清空一次记录，只关注点击触发的 setBranch 本次调用链。
    mockSetTargetBranch.mockClear();
    mockCancelAllRequests.mockClear();
    mockCancelQueries.mockClear();
    mockClear.mockClear();
    postMessageSpy.mockClear();

    fireEvent.click(screen.getByText('切换到SX'));

    // 1) 每个清理步骤都必须被调用恰好一次
    expect(mockSetTargetBranch).toHaveBeenCalledTimes(1);
    expect(mockSetTargetBranch).toHaveBeenCalledWith('SX');
    expect(mockCancelAllRequests).toHaveBeenCalledTimes(1);
    expect(mockCancelQueries).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'FORCE_REFRESH' });

    // 2) 调用顺序必须是 setTargetBranch → cancelAllRequests → cancelQueries → clear → FORCE_REFRESH。
    //    用 invocationCallOrder 而非日志时间戳断言，避免 fake timer / 异步调度带来的抖动。
    const order = [
      mockSetTargetBranch.mock.invocationCallOrder[0],
      mockCancelAllRequests.mock.invocationCallOrder[0],
      mockCancelQueries.mock.invocationCallOrder[0],
      mockClear.mock.invocationCallOrder[0],
      postMessageSpy.mock.invocationCallOrder[0],
    ];
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);

    // 3) currentBranch 状态确实切换（setSelectedBranch 生效，UI 侧派生逻辑不受影响）
    expect(screen.getByTestId('current-branch').textContent).toBe('SX');
  });

  it('cancelAllRequests 早于 queryClient.clear（关键契约：先关旧省 in-flight 窗口再清缓存）', () => {
    render(
      <BranchProvider>
        <SetBranchProbe target="SX" />
      </BranchProvider>
    );

    mockCancelAllRequests.mockClear();
    mockClear.mockClear();

    fireEvent.click(screen.getByText('切换到SX'));

    const cancelOrder = mockCancelAllRequests.mock.invocationCallOrder[0];
    const clearOrder = mockClear.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(clearOrder);
  });

  it('cancelQueries 早于 queryClient.clear（React Query 进行态先取消再清空）', () => {
    render(
      <BranchProvider>
        <SetBranchProbe target="SX" />
      </BranchProvider>
    );

    mockCancelQueries.mockClear();
    mockClear.mockClear();

    fireEvent.click(screen.getByText('切换到SX'));

    const cancelQueriesOrder = mockCancelQueries.mock.invocationCallOrder[0];
    const clearOrder = mockClear.mock.invocationCallOrder[0];
    expect(cancelQueriesOrder).toBeLessThan(clearOrder);
  });
});
