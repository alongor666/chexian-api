#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseArgs(argv) {
  const options = {
    host: process.env.VPS_HOST || 'chexian-vps',
    remoteRoot: process.env.VPS_REMOTE_ROOT || '/var/www/chexian',
    baseUrl: process.env.VPS_BASE_URL || 'https://chexian.cretvalu.com',
    username: process.env.E2E_USERNAME || 'admin',
    password: process.env.E2E_PASSWORD || 'CxAdmin@2026!',
    skipVerify: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--host') {
      options.host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--remote-root') {
      options.remoteRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--base-url') {
      options.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--username') {
      options.username = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--password') {
      options.password = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--skip-verify') {
      options.skipVerify = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/release-vps-heatmap.mjs [options]',
      '',
      'Options:',
      '  --host <ssh-alias>       SSH host alias (default: chexian-vps)',
      '  --remote-root <path>     VPS deployment root (default: /var/www/chexian)',
      '  --base-url <url>         Verify URL (default: https://chexian.cretvalu.com)',
      '  --username <name>        Verify username (default: admin)',
      '  --password <pwd>         Verify password (default from E2E_PASSWORD)',
      '  --skip-verify            Deploy only, skip browser/API verification',
      '  -h, --help               Show help',
    ].join('\n')
  );
}

function run(command, cwd) {
  console.log(`\n$ ${command}`);
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '..');
  const stamp = formatTimestamp();

  const host = shellQuote(options.host);
  const remoteRoot = shellQuote(options.remoteRoot);

  console.log(`[release] target host: ${options.host}`);
  console.log(`[release] remote root: ${options.remoteRoot}`);
  console.log(`[release] verify url: ${options.baseUrl}`);

  run(`ssh ${host} echo ok`, rootDir);
  run('bun run build', rootDir);
  run('bun run build', path.join(rootDir, 'server'));

  run(
    [
      `ssh ${host} "set -e;`,
      `mkdir -p ${options.remoteRoot}/frontend ${options.remoteRoot}/server;`,
      `if [ -d ${options.remoteRoot}/frontend/dist ]; then cp -a ${options.remoteRoot}/frontend/dist ${options.remoteRoot}/frontend/dist.backup.${stamp}; fi;`,
      `if [ -d ${options.remoteRoot}/server/dist ]; then cp -a ${options.remoteRoot}/server/dist ${options.remoteRoot}/server/dist.backup.${stamp}; fi"`,
    ].join(' '),
    rootDir
  );

  run(`rsync -az --delete dist/ ${options.host}:${options.remoteRoot}/frontend/dist/`, rootDir);
  run(`rsync -az --delete server/dist/ ${options.host}:${options.remoteRoot}/server/dist/`, rootDir);

  run(
    [
      `ssh ${host} "source /root/.nvm/nvm.sh >/dev/null 2>&1 || true;`,
      `pm2 restart chexian-api;`,
      'sleep 3;',
      'pm2 status chexian-api;',
      'curl -sS -m 10 http://127.0.0.1:3000/health"',
    ].join(' '),
    rootDir
  );

  if (!options.skipVerify) {
    run(
      [
        'node scripts/verify-vps-heatmap.mjs',
        `--base-url ${shellQuote(options.baseUrl)}`,
        `--username ${shellQuote(options.username)}`,
        `--password ${shellQuote(options.password)}`,
        '--output-dir output/playwright',
      ].join(' '),
      rootDir
    );
  }

  console.log('\n[release] completed');
  if (options.skipVerify) {
    console.log('[release] verify step skipped (--skip-verify)');
  } else {
    console.log('[release] verify step passed');
  }
}

try {
  main();
} catch (error) {
  console.error(`[release] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
