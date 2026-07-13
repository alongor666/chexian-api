import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve('test-results/copilot-pr-e');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
});

async function getAvailablePeriod(page: Page): Promise<{ startDate: string; endDate: string }> {
  const response = await page.request.get(`${API_BASE}/api/filters/options`, { timeout: 30000 });
  if (!response.ok()) {
    // CI 红线（BACKLOG 2026-06-11-claude-89a352）：CI 有 fixture，数据缺失必须失败而非静默跳过
    if (process.env.CI) {
      throw new Error(`[E2E] CI 环境 /api/filters/options HTTP ${response.status()}，禁止静默跳过（先跑 scripts/e2e/generate-ci-fixture.mjs）`);
    }
    test.skip(true, `No real Parquet data available for Copilot workflow E2E: /api/filters/options HTTP ${response.status()}`);
  }
  const body = await response.json();
  const maxDate = body?.data?.dateRange?.max_date;
  if (!maxDate) {
    if (process.env.CI) {
      throw new Error('[E2E] CI 环境 dateRange.max_date 为空，禁止静默跳过（先跑 scripts/e2e/generate-ci-fixture.mjs）');
    }
    test.skip(true, 'No real Parquet data available for Copilot workflow E2E: empty dateRange.max_date');
  }
  const end = new Date(`${String(maxDate).slice(0, 10)}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function openCopilotAndStart(
  page: Page,
  period: { startDate: string; endDate: string },
  includeNarrative: boolean,
): Promise<string> {
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: '打开 Copilot' }).evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
  await expect(page.getByRole('heading', { name: '经营副驾' })).toBeVisible({ timeout: 5000 });

  const startDateInput = page.getByLabel('起始日期');
  const endDateInput = page.getByLabel('截止日期');
  await startDateInput.fill(period.startDate);
  await endDateInput.fill(period.endDate);

  const narrative = page.getByLabel(/附加 LLM 执行摘要/);
  if (includeNarrative !== (await narrative.isChecked())) {
    await narrative.check();
  }

  const createRun = page.waitForResponse(
    (response) => response.url() === `${API_BASE}/api/copilot/runs` && response.request().method() === 'POST',
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: '执行经营巡检' }).click();
  const response = await createRun;
  expect(response.status()).toBe(202);
  const body = await response.json();
  const runId = body?.data?.runId;
  expect(runId).toBeTruthy();
  return runId;
}

async function waitForPendingApprovalUi(page: Page) {
  const timeline = page.locator('section[aria-label="审计事件时序"]');
  await expect(page.getByTestId('approval-status-badge')).toContainText('待审批', { timeout: 120000 });
  await expect(page.getByTestId('approval-buttons')).toBeVisible();
  await expect(page.getByTestId('approve-button')).toBeVisible();
  await expect(page.getByTestId('reject-button')).toBeVisible();
  await expect(timeline.locator('[data-event-type="workflow-started"]')).toHaveCount(1);
  await expect(timeline.locator('[data-event-type="step-completed"]').first()).toBeVisible();
  await expect(timeline.locator('[data-event-type="approval-requested"]')).toHaveCount(1);
}

async function getAuditEvents(page: Page, runId: string): Promise<Array<{ eventType: string }>> {
  const response = await page.request.get(`${API_BASE}/api/workflows/runs/${runId}/audit`, { timeout: 30000 });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.data;
}

test('copilot workflow approve path persists workflow-skill narrative and exposes audit timeline', async ({ page }) => {
  test.setTimeout(180_000);
  test.slow();
  const period = await getAvailablePeriod(page);

  const runId = await openCopilotAndStart(page, period, true);
  await waitForPendingApprovalUi(page);

  const healthResponse = await page.request.get(`${API_BASE}/api/workflows/health/runs-summary`, { timeout: 30000 });
  expect(healthResponse.status()).toBe(200);
  const health = await healthResponse.json();
  expect(health.data.workflows.some((w: { workflowId: string }) => w.workflowId === 'auto-risk-control-v1')).toBe(true);

  await page.getByTestId('approve-button').click();
  await expect(page.getByTestId('approval-status-badge')).toContainText(/已完成|部分成功/, { timeout: 120000 });
  await expect(page.getByText(/narrative source:/)).toContainText('workflow-skill', { timeout: 30000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'approve-path.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reportResponse = await page.request.get(
    `${API_BASE}/api/copilot/runs/${runId}/report?includeNarrative=1`,
    { timeout: 30000 },
  );
  expect(reportResponse.status()).toBe(200);
  const report = await reportResponse.json();
  expect(report.data.narrativeSource).toBe('workflow-skill');
});

test('copilot workflow reject path records failed status and approval-denied audit event', async ({ page }) => {
  test.setTimeout(180_000);
  test.slow();
  const period = await getAvailablePeriod(page);

  const runId = await openCopilotAndStart(page, period, false);
  await waitForPendingApprovalUi(page);
  const beforeAudit = await getAuditEvents(page, runId);

  await page.getByTestId('reject-button').click();
  await expect(page.getByTestId('reject-modal')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'reject-modal.png'), fullPage: true });
  await page.getByTestId('reject-reason-input').fill('E2E 风险评估不足，拒绝进入定价模拟');
  await page.getByTestId('reject-confirm-button').click();

  await expect(page.getByTestId('approval-status-badge')).toContainText('已失败', { timeout: 30000 });
  await expect(page.locator('[data-event-type="approval-denied"]')).toHaveCount(1, { timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'reject-path.png'), fullPage: true });

  const recordResponse = await page.request.get(`${API_BASE}/api/workflows/runs/${runId}`, { timeout: 30000 });
  expect(recordResponse.status()).toBe(200);
  const record = await recordResponse.json();
  expect(record.data.status).toBe('failed');

  const afterAudit = await getAuditEvents(page, runId);
  expect(afterAudit.length).toBe(beforeAudit.length + 1);
  expect(afterAudit.at(-1)?.eventType).toBe('approval-denied');
});
