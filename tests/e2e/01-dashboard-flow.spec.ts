import { test, expect, type Page } from '@playwright/test';
import { ensureDataLoaded } from './helpers/session';

/** 记录关键页面截图 */
const attachScreenshot = async (page: Page, name: string) => {
  const buffer = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: buffer, contentType: 'image/png' });
};

test('仪表盘加载、视角切换与趋势视图切换', async ({ page }: { page: Page }) => {
  await ensureDataLoaded(page);

  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: /保费分析看板/ })).toBeVisible();
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
