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

import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SNAPSHOT_DIR = join(ROOT_DIR, '数据管理/warehouse/snapshots');
const SERVER_URL = process.env.SNAPSHOT_SERVER_URL || 'http://localhost:3000';

// ── 生产环境硬拒：本地签 JWT 不得用于生产数据 ────
// 脚本只用于本地 Mac 构建快照，生产快照由 CI/部署流程搬运
if (process.env.NODE_ENV === 'production') {
  console.error('✗ build-snapshots.mjs 禁止在 NODE_ENV=production 下运行');
  process.exit(1);
}

// ── JWT_SECRET: 与 server 对齐（server 启动时 dotenv/config 读 server/.env）──
// 优先级: 进程环境变量 > server/.env > fallback (同 env.ts)
function loadJwtSecretFromServerEnv() {
  const envPath = join(ROOT_DIR, 'server/.env');
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, 'utf-8');
  const match = content.match(/^JWT_SECRET\s*=\s*(.+)$/m);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}
const JWT_SECRET =
  process.env.JWT_SECRET ?? loadJwtSecretFromServerEnv() ?? 'change-me-in-production';
// Token 时效 5 分钟：覆盖单次构建全部并行请求，过期后无残留
const JWT_TTL_SECONDS = 5 * 60;

// ── 权限域 → JWT Payload 映射 ────────────────
// 字段保持与 server/src/services/auth.ts:141 中 login 生成的 payload 形状一致。
// 源：server/src/config/preset-users.ts（不含密码；新增 scope 需同步此映射）。
const SCOPE_PAYLOADS = {
  all:    { userId: 'admin',    username: 'admin',    role: 'branch_admin' },
  '乐山': { userId: 'leshan',   username: 'leshan',   role: 'org_user', organization: '乐山' },
  '天府': { userId: 'tianfu',   username: 'tianfu',   role: 'org_user', organization: '天府' },
  '宜宾': { userId: 'yibin',    username: 'yibin',    role: 'org_user', organization: '宜宾' },
  '德阳': { userId: 'deyang',   username: 'deyang',   role: 'org_user', organization: '德阳' },
  '新都': { userId: 'xindu',    username: 'xindu',    role: 'org_user', organization: '新都' },
  '武侯': { userId: 'wuhou',    username: 'wuhou',    role: 'org_user', organization: '武侯' },
  '泸州': { userId: 'luzhou',   username: 'luzhou',   role: 'org_user', organization: '泸州' },
  '自贡': { userId: 'zigong',   username: 'zigong',   role: 'org_user', organization: '自贡' },
  '资阳': { userId: 'ziyang',   username: 'ziyang',   role: 'org_user', organization: '资阳' },
  '达州': { userId: 'dazhou',   username: 'dazhou',   role: 'org_user', organization: '达州' },
  '青羊': { userId: 'qingyang', username: 'qingyang', role: 'org_user', organization: '青羊' },
  '高新': { userId: 'gaoxin',   username: 'gaoxin',   role: 'org_user', organization: '高新' },
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
  // ── 新增：筛选器选项（每次页面加载必调）──────────
  'filters-options': {
    path: '/api/filters/options',
    paramSets: [{}],
  },
  // ── 新增：客户来源去向（参数完全可枚举）──────────
  'customer-flow-summary': {
    path: '/api/query/customer-flow/summary',
    paramSets: [{ year: '2025' }, { year: '2026' }],
  },
  'customer-flow-inflow': {
    path: '/api/query/customer-flow/inflow',
    paramSets: [{ year: '2025' }, { year: '2026' }],
  },
  'customer-flow-outflow': {
    path: '/api/query/customer-flow/outflow',
    paramSets: [{ year: '2025' }, { year: '2026' }],
  },
  'customer-flow-trend': {
    path: '/api/query/customer-flow/trend',
    paramSets: [{ year: '2025' }, { year: '2026' }],
  },
  'customer-flow-metadata': {
    path: '/api/query/customer-flow/metadata',
    paramSets: [{}],
  },
  // ── Phase 3 新增：综合分析（零参数，命中率极高）──────
  'comprehensive-bundle': {
    path: '/api/query/comprehensive-bundle',
    paramSets: [{}],
  },
  // renewal-v2 端点已于迁移至 renewal-tracker 时下线（server/src/routes/query/renewal-v2.ts 已删）。
  // 原 4 个 bundle 定义（renewal-metadata / renewal-overview / renewal-trend / renewal-funnel）
  // 指向的 /api/query/renewal-v2/* 路径全部 404，若保留会被新加的 80% 成功率阈值误判为构建失败。
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
  // concurrency: 限制并行 fetch 数。DuckDB 连接池 max=10（databaseConfig.maxConnections），
  // dashboard-bundle 等 bundle 单次请求内部会并发发多条 DuckDB 查询，经验值 3 可 100% 通过；
  // 调大会在 dashboard-bundle 集中出现 "queue full, server too busy"。无限并发必然打爆池子。
  const parsed = { bundle: null, scope: null, dryRun: false, help: false, clean: false, concurrency: 3 };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--bundle': parsed.bundle = argv[++i]; break;
      case '--scope': parsed.scope = argv[++i]; break;
      case '--dry-run': parsed.dryRun = true; break;
      case '--clean': parsed.clean = true; break;
      case '--concurrency': parsed.concurrency = Number(argv[++i] ?? 6); break;
      case '--help': case '-h': parsed.help = true; break;
      default: throw new Error(`未知参数: ${token}`);
    }
  }
  if (!Number.isFinite(parsed.concurrency) || parsed.concurrency < 1) {
    throw new Error(`--concurrency 必须 >= 1，当前: ${parsed.concurrency}`);
  }
  return parsed;
}

