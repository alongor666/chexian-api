import { test, expect } from '@playwright/test';

// These tests use independent login (not the shared admin session)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Organization Permission Verification', () => {
  const username = 'test_org_user';
  const password = 'TestUser@2026!';

  async function loginAsOrgUser(page: import('@playwright/test').Page) {
    await page.goto('/#/login');
    await page.waitForLoadState('domcontentloaded');

    // Wait for login form to be ready
    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('请输入用户名').fill(username);
    await page.getByPlaceholder('请输入密码').fill(password);

    // Click login and wait for API response (retry on 429 rate limit)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await page.waitForTimeout(3000);
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

  test('Verify visible and hidden pages for single org user', async ({ page }) => {
    await loginAsOrgUser(page);

    const sidebar = page.getByRole('navigation', { name: '主导航' });
    await expect(sidebar).toBeVisible();

    // Verify allowed pages are visible in sidebar
    const allowedPages = [
      { name: '业绩分析' },
      { name: '增长与对比' },
      { name: '专项分析' },
    ];

    for (const pageInfo of allowedPages) {
      const link = page.getByRole('link', { name: pageInfo.name });
      await expect(link).toBeVisible();
      await expect(link).not.toHaveClass(/cursor-not-allowed/);
    }

    // Verify forbidden pages are disabled
    const forbiddenPages = [
      { name: '仪表盘' },
      { name: '成本综合' },
      { name: '费用分析' },
    ];

    for (const pageInfo of forbiddenPages) {
      const item = page.locator('div, a').filter({ hasText: new RegExp(`^${pageInfo.name}$`) });
      const count = await item.count();
      if (count > 0) {
        await expect(item.first()).toHaveClass(/cursor-not-allowed/);
      }
    }

    // Try manual navigation to forbidden page
    await page.goto('/#/cost');
    await page.waitForURL((url) => url.hash.includes('performance-analysis'), { timeout: 10000 });
    expect(page.url()).toContain('performance-analysis');
  });

  test('Verify organization selection refers to authorized org only', async ({ page }) => {
    await loginAsOrgUser(page);

    // Wait for page to fully load with data
    await page.waitForLoadState('networkidle');

    // The org user should see their org name (乐山) in the scope label or page title
    await expect(page.getByText('乐山')).toBeVisible({ timeout: 15000 });

    // Try to find an unauthorized org name like '天府'
    await expect(page.getByText('天府')).not.toBeVisible();
  });
});
