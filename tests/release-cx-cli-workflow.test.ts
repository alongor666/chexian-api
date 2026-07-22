import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourcePromotion = readFileSync('.github/workflows/release-cx-cli.yml', 'utf8');
const mirrorRelease = readFileSync('cli/.github/workflows/release.yml', 'utf8');
const mirrorSync = readFileSync('.github/workflows/sync-cx-cli.yml', 'utf8');
const cliPackage = JSON.parse(readFileSync('cli/package.json', 'utf8')) as { version: string };

describe('cx-cli 发布链契约', () => {
  it('chexian-api 只提升镜像 tag，不成为第二个 release 发布者', () => {
    expect(sourcePromotion).toContain('Create immutable tag on mirror main');
    expect(sourcePromotion).not.toContain('gh release create');
    expect(sourcePromotion).not.toMatch(/node -p \\\"/);
  });

  it('镜像是唯一二进制发布者且只上传受控资产', () => {
    expect(mirrorRelease).toContain('bun install --frozen-lockfile');
    expect(mirrorRelease).toContain('bun run test');
    expect(mirrorRelease).not.toMatch(/^\s*bun test\s*$/m);
    expect(mirrorRelease).toContain('bun run package:release');
    expect(mirrorRelease).toContain('gh release create "$RELEASE_TAG"');
    expect(mirrorRelease).toContain('cx-windows-x64.exe');
    expect(mirrorRelease).not.toContain('cx-windows.exe');
    expect(mirrorRelease).not.toContain('yao-pkg');
  });

  it('同步源码指纹与 Bun 锁文件，且发布版本不低于线上 v1.0.0', () => {
    expect(mirrorSync).toContain('source-commit.txt');
    expect(mirrorSync).not.toContain("--filter='P package-lock.json'");
    expect(readFileSync('cli/bun.lock', 'utf8')).toContain('lockfileVersion');

    const [major, minor, patch] = cliPackage.version.split('.').map(Number);
    expect([major, minor, patch].every(Number.isInteger)).toBe(true);
    expect(major > 1 || (major === 1 && (minor > 0 || patch > 0))).toBe(true);
  });
});
