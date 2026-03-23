import { test, expect } from '@playwright/test';

test.describe('Organization Permission Verification', () => {
  const username = 'test_org_user';
  const password = 'TestUser@2026!';

  test('Verify visible and hidden pages for single org user', async ({ page }) => {
    // 1. Login
    await page.goto('/#/login');
    await page.getByPlaceholder('请输入用户名').fill(username);
    await page.getByPlaceholder('请输入密码').fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();

    // Wait for login to complete
    await page.waitForURL((url) => !url.hash.startsWith('#/login'));

    const sidebar = page.getByRole('navigation', { name: '主导航' });
    await expect(sidebar).toBeVisible();

    // 2. Verify allowed pages are visible in sidebar
    // Sidebar labels: 业绩分析, 增长与对比, 专项分析
    const allowedPages = [
      { name: '业绩分析', path: '/#/performance-analysis' },
      { name: '增长与对比', path: '/#/growth' },
      { name: '专项分析', path: '/#/specialty' },
    ];

    for (const pageInfo of allowedPages) {
      const link = page.getByRole('link', { name: pageInfo.name });
      await expect(link).toBeVisible();
      await expect(link).not.toHaveClass(/cursor-not-allowed/);
    }

    // 3. Verify forbidden pages are disabled (cursor-not-allowed + opacity)
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

    // 4. Try manual navigation to forbidden page
    await page.goto('/#/cost');
    // Should redirect to default route (/performance-analysis)
    await page.waitForURL((url) => url.hash.includes('performance-analysis'));
    expect(page.url()).toContain('performance-analysis');
  });

  test('Verify organization selection refers to authorized org only', async ({ page }) => {
    // 1. Login if not already
    await page.goto('/#/performance-analysis');
    if (page.url().includes('login')) {
        await page.getByPlaceholder('请输入用户名').fill(username);
        await page.getByPlaceholder('请输入密码').fill(password);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.waitForURL((url) => url.hash.includes('performance-analysis'));
    }

    // 2. The org user should see their org name (乐山) in the scope label
    await expect(page.getByText('乐山')).toBeVisible();

    // 3. Try to find an unauthorized org name like '天府'
    await expect(page.getByText('天府')).not.toBeVisible();
  });
});
