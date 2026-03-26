#!/usr/bin/env node

/**
 * 部署前一致性校验脚本
 *
 * 检查项：
 * 1. env 注入一致性  — ecosystem env 块 vs REQUIRED_VARS
 * 2. CORS 白名单有效性 — 生产域名在列表中，无 localhost
 * 3. PM2 配置合理性  — instances/exec_mode/wait_ready/listen_timeout
 * 4. unit preflight  — node_modules/vitest 可用性
 * 5. 健康检查（可选）— 服务已运行时确认 /health 返回 200
 *
 * 用法：
 *   node scripts/check-deploy-readiness.mjs
 *   node scripts/check-deploy-readiness.mjs --require-health
 *   node scripts/check-deploy-readiness.mjs --require-health --health-url http://localhost:3000/health
 *
 * 退出码：
 *   0: 全部通过
 *   1: 存在 FAIL 级检查
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ─── ANSI colors ─────────────────────────────────────────────
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function success(msg) { console.log(`${colors.green}${colors.bold}[✓]${colors.reset} ${msg}`); }
function fail(msg) { console.log(`${colors.red}${colors.bold}[✗]${colors.reset} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow}${colors.bold}[⚠]${colors.reset} ${msg}`); }
function info(msg) { console.log(`${colors.blue}${colors.bold}[ℹ]${colors.reset} ${msg}`); }

// ─── Constants ───────────────────────────────────────────────
const ECOSYSTEM_PATH = path.join(ROOT_DIR, 'server', 'ecosystem.config.cjs');

/** ecosystem env 块中必须声明的变量 */
const REQUIRED_ECOSYSTEM_VARS = [
  'NODE_ENV', 'PORT', 'VPS_MODE', 'CORS_ORIGIN',
  'DUCKDB_MAX_MEMORY', 'DUCKDB_THREADS',
];

/** 生产域名必须在 CORS_ORIGIN 中 */
const REQUIRED_PROD_ORIGINS = ['https://chexian.cretvalu.com'];

// ─── Helpers ─────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

/**
 * 从 ecosystem.config.cjs 纯文本中提取第一个 env: { ... } 块的键名
 */
