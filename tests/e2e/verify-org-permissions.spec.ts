import { test, expect } from '@playwright/test';

// These tests use independent login (not the shared admin session)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.configure({ timeout: 60000 });

test.describe('Permission Verification', () => {
  const username = 'admin';
  const password = 'CxAdmin@2026!';

  async function loginAsUser(page: import('@playwright/test').Page) {
    await page.goto('/#/login');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('请输入用户名').fill(username);
    await page.getByPlaceholder('请输入密码').fill(password);

    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await page.waitForTimeout(2000 * attempt);
        await page.getByPlaceholder('请输入用户名').fill(username);
        await page.getByPlaceholder('请输入密码').fill(password);
      }

      const [loginResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' && response.url().includes('/api/auth/login'),
          { timeout: 30000 }
        ),
        page.getByRole('button', { name: '登录', exact: true }).click(),
      ]);

      if (loginResponse.status() === 200) break;
      if (loginResponse.status() !== 429) {
        expect(loginResponse.status()).toBe(200);
      }
    }

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
