/**
 * state.db 远程备份纯函数测试（BACKLOG 2026-07-03-claude-575d2f）
 * 覆盖：环境变量解析（默认值 / 开关 / 非法值 fail-fast）+ 备份脚本生成（内容不变式 / 注入防护）
 */
import { describe, expect, it } from 'vitest';
import {
  STATE_DB_BACKUP_DEFAULTS,
  buildStateDbBackupScript,
  resolveStateDbBackupConfig,
} from '../scripts/lib/state-db-backup.mjs';

describe('resolveStateDbBackupConfig', () => {
  it('空环境变量时给出生产默认值且默认启用', () => {
    const cfg = resolveStateDbBackupConfig({});
    expect(cfg).toEqual({
      enabled: true,
      remoteDbPath: STATE_DB_BACKUP_DEFAULTS.remoteDbPath,
      backupDir: STATE_DB_BACKUP_DEFAULTS.backupDir,
      keep: 14,
    });
  });

  it.each(['0', 'false', 'off', 'no', ' FALSE '])('STATE_DB_BACKUP_ENABLED=%s 时关闭备份', (v) => {
    expect(resolveStateDbBackupConfig({ STATE_DB_BACKUP_ENABLED: v }).enabled).toBe(false);
  });

  it('自定义路径与保留份数生效', () => {
    const cfg = resolveStateDbBackupConfig({
      STATE_DB_REMOTE_PATH: '/opt/app/data/state.db',
      STATE_DB_BACKUP_DIR: '/opt/backups/state',
      STATE_DB_BACKUP_KEEP: '30',
    });
    expect(cfg.remoteDbPath).toBe('/opt/app/data/state.db');
    expect(cfg.backupDir).toBe('/opt/backups/state');
    expect(cfg.keep).toBe(30);
  });

  it('相对路径 / 含 shell 危险字符的路径直接抛错（fail-fast，不产出可注入命令）', () => {
    expect(() => resolveStateDbBackupConfig({ STATE_DB_REMOTE_PATH: 'data/state.db' })).toThrow('绝对路径');
    expect(() => resolveStateDbBackupConfig({ STATE_DB_BACKUP_DIR: "/tmp/x'; rm -rf /" })).toThrow('绝对路径');
    expect(() => resolveStateDbBackupConfig({ STATE_DB_BACKUP_DIR: '/tmp/a b' })).toThrow('绝对路径');
  });

  it.each(['0', '-1', '366', '1.5', 'abc', ''])('STATE_DB_BACKUP_KEEP=%s 抛错', (v) => {
    expect(() => resolveStateDbBackupConfig({ STATE_DB_BACKUP_KEEP: v })).toThrow('1~365');
  });
});

describe('buildStateDbBackupScript', () => {
  const base = {
    remoteDbPath: '/var/www/chexian/server/data/state.db',
    backupDir: '/var/www/chexian/server/data/backups/state',
    dateStamp: '20260706',
    keep: 14,
  };

  it('脚本包含全部关键不变式：fail-fast 缺库告警 / sqlite3 在线备份 / cp 退化 / 保留 N 份清理', () => {
    const script = buildStateDbBackupScript(base);
    expect(script).toContain('set -eu');
    expect(script).toContain("DB='/var/www/chexian/server/data/state.db'");
    expect(script).toContain("DEST='/var/www/chexian/server/data/backups/state/state-20260706.db'");
    expect(script).toContain('exit 3');
    expect(script).toContain('command -v sqlite3');
    expect(script).toContain('.backup');
    expect(script).toContain('cp "$DB" "$DEST"');
    expect(script).toContain('"$DB-wal"');
    expect(script).toContain('head -n -"$KEEP"');
    expect(script).toContain('rm -f "$f" "$f-wal" "$f-shm"');
    expect(script).toContain('KEEP=14');
  });

  it('同日重跑目标文件名相同（幂等覆盖，不产生同日多份）', () => {
    const a = buildStateDbBackupScript(base);
    const b = buildStateDbBackupScript({ ...base, keep: 14 });
    expect(a).toBe(b);
  });

  it('非法 dateStamp / keep / 路径抛错', () => {
    expect(() => buildStateDbBackupScript({ ...base, dateStamp: '2026-07-06' })).toThrow('YYYYMMDD');
    expect(() => buildStateDbBackupScript({ ...base, keep: 0 })).toThrow('1~365');
    expect(() => buildStateDbBackupScript({ ...base, remoteDbPath: '../state.db' })).toThrow('安全绝对路径');
    expect(() => buildStateDbBackupScript({ ...base, backupDir: '/tmp/$(id)' })).toThrow('安全绝对路径');
  });
});
