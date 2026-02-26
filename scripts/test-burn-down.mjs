#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = [
  'tests/comparison-presets.test.ts',
  'tests/shared/types/branded.test.ts',
  'tests/api/client.test.ts',
  'tests/api/client-contracts.test.ts',
  'tests/api/wecom-mapping-path.test.ts',
];

const cmd = ['bun', 'run', 'test', '--', '--run', ...TARGETS];
const result = spawnSync(cmd[0], cmd.slice(1), {
  cwd: ROOT,
  encoding: 'utf-8',
  shell: false,
});

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const failedTests = [...output.matchAll(/×\s+(.+)/g)].map(m => m[1].trim());
const failedSuites = [...output.matchAll(/FAIL\s+(.+?)\s+\[/g)].map(m => m[1].trim());

const now = new Date().toISOString();
const reportDir = path.join(ROOT, 'artifacts', 'test-burndown');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'current.md');

const lines = [
  '# Test Burn-down Report',
  '',
  `- Generated at: ${now}`,
  `- Exit code: ${result.status ?? 1}`,
  `- Target suites: ${TARGETS.length}`,
  `- Failed suites: ${failedSuites.length}`,
  `- Failed tests: ${failedTests.length}`,
  '',
  '## Failed Suites',
  ...(failedSuites.length ? failedSuites.map(item => `- ${item}`) : ['- none']),
  '',
  '## Failed Tests',
  ...(failedTests.length ? failedTests.map(item => `- ${item}`) : ['- none']),
  '',
  '## Raw Command',
  `- ${cmd.join(' ')}`,
];

fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf-8');
console.log(`[burn-down] report written: ${reportPath}`);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
