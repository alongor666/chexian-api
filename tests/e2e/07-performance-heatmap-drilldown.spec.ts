import { test, expect } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 本地 E2E 并行执行时下钻 API 响应时间不稳定，CI 串行模式下通过
// 跳过条件：非 CI 环境（CI 中 workers=1 无此问题）
test('performance 热力图支持从单元格进入下钻并继续下钻', async ({ page }) => {
  test.skip(!process.env.CI, '本地并行 E2E 下钻响应不稳定，仅 CI 串行执行');
  test.setTimeout(90000);
  if (!await skipWhenNoData(page)) {
    return;
  }

  await page.goto('/#/performance-analysis');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#performance-heatmap')).toBeVisible({ timeout: 20000 });

  const interactiveHeatmapRow = page
    .locator('#performance-heatmap tbody tr')
    .filter({ has: page.locator('td[title^="点击下钻 "]') })
    .first();

  await expect(interactiveHeatmapRow).toBeVisible({ timeout: 30000 });
  const selectedOrg = (await interactiveHeatmapRow.locator('td').first().innerText()).trim();
  const latestCellButton = interactiveHeatmapRow.locator('button').last();
  await latestCellButton.click();

  const selectedCard = page.locator('section').filter({ hasText: '已选择：' }).first();
  await expect(selectedCard).toContainText(selectedOrg, { timeout: 10000 });

  const heatmapDrillDialog = page.locator('div.fixed.inset-0').filter({ hasText: '热力图下钻：' }).last();
  await expect(heatmapDrillDialog).toBeVisible({ timeout: 10000 });
  await heatmapDrillDialog.getByRole('button', { name: '业务员', exact: true }).click();
  await expect(heatmapDrillDialog).not.toBeVisible({ timeout: 5000 });

  await expect(
    page.getByRole('heading', {
      name: new RegExp(`下钻分析（已选维度：业务员 · 热力图机构：${escapeRegex(selectedOrg)}）`),
    })
  ).toBeVisible({ timeout: 30000 });

  const drilldownRows = page.locator('#performance-drilldown tbody tr');
  await expect(drilldownRows.first()).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator('#performance-drilldown').getByRole('button', { name: '选择下钻维度', exact: true })
  ).toBeVisible();
});
