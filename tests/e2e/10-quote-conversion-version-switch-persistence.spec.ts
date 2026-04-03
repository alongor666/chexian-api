import { expect, test } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

test.use({ storageState: 'output/playwright/.auth/user.json' });
test.setTimeout(90000);

async function openQuoteConversion(page: import('@playwright/test').Page) {
  await page.goto('/#/quote-conversion');
  await expect(page.getByRole('tab', { name: '版本 A' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('tab', { name: '版本 A' })).toHaveAttribute('aria-selected', 'true');
}

test.describe.serial('报价转化版本切换与筛选保留', () => {
  test('版本 A/B 切换保留 B 专属筛选状态', async ({ page }) => {
    if (!(await skipWhenNoData(page))) {
      return;
    }

    await openQuoteConversion(page);
    await expect(page).toHaveURL(/#\/quote-conversion(\?version=A)?$/);

    await page.getByRole('tab', { name: '版本 B' }).click();
    await expect(page).toHaveURL(/version=B/);
    await expect(page.getByText('版本 B · 旧车专题版')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('tab', { name: '版本 B' })).toHaveAttribute('aria-selected', 'true');

    await page.getByLabelText('电销').selectOption('电销');
    await expect(page.getByLabelText('电销')).toHaveValue('电销');

    await page.getByRole('tab', { name: '版本 A' }).click();
    await expect(page.getByRole('tab', { name: '版本 A' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/version=A/);
    await expect(page.getByText('专题筛选已生效')).toBeVisible();
    await expect(page.getByText('电销: 电销')).toBeVisible();

    await page.getByRole('tab', { name: '版本 B' }).click();
    await expect(page).toHaveURL(/version=B/);
    await expect(page.getByText('版本 B · 旧车专题版')).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabelText('电销')).toHaveValue('电销');
  });
});