// ── 有限并发 worker pool（返回值形状与 Promise.allSettled 一致）────
// 原实现 Promise.allSettled(tasks.map(async...)) 无并发闸，260 并发打爆 DuckDB 连接池。
async function allSettledWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── 本地签发 JWT（HS256，与 server/src/middleware/auth.ts 共用 JWT_SECRET）───
// 替代 /api/auth/login：绕开密码/限流/账户锁定三道闸门，本地构建零摩擦。
// 仅限开发模式（顶部已硬拒 NODE_ENV=production）。

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwtHS256(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const bodyB64 = base64urlEncode(JSON.stringify(body));
  const signingInput = `${headerB64}.${bodyB64}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64urlEncode(sig)}`;
}

function issueScopeToken(payload) {
  return signJwtHS256(payload, JWT_SECRET, JWT_TTL_SECONDS);
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
  node scripts/build-snapshots.mjs --clean                   # 构建前清除旧快照
  node scripts/build-snapshots.mjs --concurrency 4           # 调整并发（默认 3，dashboard-bundle 内部并发多需留余量）

说明: 脚本通过 JWT_SECRET 本地签发 token，不再调用 /api/auth/login。
      NODE_ENV=production 时拒绝运行。必要时设置 JWT_SECRET 环境变量与 server 对齐。
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
    ? { [args.scope]: SCOPE_PAYLOADS[args.scope] }
    : SCOPE_PAYLOADS;

  if (args.scope && !SCOPE_PAYLOADS[args.scope]) {
    log('red', `未知 scope: ${args.scope}`);
    log('yellow', `可用: ${Object.keys(SCOPE_PAYLOADS).join(', ')}`);
    process.exit(1);
  }

  // 2. 枚举所有组合
  const tasks = [];
  for (const [bundleName, bundleDef] of Object.entries(bundles)) {
    for (const [scope] of Object.entries(scopes)) {
      for (const params of bundleDef.paramSets) {
        const paramHash = computeParamHash(params);
        tasks.push({ bundleName, scope, params, paramHash, path: bundleDef.path });
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

  // 2.5 清理旧快照（--clean 模式）
  if (args.clean && existsSync(SNAPSHOT_DIR)) {
    const { rmSync } = await import('fs');
    for (const [bundleName] of Object.entries(bundles)) {
      const bundleDir = join(SNAPSHOT_DIR, bundleName);
      if (existsSync(bundleDir)) {
        rmSync(bundleDir, { recursive: true });
        log('yellow', `  🗑 清除旧快照: ${bundleName}/`);
      }
    }
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

  // 4. 本地签发每个 scope 的 JWT（与 server 共用 JWT_SECRET，绕开 login 接口）
  //    原串行登录 + 登录间隔是为规避 429，本地签发无登录调用，零摩擦、无频控风险。
  log('yellow', `\n▶ 本地签发 JWT (TTL ${JWT_TTL_SECONDS}s)...`);
  const tokenMap = {};
  for (const [scope, payload] of Object.entries(scopes)) {
    tokenMap[scope] = issueScopeToken(payload);
    log('green', `  ✓ ${scope} (${payload.username})`);
  }

  // 5. 有限并发抓取所有 bundle 数据（并发闸：避免打爆 DuckDB 连接池）
  log('yellow', `\n▶ 构建快照 (并发 ${args.concurrency})...`);
  const etlDate = new Date().toISOString().slice(0, 10);
  const buildTime = new Date().toISOString();
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const fetchResults = await allSettledWithLimit(tasks, args.concurrency, async (task) => {
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
  });

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

  // 防静默失败：全部失败或成功数 < 总任务 80% 则退出 1
  const threshold = Math.max(1, Math.ceil(tasks.length * 0.8));
  if (successCount < threshold) {
    log('red', `  ✗ 成功数 ${successCount}/${tasks.length} 低于阈值 ${threshold}，本次构建失败`);
    process.exit(1);
  }

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
