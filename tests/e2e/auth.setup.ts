import fs from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { waitForBackendReady } from './helpers/session';

const AUTH_FILE = path.resolve('output/playwright/.auth/user.json');
const E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'CxAdmin@2026!';

setup('缓存已登录会话供后续 E2E 复用', async ({ page }) => {
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });

  await waitForBackendReady(page);
  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill(E2E_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL((url) => !url.hash.startsWith('#/login'), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
