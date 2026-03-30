import { test, expect } from '@playwright/test';
import { ensureDataLoaded } from './helpers/session';

const sidebarTargets: Array<{ label: string; hashPath: string }> = [
  { label: '仪表盘', hashPath: '/dashboard' },
  { label: '业绩分析', hashPath: '/performance-analysis' },
  { label: '保费达成', hashPath: '/reports' },
  { label: '营业货车', hashPath: '/truck' },
  { label: '续保分析', hashPath: '/renewal' },
  { label: '驾意险推介率', hashPath: '/cross-sell' },
  { label: '增长分析', hashPath: '/growth' },
  { label: '成本分析', hashPath: '/cost' },
  { label: '数据对比', hashPath: '/comparison' },
  { label: '系数监控', hashPath: '/coefficient' },
];

test('首页侧边栏逐个进入子页面无需刷新', async ({ page }) => {
  const hasData = await ensureDataLoaded(page);

  if (!hasData) {
    // CI environment without data: verify login + homepage renders correctly
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    // Sidebar should be visible (homepage redirects to dashboard)
    const nav = page.getByRole('navigation', { name: '主导航' });
    await expect(nav).toBeVisible({ timeout: 10000 });

    // Skip data-dependent sidebar navigation — no data loaded in CI
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'No Parquet data available — skipped data-dependent sidebar navigation',
    });
    return;
  }

  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');

  for (const target of sidebarTargets) {
    const navLink = page.getByRole('link', { name: target.label, exact: true });
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await expect(page).toHaveURL(new RegExp(`#${target.hashPath}$`), { timeout: 15000 });

    const loginHeading = page.getByRole('heading', { name: '车险业绩分析系统' });
    await expect(loginHeading).not.toBeVisible();

  }
});
