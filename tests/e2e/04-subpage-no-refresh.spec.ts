import { test, expect, type Page } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'CxAdmin@2026!';

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill(E2E_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/#\/(dashboard)?$/);
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

const sidebarTargets: Array<{ label: string; hashPath: string }> = [
  { label: '仪表盘', hashPath: '/dashboard' },
  { label: '业绩分析', hashPath: '/performance-analysis' },
  { label: '保费报表', hashPath: '/premium-report' },
  { label: '营销战报', hashPath: '/marketing-report' },
  { label: '营业货车', hashPath: '/truck' },
  { label: '续保分析', hashPath: '/renewal' },
  { label: '驾乘险推介率', hashPath: '/cross-sell' },
  { label: '增长分析', hashPath: '/growth' },
  { label: '成本分析', hashPath: '/cost' },
  { label: '数据对比', hashPath: '/comparison' },
  { label: '系数监控', hashPath: '/coefficient' },
];

test('首页侧边栏逐个进入子页面无需刷新', async ({ page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  for (const target of sidebarTargets) {
    const navLink = page.getByRole('link', { name: target.label, exact: true });
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await expect(page).toHaveURL(new RegExp(`#${target.hashPath}$`), { timeout: 15000 });

    const loginHeading = page.getByRole('heading', { name: '车险业绩分析系统' });
    await expect(loginHeading).not.toBeVisible();

  }
});
