import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  expandHomePath,
  parseArgs,
  parseSSHConfig,
  resolveSSHConfig,
} from '../../scripts/sync-vps.mjs';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
});

describe('sync-vps script config helpers', () => {
  it('parses cli args including dry-run and overrides', () => {
    const parsed = parseArgs([
      '--export',
      '--no-restart',
      '--dry-run',
      '--alias',
      'vps-alias',
      '--host',
      '1.2.3.4',
      '--user',
      'deployer',
      '--port',
      '2222',
      '--key',
      '/tmp/key',
      '--remote-dir',
      '/var/data',
      '--health-url',
      'http://localhost:3000/health',
      'custom.parquet',
    ]);

    expect(parsed).toMatchObject({
      exportMode: true,
      noRestart: true,
      dryRun: true,
      alias: 'vps-alias',
      host: '1.2.3.4',
      username: 'deployer',
      port: 2222,
      keyPath: '/tmp/key',
      remoteDir: '/var/data',
      healthUrl: 'http://localhost:3000/health',
      targetFile: 'custom.parquet',
    });
  });

  it('parses ssh config host block with identity file', () => {
    const config = `
Host other-alias
  HostName 10.0.0.1

Host chexian-vps-deploy
  HostName 162.14.113.44
  User deployer
  Port 22
  IdentityFile ~/.ssh/chexian_deploy
`;
    const parsed = parseSSHConfig('chexian-vps-deploy', config);
    expect(parsed).toBeTruthy();
    expect(parsed).toMatchObject({
      host: '162.14.113.44',
      username: 'deployer',
      port: 22,
    });
    expect(parsed?.privateKeyPath).toContain('.ssh');
  });

  it('resolves ssh config from HOME/.ssh/config on unix-like paths', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-vps-test-'));
    const sshDir = path.join(tempRoot, '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });

    const keyPath = path.join(sshDir, 'chexian_deploy');
    fs.writeFileSync(keyPath, 'dummy-key');
    fs.writeFileSync(
      path.join(sshDir, 'config'),
      [
        'Host chexian-vps-deploy',
        '  HostName 162.14.113.44',
        '  User deployer',
        '  Port 22',
        '  IdentityFile ~/.ssh/chexian_deploy',
      ].join('\n')
    );

    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const resolved = resolveSSHConfig(parseArgs([]));
    expect(resolved).toMatchObject({
      alias: 'chexian-vps-deploy',
      host: '162.14.113.44',
      username: 'deployer',
      port: 22,
      privateKeyPath: keyPath,
    });
  });

  it('expands home path consistently', () => {
    const expanded = expandHomePath('~/.ssh/chexian_deploy');
    expect(expanded).toContain('.ssh');
    expect(expanded.endsWith(path.join('.ssh', 'chexian_deploy'))).toBe(true);
  });
});
