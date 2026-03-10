import { test, expect } from '@playwright/test';
import { ensureDataLoaded, login } from './helpers/session';

test('cross-sell 年维度下热力图区块进入禁用态而不是继续请求不受支持的 15 期热力图', async ({ page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/cross-sell');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /交叉销售分析/ })).toBeVisible();

  await page.getByRole('tab', { name: '年', exact: true }).click();

  const heatmapSection = page.locator('#cross-sell-heatmap');
  await expect(heatmapSection).toBeVisible();
  await expect(heatmapSection).toContainText('年度热力图');
  await expect(heatmapSection).toContainText('年维度暂不提供最近 15 期热力图');
});
