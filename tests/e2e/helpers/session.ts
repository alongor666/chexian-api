import { expect, type Page } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'dev';

export const waitForBackendReady = async (page: Page) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await page.request
      .get('http://localhost:3000/health', { timeout: 3000 })
      .catch(() => null);
    if (response?.ok()) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Backend not ready for login requests');
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

  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill(E2E_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(E2E_PASSWORD);

  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/auth/login'),
      { timeout: 30000 }
    ),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);

  expect(loginResponse.status()).toBe(200);

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
