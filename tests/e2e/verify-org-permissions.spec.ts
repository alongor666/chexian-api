import { test, expect } from '@playwright/test';
import { DEFAULT_E2E_PASSWORD, DEFAULT_E2E_USERNAME } from './helpers/credentials';

// These tests use independent login (not the shared admin session)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.configure({ timeout: 60000 });

test.describe('Permission Verification', () => {
  const username = process.env.E2E_USERNAME ?? DEFAULT_E2E_USERNAME;
  const password = process.env.E2E_PASSWORD ?? DEFAULT_E2E_PASSWORD;

  async function loginAsUser(page: import('@playwright/test').Page) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await page.waitForTimeout(2000 * attempt);
      const loginResponse = await page.request.post('http://localhost:3000/api/auth/login', {
        data: { username, password },
        timeout: 30000,
      });

      if (loginResponse.status() === 200) {
        const loginPayload = await loginResponse.json();
        const accessToken = loginPayload?.data?.token;
        expect(accessToken).toBeTruthy();
        await page.context().addCookies([{
          name: 'cx_access_token',
          value: accessToken,
          url: 'http://localhost',
          httpOnly: true,
          sameSite: 'Lax',
        }]);
        break;
      }
      if (loginResponse.status() !== 429) {
        expect(loginResponse.status()).toBe(200);
      }
    }

    await page.goto('/#/login');
    await page.evaluate(() => {
      window.localStorage.setItem('chexian_auth_session_hint', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForURL(
      (url) => !url.hash.startsWith('#/login'),
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
  }

  test('Admin user can see all main pages in sidebar', async ({ page }) => {
    test.skip(!process.env.CI, '本地并行 E2E 限流导致独立登录不稳定，仅 CI 串行执行');
    await loginAsUser(page);

    const sidebar = page.locator('nav, aside').first();
    await expect(sidebar).toBeVisible({ timeout: 15000 });

    // Admin should see core pages
    const expectedPages = ['业绩分析', '增长与对比'];
    for (const pageName of expectedPages) {
      const link = page.getByRole('link', { name: pageName });
      await expect(link).toBeVisible({ timeout: 10000 });
    }
  });

  test('Admin can navigate to protected pages', async ({ page }) => {
    test.skip(!process.env.CI, '本地并行 E2E 限流导致独立登录不稳定，仅 CI 串行执行');
    await loginAsUser(page);

    // Navigate to performance analysis
    await page.goto('/#/performance-analysis');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: /业绩分析/ })).toBeVisible({ timeout: 15000 });

    // Navigate to cost page
    await page.goto('/#/cost');
    await page.waitForLoadState('domcontentloaded');
    // Admin should not be redirected away from cost
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('#/cost');
  });
});
