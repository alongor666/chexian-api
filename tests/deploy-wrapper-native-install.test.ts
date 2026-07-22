import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const wrapperPath = path.join(root, 'deploy/vps-wrapper/deploy-chexian-api.sh');
const source = readFileSync(wrapperPath, 'utf8');

describe('VPS wrapper 原生依赖安装护栏', () => {
  it('保持 shell 语法有效', () => {
    expect(() => execFileSync('bash', ['-n', wrapperPath])).not.toThrow();
  });

  it('依赖安装有硬超时，并在国内 registry 安装后逐包源码构建原生模块', () => {
    expect(source).toContain('TIMEOUT_BIN="/usr/bin/timeout"');
    expect(source).toContain('DEPENDENCY_STEP_TIMEOUT="600s"');
    expect(source).toContain('--signal=TERM --kill-after=30s');
    expect(source).toContain('ci --omit=dev --ignore-scripts');
    expect(source).toContain('NATIVE_SOURCE_MODULES=("bcrypt" "better-sqlite3")');
    expect(source).toContain('env npm_config_build_from_source=true "$NPM_BIN" rebuild "$MOD"');
  });

  it('package-lock 中生产 install scripts 仍只来自被逐包源码构建的两个模块', () => {
    const lock = JSON.parse(
      readFileSync(path.join(root, 'server/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { dev?: boolean; hasInstallScript?: boolean }> };
    const productionInstallScripts = Object.entries(lock.packages)
      .filter(([, pkg]) => pkg.hasInstallScript && !pkg.dev)
      .map(([name]) => name)
      .sort();

    expect(productionInstallScripts).toEqual([
      'node_modules/bcrypt',
      'node_modules/better-sqlite3',
    ]);
  });
});
