/**
 * warehouse 备份纯函数测试（BACKLOG 2026-07-12-claude-3dac98 · 审计FIND-002）
 * 覆盖：环境变量解析（默认值 / 非法值 fail-fast / 自包含递归拒绝）
 *     + 备份/校验脚本生成（递归清单不变式 / 无扁平通配 / 注入防护 / 北京时区戳）
 */
import { describe, expect, it } from 'vitest';
import {
  WAREHOUSE_BACKUP_DEFAULTS,
  beijingDateStamp,
  buildWarehouseBackupScript,
  buildWarehouseVerifyScript,
  resolveWarehouseBackupConfig,
} from '../scripts/lib/warehouse-backup.mjs';

describe('resolveWarehouseBackupConfig', () => {
  it('空环境变量时给出生产默认值', () => {
    expect(resolveWarehouseBackupConfig({})).toEqual({
      srcDir: WAREHOUSE_BACKUP_DEFAULTS.srcDir,
      backupDir: WAREHOUSE_BACKUP_DEFAULTS.backupDir,
      keep: 7,
    });
  });

  it('自定义路径与保留份数生效，尾部斜杠被归一', () => {
    const cfg = resolveWarehouseBackupConfig({
      WAREHOUSE_BACKUP_SRC: '/opt/app/data/',
      WAREHOUSE_BACKUP_DIR: '/opt/backups/warehouse',
      WAREHOUSE_BACKUP_KEEP: '30',
    });
    expect(cfg).toEqual({ srcDir: '/opt/app/data', backupDir: '/opt/backups/warehouse', keep: 30 });
  });

  it.each([
    ['相对路径', { WAREHOUSE_BACKUP_SRC: 'data' }],
    ['含 shell 元字符', { WAREHOUSE_BACKUP_DIR: '/tmp/$(rm -rf /)' }],
    ['含单引号', { WAREHOUSE_BACKUP_DIR: "/tmp/a'b" }],
    ['含空格', { WAREHOUSE_BACKUP_SRC: '/tmp/a b' }],
  ])('非法路径 fail-fast：%s', (_label, env) => {
    expect(() => resolveWarehouseBackupConfig(env as Record<string, string>)).toThrow(/绝对路径/);
  });

  it.each(['0', '366', '1.5', 'abc'])('非法保留份数 %s fail-fast', (v) => {
    expect(() => resolveWarehouseBackupConfig({ WAREHOUSE_BACKUP_KEEP: v })).toThrow(/1~365/);
  });

  it('备份目录位于源目录内部时拒绝（防自包含递归）', () => {
    expect(() =>
      resolveWarehouseBackupConfig({
        WAREHOUSE_BACKUP_SRC: '/var/www/chexian/server/data',
        WAREHOUSE_BACKUP_DIR: '/var/www/chexian/server/data/backups',
      }),
    ).toThrow(/源目录内部/);
  });
});

describe('buildWarehouseBackupScript', () => {
  const cfg = { srcDir: '/opt/data', backupDir: '/opt/bak', dateStamp: '20260712', keep: 7 };

  it('内容不变式：find 递归清单 + tar -T 按清单打包 + sha256 清单 + 滚动清理', () => {
    const s = buildWarehouseBackupScript(cfg);
    expect(s).toContain('set -eu');
    expect(s).toContain('find . -type f'); // 递归清单，天然覆盖分省子目录
    expect(s).toContain('-T "$LIST"'); // 按清单打包，不经 shell 通配
    expect(s).not.toMatch(/\*\.parquet/); // 明确不复现旧文档的扁平通配写法
    expect(s).toContain("! -name 'state.db*'"); // 排除独立备份通道的热文件
    expect(s).toContain("! -path './backups/*'"); // 排除源内备份目录
    expect(s).toContain('/opt/bak/warehouse-20260712.tar.gz');
    expect(s).toContain('$ARCHIVE.manifest');
    expect(s).toContain('EXCESS=$((TOTAL - KEEP))'); // 可移植滚动清理
    expect(s).not.toContain('head -n -'); // 禁 GNU-only 负数 head
  });

  it('产物先落 .tmp 再原子改名（半成品不会被当成有效备份）', () => {
    const s = buildWarehouseBackupScript(cfg);
    expect(s).toContain('tar -czf "$ARCHIVE.tmp"');
    expect(s).toContain('mv "$ARCHIVE.tmp" "$ARCHIVE"');
  });

  it.each([
    ['dateStamp 非八位', { ...cfg, dateStamp: '2026-07-12' }, /YYYYMMDD/],
    ['srcDir 注入', { ...cfg, srcDir: '/opt/a;rm -rf /' }, /绝对路径/],
    ['keep 越界', { ...cfg, keep: 0 }, /1~365/],
  ])('非法入参 fail-fast：%s', (_label, bad, msg) => {
    expect(() => buildWarehouseBackupScript(bad as never)).toThrow(msg);
  });
});

describe('buildWarehouseVerifyScript', () => {
  it('内容不变式：还原到临时目录 + sha256 -c 对账 + 文件数双向核对 + 清理', () => {
    const s = buildWarehouseVerifyScript({ archivePath: '/opt/bak/warehouse-20260712.tar.gz' });
    expect(s).toContain('tar -xzf "$ARCHIVE" -C "$TMP"');
    expect(s).toContain('$SHA -c "$MANIFEST"');
    expect(s).toContain('[ "$EXPECT" -ne "$GOT" ]');
    expect(s).toContain("trap 'rm -rf \"$TMP\"' EXIT");
  });

  it.each([
    ['非 tar.gz 后缀', '/opt/bak/warehouse.zip', /tar\.gz/],
    ['路径注入', '/opt/bak/$(id).tar.gz', /绝对路径/],
  ])('非法归档路径 fail-fast：%s', (_label, p, msg) => {
    expect(() => buildWarehouseVerifyScript({ archivePath: p })).toThrow(msg);
  });
});

describe('beijingDateStamp', () => {
  it('按北京时区（UTC+8）出 YYYYMMDD：UTC 晚间跨天', () => {
    // 2026-07-11T22:00Z = 北京 2026-07-12 06:00
    expect(beijingDateStamp(new Date('2026-07-11T22:00:00Z'))).toBe('20260712');
    expect(beijingDateStamp(new Date('2026-07-11T10:00:00Z'))).toBe('20260711');
  });
});
