import { test, expect, type Page } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

/** 记录关键页面截图 */
const attachScreenshot = async (page: Page, name: string) => {
  const buffer = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: buffer, contentType: 'image/png' });
};

test('筛选器交互与报表展示', async ({ page }: { page: Page }) => {
  if (!await skipWhenNoData(page)) {
    return;
  }

  await page.evaluate(() => localStorage.setItem('page-filter-collapsed', 'false'));
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: /保费/ }).first()).toBeVisible();

  const expandButton = page.getByTitle('展开筛选器').first();
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
  }

  const advancedOpenButton = page.getByRole('button', { name: /^筛选$/ }).first();
  if (await advancedOpenButton.isVisible().catch(() => false)) {
    await advancedOpenButton.click();
  }
  await expect(page.getByRole('heading', { name: '高级筛选' })).toBeVisible();

  const startDateButton = page
    .getByRole('complementary', { name: '高级筛选' })
    .getByRole('button', { name: '起保日期', exact: true });
  await expect(startDateButton).toBeVisible();
  await startDateButton.scrollIntoViewIfNeeded();
  await startDateButton.click();
  await expect(startDateButton).toHaveAttribute('aria-pressed', 'true');
  await attachScreenshot(page, 'premium-report-filter-date-criteria');
});
