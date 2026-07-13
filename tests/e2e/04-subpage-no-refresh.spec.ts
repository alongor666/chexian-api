import { test, expect } from '@playwright/test';
import { ensureDataLoaded } from './helpers/session';
import { ROUTES } from '../../src/shared/config/routeRegistry';

// 与 src/components/layout 当前真实侧边栏对齐（2026-06-12 校准）。
// 旧清单（营业货车/续保分析/数据对比/系数监控等）是导航重组前的路由，
// 在 E2E 静默 skip 时代（PR #583 前）从未真跑暴露。
const sidebarTargetPaths = [
  '/dashboard', '/performance-analysis', '/reports', '/specialty', '/growth',
  '/cost', '/renewal-tracker', '/quote-conversion', '/claims-detail', '/customer-flow',
] as const;
const sidebarTargets = sidebarTargetPaths.map((hashPath) => {
  const route = ROUTES.find((candidate) => candidate.path === hashPath);
  if (!route) throw new Error(`Missing E2E sidebar route registry entry: ${hashPath}`);
  return { label: route.label, hashPath };
});

test('首页侧边栏逐个进入子页面无需刷新', async ({ page }) => {
  const hasData = await ensureDataLoaded(page);

  if (!hasData) {
    // CI 红线（BACKLOG 2026-06-11-claude-89a352）：CI 有 fixture，数据缺失必须失败
    if (process.env.CI) {
      throw new Error('[E2E] CI 环境检测不到 Parquet 数据，禁止静默跳过（先跑 scripts/e2e/generate-ci-fixture.mjs）');
    }

    // 本地无数据：验证登录可用且应用重定向到 data-import
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    // DataGuard should redirect to /data-import (not loop via dashboard)
    await page.waitForURL(/#\/data-import/, { timeout: 10000 });

    // Skip data-dependent sidebar navigation — no data loaded
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
    // 30s 余量：本地 3 workers 并行下 dev server（tsx watch + vite）首次编译页面 chunk 可能 >15s；
    // ($|\?) 容忍页面自身追加的 query（如 /specialty?tab=...）
    await expect(page).toHaveURL(new RegExp(`#${target.hashPath}($|\\?)`), { timeout: 30000 });

    const loginHeading = page.getByRole('heading', { name: '车险业绩分析系统' });
    await expect(loginHeading).not.toBeVisible();

  }
});
