#!/usr/bin/env node

import { execSync } from 'node:child_process';
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

const RULES = [
  {
    hotfile: 'server/src/routes/query.ts',
    label: '查询路由热点文件',
    requiredPatterns: [/^tests\/api\/.*route-contract\.test\.ts$/],
    guidance: '请同步修改 tests/api/*route-contract.test.ts 以覆盖新的路由参数或 schema',
  },
  {
    // Phase 2 神类拆分后，API 调用方法分散在 client.ts（核心 query + 会话生命周期）
    // 与 10 个命名空间子客户端 src/shared/api/*-api.ts。任一改动都可能改变前端调用契约，
    // 故用 pattern 覆盖整组，避免「只改 auth-api.ts 不碰 client.ts」绕过门禁导致契约漂移。
    hotfilePattern: /^src\/shared\/api\/(client\.ts|[a-z0-9-]+-api\.ts)$/,
    label: '前端 API 客户端热点文件（client.ts + 命名空间子客户端 *-api.ts）',
    requiredPatterns: [/^tests\/api\/client-contracts\.test\.ts$/],
    guidance: '请同步修改 tests/api/client-contracts.test.ts 以锁定前端调用契约',
  },
];

/** 命中热点：精确 hotfile 或 hotfilePattern 任一匹配暂存文件 */
function matchedHotfiles(rule, stagedFiles) {
  if (rule.hotfile) {
    return stagedFiles.includes(rule.hotfile) ? [rule.hotfile] : [];
  }
  return stagedFiles.filter((file) => rule.hotfilePattern.test(file));
}

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
    const hits = matchedHotfiles(rule, stagedFiles);
    if (hits.length === 0) continue;

    const matchedTests = stagedFiles.filter((file) =>
      rule.requiredPatterns.some((pattern) => pattern.test(file))
    );

    if (matchedTests.length === 0) {
      failures.push({ rule, hits });
    }
  }

  if (failures.length > 0) {
    error(`检测到 ${failures.length} 个热点文件改动缺少契约测试联动：`);
    failures.forEach(({ rule, hits }) => {
      console.log(`    - ${hits.join(', ')} (${rule.label})`);
      console.log(`      ${rule.guidance}`);
    });
    process.exit(1);
  }

  const touched = RULES.flatMap((rule) => matchedHotfiles(rule, stagedFiles));
  if (touched.length === 0) {
    success('暂存区未改动热点契约文件');
  } else {
    success(`热点文件契约联动检查通过（${touched.join(', ')}）`);
  }
}

main();
