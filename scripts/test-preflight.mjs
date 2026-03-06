#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function log(color, tag, message) {
  console.log(`${color}${COLORS.bold}[${tag}]${COLORS.reset} ${message}`);
}

function success(message) {
  log(COLORS.green, 'pass', message);
}

function warning(message) {
  log(COLORS.yellow, 'warn', message);
}

function error(message) {
  log(COLORS.red, 'fail', message);
}

function info(message) {
  log(COLORS.blue, 'info', message);
}

function hasExecutable(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  try {
    fs.accessSync(fullPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

async function checkHealth(healthUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? 'all';
  const requireHealth = asBoolean(args.requireHealth, false);
  const healthUrl = args.healthUrl ?? 'http://localhost:3000/health';

  const validModes = new Set(['unit', 'e2e', 'all']);
  if (!validModes.has(mode)) {
    error(`不支持的 mode: ${mode}（允许: unit, e2e, all）`);
    process.exit(1);
  }

  info(`测试运行时预检 mode=${mode}`);

  const failures = [];

  if (!exists('package.json')) {
    failures.push('缺少 package.json');
  }
  if (!exists('node_modules')) {
    failures.push('缺少 node_modules，请先执行 bun install');
  }

  if ((mode === 'unit' || mode === 'all') && !hasExecutable('node_modules/.bin/vitest')) {
    failures.push('缺少可执行的 node_modules/.bin/vitest');
  }

  if (mode === 'e2e' || mode === 'all') {
    if (!hasExecutable('node_modules/.bin/playwright')) {
      failures.push('缺少可执行的 node_modules/.bin/playwright');
    }
    if (!exists('playwright.config.ts')) {
      failures.push('缺少 playwright.config.ts');
    }
    if (!exists('tests/e2e/04-subpage-no-refresh.spec.ts')) {
      failures.push('缺少关键 E2E 用例 tests/e2e/04-subpage-no-refresh.spec.ts');
    }
    if (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD) {
      warning('未设置 E2E_USERNAME / E2E_PASSWORD，将回退到测试文件中的默认账号');
    }
  }

  if (requireHealth) {
    const healthy = await checkHealth(healthUrl);
    if (!healthy) {
      failures.push(`健康检查失败：${healthUrl}`);
    }
  }

  if (failures.length > 0) {
    error(`预检失败（${failures.length} 项）：`);
    failures.forEach((failure) => console.log(`    - ${failure}`));
    process.exit(1);
  }

  success('测试运行时预检通过');
}

await main();
