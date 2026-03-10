import { test, expect } from '@playwright/test';
import { assertAdvancedDrawerToggles, ensureDataLoaded, login } from './helpers/session';

test('performance 页支持右侧锚点导航与高级筛选抽屉', async ({ page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/performance-analysis');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible();
  await assertAdvancedDrawerToggles(page);
  await expect(page.getByRole('button', { name: 'Top20' })).toBeVisible();

  await page.evaluate(() => {
    const container = document.getElementById('dashboard-page-scroll');
    if (container) container.scrollTo({ top: 0 });
  });

  const top20Anchor = page.getByRole('button', { name: 'Top20' });
  await top20Anchor.click();
  await expect(top20Anchor).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#performance-top20')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Top20业务员' })).toBeVisible();
});

test('growth 与 cost 页面复用顶部基础筛选和高级筛选抽屉', async ({ page }) => {
  await login(page);
  await ensureDataLoaded(page);

  const pages = [
    {
      url: '/#/growth',
      heading: /增长分析/,
      description: '增长分析优先保留口径、年度和机构单选',
    },
    {
      url: '/#/cost',
      heading: /成本分析/,
      description: '成本分析默认保留起保口径、年度、日期范围和机构筛选',
    },
  ] as const;

  for (const target of pages) {
    await page.goto(target.url);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
    await expect(page.getByText(target.description)).toBeVisible();
    await assertAdvancedDrawerToggles(page);
  }
});
