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
    const allowedPages = [
      { name: '业绩分析', path: '/#/performance-analysis' },
      { name: '增长分析', path: '/#/growth' },
      { name: '续保分析', path: '/#/renewal' },
      { name: '驾意险推介率', path: '/#/cross-sell' },
    ];

    for (const pageInfo of allowedPages) {
      const link = page.getByRole('link', { name: pageInfo.name });
      await expect(link).toBeVisible();
      await expect(link).not.toHaveClass(/cursor-not-allowed/);
    }

    // 3. Verify forbidden pages are not interactive or hidden
    // Based on SidebarNavigation.tsx, forbidden pages are rendered with 'cursor-not-allowed' class and opacity-70
    const forbiddenPages = [
      { name: '仪表盘', path: '/#/dashboard' },
      { name: '成本分析', path: '/#/cost' },
      { name: '费用分析', path: '/#/fee-analysis' },
      { name: '权限管理', path: '/#/admin/access-control' },
    ];

    for (const pageInfo of forbiddenPages) {
      const item = page.locator('div, a').filter({ hasText: new RegExp(`^${pageInfo.name}$`) });
      // Forbidden pages should have cursor-not-allowed class if they are rendered as placeholder divs
      // or they are simply not found in the DOM if filtered out (though SidebarNavigation seems to render them as disabled)
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

    // 2. Open Global Filter
    const filterPanel = page.getByRole('button', { name: '筛选' }).first();
    if (await filterPanel.isVisible()) {
        await filterPanel.click();
    }

    // 3. Check Organization Dropdown
    // Note: The actual UI implementation might vary, but we expect only '全部' and '乐山'
    const orgSelect = page.locator('select, .ant-select, [role="combobox"]').filter({ hasText: /机构/ });
    // This part is highly dependent on the library used (e.g., Ant Design, Headless UI).
    // Let's look for text '乐山' and '全部' in the filter area
    await expect(page.getByText('乐山')).toBeVisible();
    
    // Try to find an unauthorized org name like '天府'
    await expect(page.getByText('天府')).not.toBeVisible();
  });
});
