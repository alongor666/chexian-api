import { expect, test } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

test.use({ storageState: 'output/playwright/.auth/user.json' });
test.setTimeout(90000);

const VERSION_B_SECTIONS = [
  { tab: '总览', title: '整体转化漏斗' },
  { tab: '续/转保', title: '续保 vs 转保 多维分析' },
  { tab: '三级机构', title: '三级机构分析' },
  { tab: '险别/客户/等级', title: '险别/客户/等级' },
  { tab: '月度趋势', title: '月度趋势' },
  { tab: '折扣/NCD', title: '折扣分析' },
] as const;

test.describe.serial('报价转化版本 B 专题冒烟', () => {
  test('六个专题 tab 冒烟', async ({ page }) => {
    if (!await skipWhenNoData(page)) {
      return;
    }

    await page.goto('/#/quote-conversion?version=B');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/#\/quote-conversion\?version=B$/);
    await expect(page.getByRole('tab', { name: '版本 B', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('版本 B · 旧车专题版')).toBeVisible({ timeout: 15000 });

    for (const section of VERSION_B_SECTIONS) {
      const tab = page.getByRole('tab', { name: section.tab, exact: true });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(page.getByText(section.title)).toBeVisible({ timeout: 15000 });
    }
  });
});
