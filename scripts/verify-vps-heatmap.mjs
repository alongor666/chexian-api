#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function formatTimestamp(date = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function parseArgs(argv) {
  const result = {
    baseUrl: process.env.VPS_BASE_URL || 'https://chexian.cretvalu.com',
    username: process.env.E2E_USERNAME || 'admin',
    password: process.env.E2E_PASSWORD || 'CxAdmin@2026!',
    outputDir: 'output/playwright',
    timeoutMs: 45000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--base-url') {
      result.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--username') {
      result.username = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--password') {
      result.password = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      result.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      result.timeoutMs = Number(argv[i + 1] || result.timeoutMs);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/verify-vps-heatmap.mjs [options]',
      '',
      'Options:',
      '  --base-url <url>       VPS site URL (default: https://chexian.cretvalu.com)',
      '  --username <name>      Login username (default: admin)',
      '  --password <pwd>       Login password (default from E2E_PASSWORD)',
      '  --output-dir <path>    Evidence output directory (default: output/playwright)',
      '  --timeout-ms <ms>      Wait timeout in milliseconds (default: 45000)',
      '  -h, --help             Show help',
    ].join('\n')
  );
}

async function ensureVisible(locator, timeoutMs, hint) {
  await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
  if (hint) {
    console.log(`[verify] visible: ${hint}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const stamp = formatTimestamp();
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const reportPath = path.join(outputDir, `vps-heatmap-verify-${stamp}.json`);
  const screenshotPath = path.join(outputDir, `vps-heatmap-verify-${stamp}.png`);
  const networkPath = path.join(outputDir, `vps-heatmap-verify-network-${stamp}.log`);

  const networkRecords = [];
  const consoleRecords = [];
  const result = {
    startedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    targetPath: '/#/performance-analysis',
    reportPath,
    screenshotPath,
    networkPath,
    checks: {},
    status: 'running',
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/query/performance-org-heatmap') || url.includes('/api/query/performance-bundle')) {
        networkRecords.push({
          url,
          status: res.status(),
          ok: res.ok(),
          method: res.request().method(),
        });
      }
    });

    page.on('console', (msg) => {
      consoleRecords.push({
        type: msg.type(),
        text: msg.text(),
      });
    });

    await page.goto(`${options.baseUrl}/#/login`, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await ensureVisible(page.getByPlaceholder('请输入用户名'), options.timeoutMs, 'login username input');
    await page.getByPlaceholder('请输入用户名').fill(options.username);
    await page.getByPlaceholder('请输入密码').fill(options.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`${options.baseUrl}/#/performance-analysis`, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await page.waitForTimeout(1200);

    const loadButton = page.getByRole('button', { name: '加载' }).first();
    if (await loadButton.isVisible().catch(() => false)) {
      console.log('[verify] data load page detected, clicking first load button');
      await loadButton.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1500);
      await page.goto(`${options.baseUrl}/#/performance-analysis`, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
      await page.waitForTimeout(1200);
    }

    await ensureVisible(page.getByRole('heading', { name: '三级机构连续14天热力图' }), options.timeoutMs, 'heatmap title');
    const growthTab = page.getByRole('tab', { name: '增长率', exact: true });
    const achievementTab = page.getByRole('tab', { name: '计划达成率', exact: true });
    const premiumTab = page.getByRole('tab', { name: '保费规模', exact: true });
    await ensureVisible(growthTab, options.timeoutMs, 'growth tab');
    await ensureVisible(achievementTab, options.timeoutMs, 'achievement tab');
    await ensureVisible(premiumTab, options.timeoutMs, 'premium tab');

    const selectedTabs = [];
    await achievementTab.click();
    await page.waitForTimeout(300);
    if ((await achievementTab.getAttribute('aria-selected')) !== 'true') {
      throw new Error('Tab switch failed: 计划达成率');
    }
    selectedTabs.push('计划达成率');

    await premiumTab.click();
    await page.waitForTimeout(300);
    if ((await premiumTab.getAttribute('aria-selected')) !== 'true') {
      throw new Error('Tab switch failed: 保费规模');
    }
    selectedTabs.push('保费规模');

    await growthTab.click();
    await page.waitForTimeout(300);
    if ((await growthTab.getAttribute('aria-selected')) !== 'true') {
      throw new Error('Tab switch failed: 增长率');
    }
    selectedTabs.push('增长率');

    await page.screenshot({ path: screenshotPath, fullPage: false });

    const hasErrorText = await page.locator('text=加载失败').count();
    const heatmapRequests = networkRecords.filter((item) => item.url.includes('/api/query/performance-org-heatmap'));
    const heatmapOk = heatmapRequests.some((item) => item.status === 200);

    result.checks = {
      finalUrl: page.url(),
      selectedTabsAfterSwitch: selectedTabs,
      hasLoadErrorText: hasErrorText > 0,
      heatmapRequestCount: heatmapRequests.length,
      heatmapRequestStatuses: heatmapRequests.map((item) => item.status),
      performanceBundleStatuses: networkRecords
        .filter((item) => item.url.includes('/api/query/performance-bundle'))
        .map((item) => item.status),
      consoleErrorCount: consoleRecords.filter((item) => item.type === 'error').length,
    };

    await fs.writeFile(
      networkPath,
      networkRecords.map((item) => `[${item.method}] ${item.status} ${item.url}`).join('\n'),
      'utf8'
    );

    if (!page.url().includes('/#/performance-analysis')) {
      throw new Error(`Unexpected final URL: ${page.url()}`);
    }
    if (hasErrorText > 0) {
      throw new Error('UI contains heatmap load error text');
    }
    if (!heatmapOk) {
      throw new Error('performance-org-heatmap endpoint did not return 200');
    }

    result.status = 'passed';
    result.endedAt = new Date().toISOString();
    await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

    console.log(`[verify] PASS report: ${reportPath}`);
    console.log(`[verify] PASS screenshot: ${screenshotPath}`);
    console.log(`[verify] PASS network: ${networkPath}`);
  } catch (error) {
    result.status = 'failed';
    result.endedAt = new Date().toISOString();
    result.error = error instanceof Error ? error.message : String(error);
    await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.error(`[verify] FAIL: ${result.error}`);
    console.error(`[verify] report: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await main();
