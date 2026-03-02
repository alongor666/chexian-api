#!/usr/bin/env node

/**
 * 清理未跟踪的调试产物，避免日志/快照误提交。
 *
 * 仅删除 git 未跟踪文件，不会删除已跟踪文件。
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();

const EXACT_BASENAMES = new Set([
  'test_output.txt',
  'vitest_log.txt',
  'dev_log.txt',
  'test_err.txt',
]);

function getUntrackedFiles() {
  try {
    const raw = execSync('git ls-files --others --exclude-standard -z', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return raw.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function shouldRemove(relPath) {
  if (relPath.startsWith('.playwright-cli/')) return true;
  if (relPath.startsWith('playwright-report/')) return true;
  if (relPath.startsWith('test-results/')) return true;
  if (EXACT_BASENAMES.has(path.basename(relPath))) return true;
  return false;
}

function safeRemoveFile(relPath) {
  const absPath = path.join(ROOT_DIR, relPath);
  try {
    fs.rmSync(absPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const untracked = getUntrackedFiles();
  const targets = untracked.filter(shouldRemove);

  if (targets.length === 0) {
    console.log('[cleanup-debug-artifacts] no untracked debug artifacts');
    return;
  }

  let removed = 0;
  for (const file of targets) {
    if (safeRemoveFile(file)) removed++;
  }

  console.log(`[cleanup-debug-artifacts] removed ${removed}/${targets.length} file(s)`);
}

main();
