import { expect, test } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

test.use({ storageState: 'output/playwright/.auth/user.json' });
test.setTimeout(90000);

// 版本 A 已下线：报价转化页直接渲染六专题版（原版本 B），无外层版本切换 tab。
const SECTIONS = [
  { tab: '总览', title: '整体转化漏斗' },
  { tab: '续/转保', title: '续保 vs 转保 多维分析' },
  { tab: '三级机构', title: '三级机构分析' },
  { tab: '险别/客户/等级', title: '险别/客户/等级' },
  { tab: '月度趋势', title: '月度趋势' },
  { tab: '折扣/NCD', title: '折扣分析' },
] as const;

test.describe.serial('报价转化六专题冒烟', () => {
  test('六个专题 tab 冒烟', async ({ page }) => {
    if (!await skipWhenNoData(page)) {
      return;
    }

    await page.goto('/#/quote-conversion');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('版本 B · 旧车专题版')).toBeVisible({ timeout: 15000 });

    for (const section of SECTIONS) {
      const tab = page.getByRole('tab', { name: section.tab, exact: true });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(page.getByRole('heading', { name: section.title }).first()).toBeVisible({ timeout: 15000 });
    }
  });
});
