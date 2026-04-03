import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_E2E_PASSWORD, DEFAULT_E2E_USERNAME } from './credentials';

const E2E_USERNAME = process.env.E2E_USERNAME ?? DEFAULT_E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? DEFAULT_E2E_PASSWORD;
const API_BASE = 'http://localhost:3000';

export const waitForBackendReady = async (page: Page) => {
  // CI cold start is slower — allow up to 60s (40 attempts × 1.5s)
  const maxAttempts = process.env.CI ? 40 : 20;
  const delay = process.env.CI ? 1500 : 500;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await page.request
      .get('http://localhost:3000/health', { timeout: 5000 })
      .catch(() => null);
    if (response?.ok()) {
      // Also verify login endpoint is reachable
      const loginCheck = await page.request
        .post('http://localhost:3000/api/auth/login', {
          data: { username: 'probe', password: 'probe' },
          timeout: 5000,
        })
        .catch(() => null);
      if (loginCheck) return; // 401 is fine — endpoint is reachable
    }
    await page.waitForTimeout(delay);
  }
  throw new Error('Backend not ready after ' + maxAttempts + ' attempts');
};

export const login = async (page: Page) => {
  await waitForBackendReady(page);
  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  const appShell = page.getByRole('navigation', { name: '主导航' });
  const appShellVisible = await appShell.isVisible().catch(() => false);
  if (!page.url().includes('#/login') && appShellVisible) {
    return;
  }

  if (page.url().includes('#/login')) {
    await Promise.race([
      page.waitForURL((url) => !url.hash.startsWith('#/login'), {
        waitUntil: 'domcontentloaded',
        timeout: 3000,
      }).catch(() => null),
      page.getByRole('button', { name: '登录', exact: true }).waitFor({
        state: 'visible',
        timeout: 3000,
      }).catch(() => null),
    ]);
    if (!page.url().includes('#/login') && await appShell.isVisible().catch(() => false)) {
      return;
    }
  }

  const loginResponse = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
    timeout: 30000,
  });

  expect(loginResponse.status()).toBe(200);
  const loginPayload = await loginResponse.json();
  const accessToken = loginPayload?.data?.token;
  expect(accessToken).toBeTruthy();

  await page.context().addCookies([{
    name: 'cx_access_token',
    value: accessToken,
    url: 'http://localhost',
    httpOnly: true,
    sameSite: 'Lax',
  }]);

  await page.goto('/#/login');
  await page.evaluate(() => {
    window.localStorage.setItem('chexian_auth_session_hint', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForURL(
    (url) => !url.hash.startsWith('#/login') && !url.pathname.endsWith('/login'),
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );
};

export const ensureDataLoaded = async (page: Page): Promise<boolean> => {
  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  if (page.url().includes('#/login')) {
    await login(page);
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
  }

  // Already on dashboard means data is loaded
  if (page.url().includes('#/dashboard')) {
    return true;
  }

  // Check backend data status directly via API
  const dataLoaded = await page.evaluate(async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const resp = await fetch('/api/data/files', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) return false;
      const files = await resp.json();
      return Array.isArray(files) && files.some((f: { isCurrent?: boolean }) => f.isCurrent);
    } catch {
      return false;
    }
  });

  if (!dataLoaded) {
    // No data available (e.g. CI environment) — try loading first available file
    const loaded = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch('/api/data/files', { headers });
        if (!resp.ok) return false;
        const files = await resp.json();
        if (!Array.isArray(files) || files.length === 0) return false;
        const loadResp = await fetch(`/api/data/load/${encodeURIComponent(files[0].filename)}`, {
          method: 'POST',
          headers,
        });
        return loadResp.ok;
      } catch {
        return false;
      }
    });

    if (!loaded) {
      // No data files at all — return false so caller can decide
      return false;
    }
  }

  // Data is loaded — try navigating to dashboard to confirm
  const dashboardNav = page.getByRole('link', { name: '仪表盘', exact: true });
  if (await dashboardNav.isVisible().catch(() => false)) {
    await dashboardNav.click();
    await page.waitForURL(/#\/dashboard/, { timeout: 5000 }).catch(() => null);
  }

  return true;
};

export const skipWhenNoData = async (page: Page): Promise<boolean> => {
  const hasData = await ensureDataLoaded(page);
  if (hasData) {
    return true;
  }

  if (page.url().includes('#/login')) {
    await login(page);
  }

  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  const loginHeading = page.getByRole('heading', { name: '车险业绩分析系统' });
  if (await loginHeading.isVisible().catch(() => false)) {
    await login(page);
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
  }

  await page.waitForURL((url) => {
    const hash = url.hash || '';
    return hash.startsWith('#/data-import') || hash.startsWith('#/dashboard');
  }, { timeout: 10000 }).catch(() => null);

  if (page.url().includes('#/dashboard')) {
    return true;
  }

  test.info().annotations.push({
    type: 'skip-reason',
    description: 'No Parquet data available — skipped data-dependent assertions',
  });
  return false;
};

export const assertAdvancedDrawerToggles = async (page: Page) => {
  const advancedDrawer = page.locator('aside[aria-label="高级筛选"]');
  const plainFilterButton = page.getByRole('button', { name: /^筛选(?:\s+\d+)?$/ }).first();
  const labeledFilterButton = page.getByRole('button', { name: /^(打开高级筛选|高级筛选.*)$/ }).first();
  const openButton = await plainFilterButton.isVisible().catch(() => false)
    ? plainFilterButton
    : labeledFilterButton;
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(advancedDrawer).toBeVisible();
  const closeButton = page.getByRole('button', { name: /关闭高级筛选|关闭筛选/ });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(advancedDrawer).toHaveClass(/translate-x-full/);
};
