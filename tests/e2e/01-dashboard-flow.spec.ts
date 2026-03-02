import { test, expect, type Page } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'CxAdmin@2026!';

/** 用户名密码登录 */
const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill(E2E_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/#\/(dashboard)?$/);
};

/** 确认已加载数据并进入仪表盘 */
const ensureDataLoaded = async (page: Page) => {
  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('#/login')) {
    await login(page);
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
  }
  const loginHeading = page.getByRole('heading', { name: '车险业绩分析系统' });
  if (await loginHeading.isVisible().catch(() => false)) {
    await login(page);
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
  }
  if (page.url().includes('#/dashboard')) {
    return;
  }

  await expect(page.getByRole('heading', { name: '数据导入' })).toBeVisible();

  const loadedBanner = page.getByText('数据已加载:');
  if (await loadedBanner.isVisible().catch(() => false)) {
    const toDashboard = page.getByRole('button', { name: '进入仪表盘' });
    if (await toDashboard.isVisible().catch(() => false)) {
      await toDashboard.click();
      await page.waitForURL(/#\/dashboard/);
    }
    return;
  }

  const emptyState = page.getByText('暂无数据文件，请上传');
  if (await emptyState.isVisible().catch(() => false)) {
    throw new Error('未发现可加载的数据文件');
  }

  const loadButton = page.getByRole('button', { name: '加载' }).first();
  await expect(loadButton).toBeVisible();
  await loadButton.click();
  await page.waitForURL(/#\/dashboard/);
};

/** 记录关键页面截图 */
const attachScreenshot = async (page: Page, name: string) => {
  const buffer = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: buffer, contentType: 'image/png' });
};

test('仪表盘加载、视角切换与趋势视图切换', async ({ page }: { page: Page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: '保费分析看板' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /保费趋势/ })).toBeVisible();
  await attachScreenshot(page, 'dashboard-loaded');

  await page.getByRole('button', { name: '保单件数' }).click();
  await expect(page.getByRole('heading', { name: /保单件数趋势/ })).toBeVisible();
  await attachScreenshot(page, 'dashboard-perspective-policy-count');

  const monthlyButton = page.getByRole('button', { name: '签单自然月' });
  await monthlyButton.click();
  await expect(monthlyButton).toHaveClass(/bg-primary/);
  await attachScreenshot(page, 'dashboard-timeview-monthly');
});
