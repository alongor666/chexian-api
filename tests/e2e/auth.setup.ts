import fs from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { waitForBackendReady } from './helpers/session';

const AUTH_FILE = path.resolve('output/playwright/.auth/user.json');
const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'dev';

setup('缓存已登录会话供后续 E2E 复用', async ({ page }) => {
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });

  await waitForBackendReady(page);
  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill(E2E_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(E2E_PASSWORD);

  // Intercept login response for diagnostics
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/api/auth/login') && resp.request().method() === 'POST',
      { timeout: 30000 },
    ),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);

  if (!loginResponse.ok()) {
    const body = await loginResponse.text().catch(() => '(no body)');
    throw new Error(
      `Login failed: ${loginResponse.status()} — user=${E2E_USERNAME} — ${body}`
    );
  }

  await page.waitForURL((url) => !url.hash.startsWith('#/login'), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
