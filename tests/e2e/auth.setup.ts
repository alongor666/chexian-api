import fs from 'node:fs/promises';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { DEFAULT_E2E_PASSWORD, DEFAULT_E2E_USERNAME } from './helpers/credentials';
import { waitForBackendReady } from './helpers/session';

const AUTH_FILE = path.resolve('output/playwright/.auth/user.json');
const E2E_USERNAME = process.env.E2E_USERNAME ?? DEFAULT_E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? DEFAULT_E2E_PASSWORD;

setup('缓存已登录会话供后续 E2E 复用', async ({ page }) => {
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });

  await waitForBackendReady(page);
  const loginResponse = await page.request.post('http://localhost:3000/api/auth/login', {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
    timeout: 30000,
  });

  if (!loginResponse.ok()) {
    const body = await loginResponse.text().catch(() => '(no body)');
    throw new Error(
      `Login failed: ${loginResponse.status()} — user=${E2E_USERNAME} — ${body}`
    );
  }

  const loginPayload = await loginResponse.json();
  const accessToken = loginPayload?.data?.token;
  if (!accessToken) {
    throw new Error('Login succeeded but token is missing in response body');
  }

  await page.context().addCookies([{
    name: 'cx_access_token',
    value: accessToken,
    url: 'http://localhost',
    httpOnly: true,
    sameSite: 'Lax',
  }]);

  await page.goto('/#/login');
  await page.evaluate(() => {
    window.localStorage.setItem('chexian_auth_session_hint', '1');
  });
  await page.context().storageState({ path: AUTH_FILE });

  const browser = page.context().browser();
  if (!browser) {
    throw new Error('Unable to access browser instance for storage verification');
  }

  const verifyContext = await browser.newContext({ storageState: AUTH_FILE });
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto('http://localhost:5173/#/');
  await expect(verifyPage.getByRole('navigation', { name: '主导航' })).toBeVisible({ timeout: 15000 });
  await verifyContext.close();
});
