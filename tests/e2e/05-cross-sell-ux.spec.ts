import { test, expect } from '@playwright/test';
import { assertAdvancedDrawerToggles, openAnchorNav, skipWhenNoData } from './helpers/session';

test('cross-sell 页骨架支持锚点导航、高级筛选抽屉与下钻明细展开', async ({ page }) => {
  if (!await skipWhenNoData(page)) {
    return;
  }

  await page.goto('/#/specialty?tab=cross-sell');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /交叉销售分析/ })).toBeVisible();
  await assertAdvancedDrawerToggles(page);

  // 锚点导航为悬浮球设计：先展开面板再断言锚点项
  await openAnchorNav(page);
  await expect(page.getByRole('button', { name: '6 TOP20' })).toBeVisible();

  await page.evaluate(() => {
    const container = document.getElementById('dashboard-page-scroll');
    if (container) container.scrollTo({ top: 0 });
  });

  const drilldownAnchor = page.getByRole('button', { name: '5 下钻分析' });
  await drilldownAnchor.click(); // 点击滚动至该节并自动收起面板
  await expect(page.locator('#cross-sell-drilldown')).toBeInViewport();
  // 重新展开面板验证 active 跟随机制存在。
  // 不锁定具体项：IntersectionObserver 按视口占比选 active，
  // 内容高度不同（如 CI fixture 数据量小）时邻近节可能胜出。
  await openAnchorNav(page);
  await expect(page.locator('nav[aria-label="页面导航"] [aria-current="location"]')).toBeVisible();
  await page.getByRole('button', { name: '关闭导航' }).click();
  await expect(page.getByRole('heading', { name: '下钻分析' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重置分析' })).toBeVisible();

  const expandButton = page.getByRole('button', { name: '展开险种明细' });
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect(page.locator('th').filter({ hasText: '单交-车险' }).first()).toBeVisible();
});