function parseEcosystemEnvKeys(content) {
  // 找到第一个 env: { ... } 块（非 env_production）
  // 使用简单状态机解析嵌套大括号
  const envStart = content.indexOf('env:');
  if (envStart === -1) return { keys: [], corsOrigin: '' };

  // 确保不是 env_production
  const before = content.slice(Math.max(0, envStart - 20), envStart);
  const startIdx = before.includes('_') ? content.indexOf('env:', envStart + 4) : envStart;
  const actualStart = content.indexOf('env:');

  // 找到 { 开始
  const braceStart = content.indexOf('{', actualStart);
  if (braceStart === -1) return { keys: [], corsOrigin: '' };

  // 匹配对应的 }
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  if (braceEnd === -1) return { keys: [], corsOrigin: '' };

  const block = content.slice(braceStart + 1, braceEnd);
  const keys = [];
  let corsOrigin = '';

  // 提取 KEY: value 对
  const keyPattern = /^\s*(\w+)\s*:\s*(.+?)(?:,\s*)?$/gm;
  let match;
  while ((match = keyPattern.exec(block)) !== null) {
    keys.push(match[1]);
    if (match[1] === 'CORS_ORIGIN') {
      corsOrigin = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return { keys, corsOrigin };
}

// ─── Check 1: env 注入一致性 ─────────────────────────────────

function checkEnvConsistency() {
  info('检查 env 注入一致性...');

  if (!fs.existsSync(ECOSYSTEM_PATH)) {
    fail('ecosystem.config.cjs 不存在');
    return false;
  }

  const content = fs.readFileSync(ECOSYSTEM_PATH, 'utf-8');
  const { keys } = parseEcosystemEnvKeys(content);

  const missing = REQUIRED_ECOSYSTEM_VARS.filter(v => !keys.includes(v));
  if (missing.length > 0) {
    fail(`REQUIRED 变量未在 ecosystem env 块中声明: ${missing.join(', ')}`);
    return false;
  }

  success(`env 注入一致性: REQUIRED ${REQUIRED_ECOSYSTEM_VARS.length}/${REQUIRED_ECOSYSTEM_VARS.length} 已声明, ecosystem 共 ${keys.length} 个变量`);
  return true;
}

// ─── Check 2: CORS 白名单 ────────────────────────────────────

function checkCorsWhitelist() {
  info('检查 CORS 白名单...');

  if (!fs.existsSync(ECOSYSTEM_PATH)) {
    fail('ecosystem.config.cjs 不存在');
    return false;
  }

  const content = fs.readFileSync(ECOSYSTEM_PATH, 'utf-8');
  const { corsOrigin } = parseEcosystemEnvKeys(content);

  if (!corsOrigin) {
    fail('ecosystem env 块中未找到 CORS_ORIGIN');
    return false;
  }

  const origins = corsOrigin.split(',').map(o => o.trim()).filter(Boolean);
  const errors = [];

  if (origins.length === 0) {
    errors.push('CORS_ORIGIN 为空');
  }

  for (const required of REQUIRED_PROD_ORIGINS) {
    if (!origins.includes(required)) {
      errors.push(`生产域名 ${required} 未在 CORS_ORIGIN 中`);
    }
  }

  const hasLocalhost = origins.some(o => o.includes('localhost') || o.includes('127.0.0.1'));
  if (hasLocalhost) {
    warn('CORS_ORIGIN 包含 localhost（生产环境应移除）');
  }

  if (errors.length > 0) {
    fail(`CORS 白名单检查失败: ${errors.join('; ')}`);
    return false;
  }

  success(`CORS 白名单: ${origins.length} 个 origin, 生产域名已包含${hasLocalhost ? ', ⚠ 含 localhost' : ''}`);
  return true;
}

// ─── Check 3: PM2 配置合理性 ─────────────────────────────────

function checkPm2Config() {
  info('检查 PM2 配置合理性...');

  if (!fs.existsSync(ECOSYSTEM_PATH)) {
    fail('ecosystem.config.cjs 不存在');
    return false;
  }

  const content = fs.readFileSync(ECOSYSTEM_PATH, 'utf-8');
  const errors = [];

  // instances = 1
  const instancesMatch = content.match(/instances\s*:\s*(\d+)/);
  if (instancesMatch && instancesMatch[1] !== '1') {
    errors.push(`instances=${instancesMatch[1]}，DuckDB 要求必须为 1`);
  }

  // exec_mode = 'fork'
  const execMatch = content.match(/exec_mode\s*:\s*['"](\w+)['"]/);
  if (execMatch && execMatch[1] !== 'fork') {
    errors.push(`exec_mode='${execMatch[1]}'，DuckDB 要求必须为 'fork'`);
  }

  // wait_ready = true
  const waitMatch = content.match(/wait_ready\s*:\s*(true|false)/);
  if (waitMatch && waitMatch[1] !== 'true') {
    errors.push('wait_ready=false，Parquet 加载需要等待 ready 信号');
  }

  // listen_timeout >= 60000
  const listenMatch = content.match(/listen_timeout\s*:\s*(\d+)/);
  if (listenMatch) {
    const val = parseInt(listenMatch[1], 10);
    if (val < 60000) {
      errors.push(`listen_timeout=${val}，Parquet 加载至少需要 60000ms`);
    }
  }

  // max_memory_restart 存在
  if (!content.includes('max_memory_restart')) {
    errors.push('缺少 max_memory_restart（防止 OOM 无限重启）');
  }

  // watch = false
  const watchMatch = content.match(/watch\s*:\s*(true|false)/);
  if (watchMatch && watchMatch[1] !== 'false') {
    errors.push('watch=true，生产环境不应监听文件变化');
  }

  if (errors.length > 0) {
    fail(`PM2 配置: ${errors.join('; ')}`);
    return false;
  }

  const listenTimeout = listenMatch ? listenMatch[1] : 'N/A';
  success(`PM2 配置合理: instances=1, exec_mode=fork, wait_ready=true, listen_timeout=${listenTimeout}`);
  return true;
}

// ─── Check 4: unit preflight ─────────────────────────────────

function checkUnitPreflight() {
  info('检查 unit preflight...');
  const errors = [];
  const warnings = [];

  // node_modules 存在
  const rootModules = path.join(ROOT_DIR, 'node_modules');
  if (!fs.existsSync(rootModules)) {
    errors.push('根目录 node_modules 不存在（运行 bun install）');
  }

  // vitest 可执行
  const vitestPath = path.join(rootModules, '.bin', 'vitest');
  if (fs.existsSync(vitestPath)) {
    try {
      fs.accessSync(vitestPath, fs.constants.X_OK);
    } catch {
      errors.push('vitest 不可执行');
    }
  } else if (fs.existsSync(rootModules)) {
    errors.push('vitest 未安装（node_modules/.bin/vitest 不存在）');
  }

  // server/node_modules ���在（后端独立依赖，如果有的话）
  // 注意：一些项目用 workspace，没有 server/node_modules
  const serverDist = path.join(ROOT_DIR, 'server', 'dist');
  if (!fs.existsSync(serverDist)) {
    warnings.push('server/dist 不存在（首次部署或未构建 — 非阻断）');
  }

  if (errors.length > 0) {
    fail(`unit preflight: ${errors.join('; ')}`);
    return false;
  }

  const warnStr = warnings.length > 0 ? ` (${warnings.join('; ')})` : '';
  success(`unit preflight: node_modules ✓, vitest ✓${warnStr}`);
  return true;
}

// ─── Check 5: 健康检查（可选）────────────────────────────────

async function checkHealth(url) {
  info(`检查健康检查 ${url}...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      fail(`健康检查失败: HTTP ${response.status}`);
      return false;
    }

    const body = await response.json();
    if (!body.success) {
      fail(`健康检查失败: success=${body.success}`);
      return false;
    }

    success(`健康检查通过: HTTP 200, success=true`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('ABORT')) {
      fail('健康检查超时（5s）');
    } else {
      fail(`健康检查失败: ${msg}`);
    }
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requireHealth = args['require-health'] === 'true';
  const healthUrl = args['health-url'] || 'http://localhost:3000/health';

  console.log(`\n${colors.bold}=== 部署前一致性校验 ===${colors.reset}\n`);

  const checks = [
    { name: 'env 注入一致性', fn: checkEnvConsistency },
    { name: 'CORS 白名单', fn: checkCorsWhitelist },
    { name: 'PM2 配置合理性', fn: checkPm2Config },
    { name: 'unit preflight', fn: checkUnitPreflight },
  ];

  let passed = 0;
  let failed = 0;

  for (const { fn } of checks) {
    const ok = fn();
    ok ? passed++ : failed++;
    console.log('');
  }

  if (requireHealth) {
    const ok = await checkHealth(healthUrl);
    ok ? passed++ : failed++;
    console.log('');
  }

  const total = passed + failed;
  console.log(`${colors.bold}=== Summary ===${colors.reset}`);
  console.log(`Total: ${total} checks`);
  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

await main();
