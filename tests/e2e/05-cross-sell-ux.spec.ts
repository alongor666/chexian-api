import { test, expect } from '@playwright/test';
import { assertAdvancedDrawerToggles, ensureDataLoaded, login } from './helpers/session';

test('cross-sell 页骨架支持锚点导航、高级筛选抽屉与下钻明细展开', async ({ page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/cross-sell');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /交叉销售分析/ })).toBeVisible();
  await assertAdvancedDrawerToggles(page);

  await expect(page.getByRole('button', { name: 'TOP20' })).toBeVisible();

  await page.evaluate(() => {
    const container = document.getElementById('dashboard-page-scroll');
    if (container) container.scrollTo({ top: 0 });
  });

  const drilldownAnchor = page.getByRole('button', { name: '下钻分析' });
  await drilldownAnchor.click();
  await expect(drilldownAnchor).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#cross-sell-drilldown')).toBeInViewport();
  await expect(page.getByRole('heading', { name: '下钻分析' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重置分析' })).toBeVisible();

  const expandButton = page.getByRole('button', { name: '展开险种明细' });
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect(page.locator('th').filter({ hasText: '单交-车险' }).first()).toBeVisible();
});
