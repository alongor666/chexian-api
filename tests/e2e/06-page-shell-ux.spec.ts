import { test, expect } from '@playwright/test';
import { assertAdvancedDrawerToggles, ensureDataLoaded, login } from './helpers/session';
import { assertPageShellContracts } from './helpers/page-shell';

test('performance 页支持右侧锚点导航与高级筛选抽屉', async ({ page }) => {
  await ensureDataLoaded(page);

  await page.goto('/#/performance-analysis');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible();
  await assertAdvancedDrawerToggles(page);
  await expect(page.getByRole('button', { name: '5 Top20' })).toBeVisible();

  await page.evaluate(() => {
    const container = document.getElementById('dashboard-page-scroll');
    if (container) container.scrollTo({ top: 0 });
  });

  const top20Anchor = page.getByRole('button', { name: '5 Top20' });
  await top20Anchor.click();
  await expect(page.locator('#performance-top20')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Top20业务员' })).toBeVisible();
});

test('growth 与 cost 页面复用顶部基础筛选和高级筛选抽屉', async ({ page }) => {
  await ensureDataLoaded(page);

  const pages = [
    {
      url: '/#/growth',
      heading: /增长分析/,
    },
    {
      url: '/#/cross-sell',
      heading: /交叉销售分析/,
    },
    {
      url: '/#/cost',
      heading: /成本分析/,
    },
  ] as const;

  for (const target of pages) {
    await assertPageShellContracts(page, target);
  }
});
