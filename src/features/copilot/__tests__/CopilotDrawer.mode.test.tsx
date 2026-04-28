/**
 * CopilotDrawer mode-switch test
 *
 * Verifies the new tablist UX:
 *  - default mode is patrol
 *  - clicking forecast tab swaps the panel to ForecastScenarioPanel
 *  - tab roles + aria-selected are wired correctly for accessibility
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { CopilotDrawer } from '../CopilotDrawer';

// Reinstall real in-memory localStorage (sibling test files may shadow it with vi.fn stubs).
function installInMemoryStorage() {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
}
installInMemoryStorage();

// Stub useCopilotRun: drawer relies on it for patrol-mode state, but we never trigger a run here.
vi.mock('../useCopilotRun', () => ({
  useCopilotRun: () => ({
    state: { status: 'idle', runId: null, workflowStatus: null, steps: [], report: null, error: null },
    start: vi.fn(),
    reset: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// AuditTimeline + ApprovalActions are not under test here.
vi.mock('../components/AuditTimeline', () => ({ AuditTimeline: () => null }));
vi.mock('../components/ApprovalActions', () => ({ ApprovalActions: () => null }));

describe('CopilotDrawer mode switcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the drawer and defaults to patrol mode', () => {
    render(<CopilotDrawer />);

    fireEvent.click(screen.getByRole('button', { name: '打开 Copilot' }));

    const patrolTab = screen.getByRole('tab', { name: '经营巡检' });
    const forecastTab = screen.getByRole('tab', { name: '经营利润情景测算' });

    expect(patrolTab.getAttribute('aria-selected')).toBe('true');
    expect(forecastTab.getAttribute('aria-selected')).toBe('false');

    // Patrol panel-specific control should be visible (period date inputs)
    expect(screen.getByText(/auto-risk-control-v1/)).toBeTruthy();
  });

  it('switches to forecast mode and renders ForecastScenarioPanel inputs', () => {
    render(<CopilotDrawer />);
    fireEvent.click(screen.getByRole('button', { name: '打开 Copilot' }));

    fireEvent.click(screen.getByRole('tab', { name: '经营利润情景测算' }));

    expect(screen.getByRole('tab', { name: '经营利润情景测算' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/确定性情景测算（无 LLM/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/2026 终极假设/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '测算情景' })).toBeTruthy();
  });
});
