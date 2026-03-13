import { expect, type Page } from '@playwright/test';

import { assertAdvancedDrawerToggles } from './session';

type PageShellTarget = {
  url: string;
  heading: string | RegExp;
  description?: string | RegExp;
};

export async function assertPageShellContracts(page: Page, target: PageShellTarget) {
  await page.goto(target.url);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
  if (target.description) {
    await expect(page.getByText(target.description)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /筛选/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /重置/ }).first()).toBeVisible();

  await assertAdvancedDrawerToggles(page);
}
