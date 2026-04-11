#!/usr/bin/env node
/**
 * 快照构建器 — Phase 1 核心脚本
 *
 * 枚举 bundle × 权限域 × 参数组合，curl 本地 server 生成 JSON 快照文件。
 * 要求本地 server 已启动（bun run dev:full）。
 *
 * 使用方法:
 *   node scripts/build-snapshots.mjs                   # 构建全部快照
 *   node scripts/build-snapshots.mjs --bundle dashboard-bundle  # 单 bundle
 *   node scripts/build-snapshots.mjs --scope 乐山       # 单权限域
 *   node scripts/build-snapshots.mjs --dry-run          # 仅列出组合
 *
 * 输出目录: 数据管理/warehouse/snapshots/{bundle}/{scope}/{paramHash}.json
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SNAPSHOT_DIR = join(ROOT_DIR, '数据管理/warehouse/snapshots');
const SERVER_URL = process.env.SNAPSHOT_SERVER_URL || 'http://localhost:3000';

// ── 权限域 → 登录凭据映射 ────────────────────
// 每个 scope 对应一个用户，用于获取该权限域的 JWT
const SCOPE_CREDENTIALS = {
  all: { username: 'admin', password: 'CxAdmin@2026!' },
  '乐山': { username: 'leshan', password: 'leshan123' },
  '天府': { username: 'tianfu', password: 'tianfu123' },
  '宜宾': { username: 'yibin', password: 'yibin123' },
  '德阳': { username: 'deyang', password: 'deyang123' },
  '新都': { username: 'xindu', password: 'xindu123' },
  '武侯': { username: 'wuhou', password: 'wuhou123' },
  '泸州': { username: 'luzhou', password: 'luzhou123' },
  '自贡': { username: 'zigong', password: 'zigong123' },
  '资阳': { username: 'ziyang', password: 'ziyang123' },
  '达州': { username: 'dazhou', password: 'dazhou123' },
  '青羊': { username: 'qingyang', password: 'qingyang123' },
  '高新': { username: 'gaoxin', password: 'gaoxin123' },
};

// ── bundle 定义 ─────────────────────────────
// 每个 bundle 的默认参数组合（覆盖最常用的请求）

const BUNDLE_DEFINITIONS = {
  'dashboard-bundle': {
    path: '/api/query/dashboard-bundle',
    paramSets: [
      { timeView: 'daily', perspective: 'premium', rankingLimit: '10' },
      { timeView: 'weekly', perspective: 'premium', rankingLimit: '10' },
      { timeView: 'monthly', perspective: 'premium', rankingLimit: '10' },
      { timeView: 'daily', perspective: 'policy_count', rankingLimit: '10' },
    ],
  },
  'performance-bundle': {
    path: '/api/query/performance-bundle',
    paramSets: [
      { timePeriod: 'day', growthMode: 'mom', expandDims: 'none', limit: '20' },
      { timePeriod: 'week', growthMode: 'mom', expandDims: 'none', limit: '20' },
      { timePeriod: 'month', growthMode: 'mom', expandDims: 'none', limit: '20' },
      { timePeriod: 'day', growthMode: 'yoy', expandDims: 'none', limit: '20' },
    ],
  },
  'cross-sell-bundle': {
    path: '/api/query/cross-sell-bundle',
    paramSets: [
      { vehicleCategory: 'passenger', granularity: 'monthly', timePeriod: 'monthly' },
    ],
  },
};

// ── 工具函数 ─────────────────────────────────

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function computeParamHash(params) {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 12);
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { bundle: null, scope: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--bundle': parsed.bundle = argv[++i]; break;
      case '--scope': parsed.scope = argv[++i]; break;
      case '--dry-run': parsed.dryRun = true; break;
      case '--help': case '-h': parsed.help = true; break;
      default: throw new Error(`未知参数: ${token}`);
    }
  }
  return parsed;
}

// ── 登录获取 JWT ─────────────────────────────

async function login(username, password) {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${username}: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.data?.token || body.token;
}

// ── 抓取 bundle 数据 ─────────────────────────

async function fetchBundle(apiPath, params, token) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SERVER_URL}${apiPath}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} — ${url}`);
  }
  const body = await res.json();
  return body.data || body;
}

// ── 原子写入 ─────────────────────────────────

function atomicWrite(filePath, content) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

// ── 主流程 ───────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`用法:
  node scripts/build-snapshots.mjs                          # 构建全部快照
  node scripts/build-snapshots.mjs --bundle dashboard-bundle  # 单 bundle
  node scripts/build-snapshots.mjs --scope 乐山              # 单权限域
  node scripts/build-snapshots.mjs --dry-run                 # 仅列出组合
`);
    return;
  }

  log('blue', '═══════════════════════════════════════════════');
  log('blue', '  快照构建器 — Phase 1');
  log('blue', '═══════════════════════════════════════════════');

  // 1. 确定要构建的 bundle 和 scope
  const bundles = args.bundle
    ? { [args.bundle]: BUNDLE_DEFINITIONS[args.bundle] }
    : BUNDLE_DEFINITIONS;

  if (args.bundle && !BUNDLE_DEFINITIONS[args.bundle]) {
    log('red', `未知 bundle: ${args.bundle}`);
    log('yellow', `可用: ${Object.keys(BUNDLE_DEFINITIONS).join(', ')}`);
    process.exit(1);
  }

  const scopes = args.scope
    ? { [args.scope]: SCOPE_CREDENTIALS[args.scope] }
    : SCOPE_CREDENTIALS;

  if (args.scope && !SCOPE_CREDENTIALS[args.scope]) {
    log('red', `未知 scope: ${args.scope}`);
    log('yellow', `可用: ${Object.keys(SCOPE_CREDENTIALS).join(', ')}`);
    process.exit(1);
  }

  // 2. 枚举所有组合
  const tasks = [];
  for (const [bundleName, bundleDef] of Object.entries(bundles)) {
    for (const [scope, creds] of Object.entries(scopes)) {
      for (const params of bundleDef.paramSets) {
        const paramHash = computeParamHash(params);
        tasks.push({ bundleName, scope, creds, params, paramHash, path: bundleDef.path });
      }
    }
  }

  log('green', `\n  组合总数: ${tasks.length} (${Object.keys(bundles).length} bundles × ${Object.keys(scopes).length} scopes × params)`);
  log('dim', `  输出目录: ${SNAPSHOT_DIR}`);

  if (args.dryRun) {
    log('yellow', '\n  [DRY RUN] 以下组合将被构建:\n');
    for (const t of tasks) {
      const paramsStr = Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join('&');
      console.log(`  ${t.bundleName} / ${t.scope} / ${t.paramHash}  (${paramsStr})`);
    }
    return;
  }

  // 3. 检查 server 是否可用
  try {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    log('green', `  Server: ${SERVER_URL} ✓`);
  } catch (err) {
    log('red', `  Server 不可用: ${SERVER_URL}`);
    log('yellow', '  请先启动: bun run dev:full');
    process.exit(1);
  }

  // 4. 获取每个 scope 的 JWT（并行）
  log('yellow', '\n▶ 登录获取 JWT...');
  const tokenMap = {};
  const loginResults = await Promise.allSettled(
    Object.entries(scopes).map(async ([scope, creds]) => {
      const token = await login(creds.username, creds.password);
      return { scope, token };
    })
  );

  for (const result of loginResults) {
    if (result.status === 'fulfilled') {
      tokenMap[result.value.scope] = result.value.token;
      log('green', `  ✓ ${result.value.scope}`);
    } else {
      log('red', `  ✗ 登录失败: ${result.reason.message}`);
    }
  }

  // 5. 并行抓取所有 bundle 数据
  log('yellow', '\n▶ 构建快照...');
  const etlDate = new Date().toISOString().slice(0, 10);
  const buildTime = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const fetchResults = await Promise.allSettled(
    tasks.map(async (task) => {
      const token = tokenMap[task.scope];
      if (!token) {
        skipCount++;
        return { task, skipped: true };
      }

      const data = await fetchBundle(task.path, task.params, token);
      const snapshot = {
        _meta: {
          etlDate,
          buildTime,
          bundleType: task.bundleName,
          scope: task.scope,
          params: task.params,
          paramHash: task.paramHash,
        },
        data,
      };

      const filePath = join(SNAPSHOT_DIR, task.bundleName, task.scope, `${task.paramHash}.json`);
      atomicWrite(filePath, JSON.stringify(snapshot));
      return { task, filePath };
    })
  );

  for (const result of fetchResults) {
    if (result.status === 'fulfilled') {
      if (result.value.skipped) {
        log('yellow', `  ⊘ ${result.value.task.bundleName}/${result.value.task.scope} — 跳过 (无 JWT)`);
      } else {
        successCount++;
        const t = result.value.task;
        log('green', `  ✓ ${t.bundleName}/${t.scope}/${t.paramHash}`);
      }
    } else {
      failCount++;
      log('red', `  ✗ ${result.reason.message}`);
    }
  }

  // 6. 汇总报告
  console.log('');
  log('blue', '═══════════════════════════════════════════════');
  log('green', `  成功: ${successCount}`);
  if (failCount > 0) log('red', `  失败: ${failCount}`);
  if (skipCount > 0) log('yellow', `  跳过: ${skipCount}`);
  log('blue', '═══════════════════════════════════════════════');

  // 7. 统计快照目录大小
  if (existsSync(SNAPSHOT_DIR)) {
    let totalSize = 0;
    let totalFiles = 0;
    function walkDir(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          totalSize += statSync(fullPath).size;
          totalFiles++;
        }
      }
    }
    walkDir(SNAPSHOT_DIR);
    log('dim', `  快照目录: ${totalFiles} 文件, ${(totalSize / 1024).toFixed(1)} KB`);
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log('red', `错误: ${err.message}`);
  process.exit(1);
});
