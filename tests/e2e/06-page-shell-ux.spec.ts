import { test, expect } from '@playwright/test';
import { assertAdvancedDrawerToggles, openAnchorNav, skipWhenNoData } from './helpers/session';
import { assertPageShellContracts } from './helpers/page-shell';

test('performance 页支持右侧锚点导航与高级筛选抽屉', async ({ page }) => {
  if (!await skipWhenNoData(page)) {
    return;
  }

  await page.goto('/#/performance-analysis');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible();
  await assertAdvancedDrawerToggles(page);
  // 锚点导航为悬浮球设计：先展开面板再断言锚点项
  // （Top20 为第 6 项：焦点/热力图/业绩概览/趋势分析/下钻分析/Top20）
  await openAnchorNav(page);
  await expect(page.getByRole('button', { name: '6 Top20' })).toBeVisible();

  await page.evaluate(() => {
    const container = document.getElementById('dashboard-page-scroll');
    if (container) container.scrollTo({ top: 0 });
  });

  const top20Anchor = page.getByRole('button', { name: '6 Top20' });
  await top20Anchor.click();
  await expect(page.locator('#performance-top20')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Top20业务员' })).toBeVisible();
});

test('growth 与 cost 页面复用顶部基础筛选和高级筛选抽屉', async ({ page }) => {
  if (!await skipWhenNoData(page)) {
    return;
  }

  const pages = [
    {
      url: '/#/growth',
      heading: /增长分析/,
    },
    {
      url: '/#/specialty?tab=cross-sell',
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
