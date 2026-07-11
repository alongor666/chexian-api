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

  /**
   * 强制设密后的派生密码（确定性）：全员密码闭环下，存量账号（如 leshan）用 CI 注入的
   * 旧密码登录会带 pns（须设密）标记，业务 API 一律 403 —— 登录后须先完成设密。
   * 派生密码 = 旧密码 + 固定后缀（满足策略：≥8 位 + ≥2 类字符，不含 chexian/用户名）。
   */
  function rotatedPassword(pass: string): string {
    return `${pass}#Rz1`;
  }

  /**
   * 登录（兼容 pns 强制设密链路）：
   *   1. 先用原密码登录；账号带 mustChangePassword → 调 change-password 完成设密并换用新会话
   *      （顺带让「存量账号旧密登录 → 强制设密 → 业务 API 解锁」全链路进入 E2E 覆盖）
   *   2. Playwright 整测试重试时密码已被上一轮轮换 → 原密码 401，回退用派生密码登录
   */
  async function loginAs(page: import('@playwright/test').Page, user: string, pass: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await page.waitForTimeout(2000 * attempt);
      let landedToken: string | null = null;

      for (const candidate of [pass, rotatedPassword(pass)]) {
        const loginResponse = await page.request.post('http://localhost:3000/api/auth/login', {
          data: { username: user, password: candidate },
          timeout: 30000,
        });
        if (loginResponse.status() === 429) break; // 限流：回外层等待重试
        if (loginResponse.status() === 401 && candidate === pass) continue; // 密码已轮换：试派生密码
        expect(loginResponse.status()).toBe(200);

        const loginPayload = await loginResponse.json();
        let accessToken = loginPayload?.data?.token;
        expect(accessToken).toBeTruthy();

        // pns（尚未自设密码）：先完成强制设密，换用后端重发的无 pns 会话
        if (loginPayload?.data?.user?.mustChangePassword === true) {
          const changeResponse = await page.request.post('http://localhost:3000/api/auth/change-password', {
            data: { oldPassword: candidate, newPassword: rotatedPassword(pass) },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 30000,
          });
          expect(changeResponse.status()).toBe(200);
          const changePayload = await changeResponse.json();
          accessToken = changePayload?.data?.token;
          expect(accessToken).toBeTruthy();
        }
        landedToken = accessToken;
        break;
      }

      if (landedToken) {
        await page.context().addCookies([{
          name: 'cx_access_token',
          value: landedToken,
          url: 'http://localhost',
          httpOnly: true,
          sameSite: 'Lax',
        }]);
        return;
      }
    }
    throw new Error(`Login failed for user ${user} after 5 attempts`);
  }

  test('Snapshot isolation: admin and leshan hit different snapshot scopes', async ({ page }) => {
    test.skip(!process.env.CI, '快照隔离 E2E 仅 CI 执行（需 snapshot 预构建）');

    const endpoint = 'http://localhost:3000/api/query/dashboard-bundle?timeView=daily&perspective=premium&rankingLimit=10';

    // 1. admin 登录 -> 请求 dashboard-bundle
    await loginAs(page, 'admin', process.env.E2E_PASSWORD ?? '');
    const adminResponse = await page.request.get(endpoint);
    expect(adminResponse.status()).toBe(200);
    const adminData = await adminResponse.json();

    // 清除 session，切换到 leshan
    await page.context().clearCookies();

    // 2. leshan 登录 -> 请求同一端点
    await loginAs(page, 'leshan', process.env.E2E_ORG_PASSWORD ?? '');
    const leshanResponse = await page.request.get(endpoint);
    expect(leshanResponse.status()).toBe(200);
    const leshanData = await leshanResponse.json();

    // 3. 验证隔离
    // 注：原 x-snapshot=hit 断言指向从未实现的响应头契约（server 代码无此头，
    // 该用例在 CI 接入 E2E 前从未真跑过），2026-06-12 移除幻影断言，
    // 保留真实隔离契约：双方 200 + 数据互不相等（权限范围不同）。
    expect(adminData.success).toBe(true);
    expect(leshanData.success).toBe(true);

    // 关键隔离断言：admin 数据不等于 leshan 数据
    expect(JSON.stringify(adminData.data)).not.toBe(JSON.stringify(leshanData.data));
  });

  test('Snapshot isolation: unauthenticated request does not hit snapshot', async ({ page }) => {
    test.skip(!process.env.CI, '快照隔离 E2E 仅 CI 执行');

    const endpoint = 'http://localhost:3000/api/query/dashboard-bundle?timeView=daily&perspective=premium&rankingLimit=10';
    const response = await page.request.get(endpoint);

    // 未认证应返回 401
    expect(response.status()).toBe(401);
  });
});
