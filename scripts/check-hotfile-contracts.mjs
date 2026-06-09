#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
  bold: '\x1b[1m',
};

const quietPass = process.argv.includes('--quiet-pass');

// 命名空间子客户端（Phase 2 拆分后业务方法的新归处）。
// ⚠️ 掏空陷阱：神类拆分把 84 个业务方法从 client.ts 搬到这些 *-api.ts 后，若门禁仍只锚
//    client.ts，则"改子客户端不触发门禁" → 契约联动只剩守 client.ts 里 ~15 个保留方法，
//    80% API 面失去契约保护。故每个子客户端都必须与 client.ts 同等受门禁。
//
// 清单从文件系统派生（glob src/shared/api/*-api.ts），**不硬编码**：新增 foo-api.ts 自动纳入
// 门禁、无需改本脚本——与 tests/api/sub-client-boundary.test.ts 同源（文件系统），从根上消除
// "两份清单漂移"（修复门禁工具自身的小掏空口，评审 PR #554 finding #1）。
let API_SUBCLIENTS;
try {
  API_SUBCLIENTS = readdirSync(path.join(ROOT_DIR, 'src/shared/api'))
    .filter((f) => f.endsWith('-api.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
} catch (err) {
  console.error(`[check-hotfile-contracts] 无法读取 src/shared/api：${err.message}`);
  process.exit(1);
}
if (API_SUBCLIENTS.length === 0) {
  // glob 空 = 路径错/重构异常；若静默放行会让全部子客户端脱离门禁，必须拒绝
  console.error('[check-hotfile-contracts] 未发现任何 *-api.ts —— 疑似路径错误或重构异常，拒绝放行');
  process.exit(1);
}

const RULES = [
  {
    hotfile: 'server/src/routes/query.ts',
    label: '查询路由热点文件',
    requiredPatterns: [/^tests\/api\/.*route-contract\.test\.ts$/],
    guidance: '请同步修改 tests/api/*route-contract.test.ts 以覆盖新的路由参数或 schema',
  },
  {
    hotfile: 'src/shared/api/client.ts',
    label: '前端 API 客户端入口热点文件',
    requiredPatterns: [/^tests\/api\/client-contracts\.test\.ts$/],
    guidance: '请同步修改 tests/api/client-contracts.test.ts 以锁定前端调用契约',
  },
  {
    hotfile: 'src/shared/api/client-core.ts',
    label: '前端 API 传输内核（全部子客户端共享，最高风险）',
    requiredPatterns: [/^tests\/api\/(client-core-transport|client-contracts)\.test\.ts$/],
    guidance: '传输内核改动须同步 tests/api/client-core-transport.test.ts（鉴权头/401刷新/GET合并/超时取消）或 client-contracts.test.ts',
  },
  ...API_SUBCLIENTS.map((name) => ({
    hotfile: `src/shared/api/${name}.ts`,
    label: `前端 API 命名空间子客户端（${name}）`,
    requiredPatterns: [/^tests\/api\/client-contracts\.test\.ts$/],
    guidance: '请同步修改 tests/api/client-contracts.test.ts 追加/更新该域命名空间调用契约',
  })),
];

function log(color, tag, message) {
  console.log(`${color}${COLORS.bold}[${tag}]${COLORS.reset} ${message}`);
}

function success(message) {
  if (!quietPass) log(COLORS.green, 'pass', message);
}

function warning(message) {
  log(COLORS.yellow, 'warn', message);
}

function error(message) {
  log(COLORS.red, 'fail', message);
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only -z', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split('\0').filter(Boolean);
  } catch {
    warning('无法读取 git 暂存区，跳过热点文件契约联动检查');
    return null;
  }
}

function main() {
  const stagedFiles = getStagedFiles();
  if (stagedFiles === null) {
    process.exit(0);
  }

  if (stagedFiles.length === 0) {
    success('暂存区为空，无需执行热点文件契约联动检查');
    process.exit(0);
  }

  const failures = [];

  for (const rule of RULES) {
    if (!stagedFiles.includes(rule.hotfile)) continue;

    const matchedTests = stagedFiles.filter((file) =>
      rule.requiredPatterns.some((pattern) => pattern.test(file))
    );

    if (matchedTests.length === 0) {
      failures.push(rule);
    }
  }

  if (failures.length > 0) {
    error(`检测到 ${failures.length} 个热点文件改动缺少契约测试联动：`);
    failures.forEach((rule) => {
      console.log(`    - ${rule.hotfile} (${rule.label})`);
      console.log(`      ${rule.guidance}`);
    });
    process.exit(1);
  }

  const touchedRules = RULES.filter((rule) => stagedFiles.includes(rule.hotfile));
  if (touchedRules.length === 0) {
    success('暂存区未改动热点契约文件');
  } else {
    success(
      `热点文件契约联动检查通过（${touchedRules.map((rule) => rule.hotfile).join(', ')}）`
    );
  }
}

main();
