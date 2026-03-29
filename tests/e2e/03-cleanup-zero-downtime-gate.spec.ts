import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { ensureDataLoaded } from './helpers/session';

const API_BASE = 'http://localhost:3000';
const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'dev';

test.describe.configure({ mode: 'serial', timeout: 60000 });

test('API-only 清理门禁：关键页面/API/导出全链路', async ({ page }) => {
  await ensureDataLoaded(page);

  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: /保费分析看板/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /保费趋势/ })).toBeVisible();

  const monthlyButton = page.getByRole('button', { name: '签单自然月' });
  await monthlyButton.click();
  await expect(monthlyButton).toHaveClass(/bg-primary/);
  await expect(page.getByRole('heading', { name: /保费趋势/ })).toBeVisible();

  const pdfDownloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: '导出PDF报告' }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = await pdfDownload.path();
  if (!pdfPath) {
    throw new Error('PDF 导出未生成下载文件');
  }
  const pdfStat = await fs.stat(pdfPath);
  expect(pdfStat.size, 'PDF 导出文件为空').toBeGreaterThan(0);

  const allBusinessSection = page.getByRole('heading', { name: '全部业务 Top10' }).locator('..');
  const csvButton = allBusinessSection.getByRole('button', { name: '导出 CSV' });
  await expect(csvButton).toBeVisible({ timeout: 20000 });
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    csvButton.click(),
  ]);
  const csvPath = await csvDownload.path();
  if (!csvPath) {
    throw new Error('CSV 导出未生成下载文件');
  }
  const csvStat = await fs.stat(csvPath);
  expect(csvStat.size, 'CSV 导出文件为空').toBeGreaterThan(0);

  const excelButton = allBusinessSection.getByRole('button', { name: '导出 Excel' });
  await expect(excelButton).toBeVisible({ timeout: 20000 });
  const [excelDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    excelButton.click(),
  ]);
  const excelPath = await excelDownload.path();
  if (!excelPath) {
    throw new Error('Excel 导出未生成下载文件');
  }
  const excelStat = await fs.stat(excelPath);
  expect(excelStat.size, 'Excel 导出文件为空').toBeGreaterThan(0);

  const routes = [
    { goto: 'dashboard', expectHash: 'dashboard' },
    { goto: 'specialty?tab=truck', expectHash: 'specialty' },
    { goto: 'specialty?tab=renewal', expectHash: 'specialty' },
    { goto: 'growth', expectHash: 'growth' },
    { goto: 'cost', expectHash: 'cost' },
    { goto: 'coefficient', expectHash: 'coefficient' },
    { goto: 'reports?tab=premium', expectHash: 'reports' },
    { goto: 'reports?tab=marketing', expectHash: 'reports' },
  ];

  for (const { goto, expectHash } of routes) {
    await page.goto(`/#/${goto}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(new RegExp(`#/${expectHash}`));
  }
});

test('API-only 清理门禁：受保护接口 401 / 鉴权后 200', async () => {
  const anonymousApi = await playwrightRequest.newContext({ storageState: undefined });
  const noTokenRes = await anonymousApi.get(
    `${API_BASE}/api/query/kpi?startDate=2026-01-01&endDate=2026-01-31`
  );
  // 未认证请求应返回 401（或 429 限流，也属于拒绝访问）
  expect([401, 429]).toContain(noTokenRes.status());

  const authApi = await playwrightRequest.newContext({ storageState: undefined });

  // 登录也可能被限流，需重试
  let loginStatus = 0;
  for (let i = 0; i < 5; i++) {
    const loginRes = await authApi.post(`${API_BASE}/api/auth/login`, {
      data: { username: E2E_USERNAME, password: E2E_PASSWORD },
    });
    loginStatus = loginRes.status();
    if (loginStatus === 200) break;
    if (loginStatus === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  expect(loginStatus).toBe(200);

  // 认证后请求，可能因限流需等待重试（E2E 并行 worker 容易触发限流）
  let authStatus = 0;
  for (let i = 0; i < 5; i++) {
    const authRes = await authApi.get(
      `${API_BASE}/api/query/kpi?startDate=2026-01-01&endDate=2026-01-31`
    );
    authStatus = authRes.status();
    if (authStatus === 200) break;
    if (authStatus === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  expect(authStatus).toBe(200);

  await anonymousApi.dispose();
  await authApi.dispose();
});
