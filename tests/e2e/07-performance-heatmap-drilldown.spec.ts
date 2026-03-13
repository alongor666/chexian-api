import { test, expect } from '@playwright/test';
import { ensureDataLoaded } from './helpers/session';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('performance 热力图支持从单元格进入下钻并继续下钻', async ({ page }) => {
  await ensureDataLoaded(page);

  await page.goto('/#/performance-analysis');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible();
  await expect(page.locator('#performance-heatmap')).toBeVisible();

  const interactiveHeatmapRow = page
    .locator('#performance-heatmap tbody tr')
    .filter({ has: page.locator('td[title^="点击下钻 "]') })
    .first();

  await expect(interactiveHeatmapRow).toBeVisible();
  const selectedOrg = (await interactiveHeatmapRow.locator('td').first().innerText()).trim();
  const latestCellButton = interactiveHeatmapRow.locator('button').last();
  await latestCellButton.click();

  const selectedCard = page.locator('section').filter({ hasText: '已选择：' }).first();
  await expect(selectedCard).toContainText(selectedOrg);

  const heatmapDrillDialog = page.locator('div.fixed.inset-0').filter({ hasText: '热力图下钻：' }).last();
  await expect(heatmapDrillDialog).toBeVisible();
  await heatmapDrillDialog.getByRole('button', { name: '业务员', exact: true }).click();
  await expect(heatmapDrillDialog).not.toBeVisible();

  await expect(
    page.getByRole('heading', {
      name: new RegExp(`下钻分析（已选维度：业务员 · 热力图机构：${escapeRegex(selectedOrg)}）`),
    })
  ).toBeVisible({ timeout: 15000 });

  const drilldownRows = page.locator('#performance-drilldown tbody tr');
  await expect(drilldownRows.first()).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator('#performance-drilldown').getByRole('button', { name: '选择下钻维度', exact: true })
  ).toBeVisible();
});
