import { test, expect, type Page } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.getByPlaceholder('请输入用户名').fill('admin');
  await page.getByPlaceholder('请输入密码').fill('admin123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/#\/(dashboard)?$/);
};

const ensureDataLoaded = async (page: Page) => {
  await page.goto('/#/');
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('#/dashboard')) {
    return;
  }

  await expect(page.getByRole('heading', { name: '数据导入' })).toBeVisible();

  const loadedBanner = page.getByText('数据已加载:');
  if (await loadedBanner.isVisible().catch(() => false)) {
    const toDashboard = page.getByRole('button', { name: '进入仪表盘' });
    if (await toDashboard.isVisible().catch(() => false)) {
      await toDashboard.click();
      await page.waitForURL(/#\/dashboard/);
    }
    return;
  }

  const emptyState = page.getByText('暂无数据文件，请上传');
  if (await emptyState.isVisible().catch(() => false)) {
    throw new Error('未发现可加载的数据文件');
  }

  const loadButton = page.getByRole('button', { name: '加载' }).first();
  await expect(loadButton).toBeVisible();
  await loadButton.click();
  await page.waitForURL(/#\/dashboard/);
};

const attachScreenshot = async (page: Page, name: string) => {
  const buffer = await page.screenshot({ fullPage: true });
  await test.info().attach(name, { body: buffer, contentType: 'image/png' });
};

test('筛选器交互与报表展示', async ({ page }: { page: Page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/premium-report');
  await expect(page.getByRole('button', { name: '保费报表' })).toBeVisible();

  const quickCombo = page.getByRole('button', { name: /转保/ });
  await expect(quickCombo).toBeVisible();
  await quickCombo.click();
  await expect(quickCombo).toHaveAttribute('aria-pressed', 'true');
  await attachScreenshot(page, 'premium-report-filter-combo');
});

test('SQL 查询执行与结果渲染', async ({ page }: { page: Page }) => {
  await login(page);
  await ensureDataLoaded(page);

  await page.goto('/#/sql-query');
  await expect(page.getByRole('heading', { name: 'SQL 查询' })).toBeVisible();

  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('SELECT COUNT(*) AS cnt FROM PolicyFact;');

  const runButton = page.getByRole('button', { name: '执行查询' });
  await runButton.click();
  await expect(page.getByText('行数:')).toBeVisible();
  await expect(page.getByText('列数:')).toBeVisible();
  await attachScreenshot(page, 'sql-query-result');
});
