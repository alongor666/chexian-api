import { expect, type Page } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'CxAdmin@2026!';

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

export const ensureDataLoaded = async (page: Page) => {
  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  if (page.url().includes('#/login')) {
    await login(page);
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
  }

  if (page.url().includes('#/dashboard')) {
    return;
  }

  const dashboardNav = page.getByRole('link', { name: '仪表盘', exact: true });
  if (await dashboardNav.isVisible().catch(() => false)) {
    return;
  }

  const loadedBanner = page.getByText('数据已加载:');
  if (await loadedBanner.isVisible().catch(() => false)) {
    const toDashboard = page.getByRole('button', { name: '进入仪表盘' });
    if (await toDashboard.isVisible().catch(() => false)) {
      await toDashboard.click({ timeout: 3000 }).catch(() => null);
      if (page.url().includes('#/dashboard')) {
        return;
      }
    }
    return;
  }

  const loadButton = page.getByRole('button', { name: '加载' }).first();
  if (await loadButton.isVisible().catch(() => false)) {
    await loadButton.click();
    await page.waitForURL(/#\/dashboard/);
  }
};

export const assertAdvancedDrawerToggles = async (page: Page) => {
  const advancedDrawer = page.locator('aside[aria-label="高级筛选"]');
  const openButton = page.getByRole('button', { name: /筛选/ }).first();
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
