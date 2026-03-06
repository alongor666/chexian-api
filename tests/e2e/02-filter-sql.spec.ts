import { test, expect, type Page } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'CxAdmin@2026!';

const waitForBackendReady = async (page: Page) => {
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

const login = async (page: Page) => {
  await waitForBackendReady(page);
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

const ensureDataLoaded = async (page: Page) => {
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
    // 已进入应用壳层（可见侧边栏）时，无需依赖首页按钮文案。
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

/** 记录关键页面截图 */
const attachScreenshot = async (page: Page, name: string) => {
  const buffer = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: buffer, contentType: 'image/png' });
};

test('筛选器交互与报表展示', async ({ page }: { page: Page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.evaluate(() => localStorage.setItem('page-filter-collapsed', 'false'));
  await page.goto('/#/premium-report');
  await expect(page.getByRole('heading', { name: /保费/ }).first()).toBeVisible();

  const expandButton = page.getByTitle('展开筛选器').first();
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }

  const startDateButton = page.getByRole('button', { name: '起保日期' }).first();
  await expect(startDateButton).toBeVisible();
  await startDateButton.click();
  await expect(startDateButton).toHaveAttribute('aria-pressed', 'true');
  await attachScreenshot(page, 'premium-report-filter-date-criteria');
});
