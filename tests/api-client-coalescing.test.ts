import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../src/shared/api/client';

describe('apiClient in-flight coalescing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    apiClient.cancelAllRequests();
  });

  it('coalesces same GET request into one fetch call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    const [first, second] = await Promise.all([
      apiClient.getTrend('week', { dateField: 'policy_date' }),
      apiClient.getTrend('week', { dateField: 'policy_date' }),
    ]);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce requests with different query keys', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    await Promise.all([
      apiClient.getTrend('week', { dateField: 'policy_date', orgName: 'A' }),
      apiClient.getTrend('week', { dateField: 'policy_date', orgName: 'B' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces same query params with different key order', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    await Promise.all([
      apiClient.getTrend('week', { dateField: 'policy_date', startDate: '2026-01-01', endDate: '2026-01-31' }),
      apiClient.getTrend('week', { endDate: '2026-01-31', startDate: '2026-01-01', dateField: 'policy_date' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
