/**
 * state.db 远程定时备份 — 纯函数层（BACKLOG 2026-07-03-claude-575d2f）
 *
 * 背景：server/src/services/state-db.ts（PAT / 用户 / 角色权威数据）有 backup() API，
 * 但生产此前无任何定时备份，磁盘故障 / 误删即永久丢失（2026-07-03 后端审查实证）。
 * 本模块生成「在 VPS 上执行的备份 shell 脚本」，由 scripts/sync-and-reload.mjs 在
 * PM2 reload 前通过 ssh 执行；备份失败只告警、绝不阻塞发布。
 *
 * 设计要点：
 * - 优先用 sqlite3 CLI 的 .backup（在线安全备份，正确处理 WAL 日志）；
 *   VPS 未装 sqlite3 时退化为 cp（连同 -wal / -shm 一起拷，SQLite 可自行恢复）
 * - 备份文件按天命名 state-YYYYMMDD.db（同日重跑幂等覆盖），按文件名排序
 *   只保留最近 N 份，旧备份连同 -wal / -shm 一并清理
 * - 路径 / 保留份数在拼进 shell 前做白名单校验，杜绝注入
 */

/** 备份开关 / 路径 / 保留份数的环境变量默认值（生产 PM2 部署根 = /var/www/chexian） */
export const STATE_DB_BACKUP_DEFAULTS = Object.freeze({
  remoteDbPath: '/var/www/chexian/server/data/state.db',
  backupDir: '/var/www/chexian/server/data/backups/state',
  keep: 14,
});

/** 绝对路径白名单：斜杠开头，仅含字母数字与 . _ - /（防 shell 注入与相对路径） */
const SAFE_ABS_PATH = /^\/[A-Za-z0-9._/-]+$/;

/**
 * 从环境变量解析备份配置。非法值直接抛错（调用方按「备份失败告警继续」处理）。
 *
 * 环境变量：
 *   STATE_DB_BACKUP_ENABLED  默认启用；'0' / 'false' 关闭（deployer 无读权限时的开关）
 *   STATE_DB_REMOTE_PATH     VPS 上 state.db 绝对路径
 *   STATE_DB_BACKUP_DIR      VPS 上备份目录绝对路径
 *   STATE_DB_BACKUP_KEEP     保留份数（1~365 整数）
 *
 * @param {Record<string, string|undefined>} env 一般传 process.env
 * @returns {{enabled: boolean, remoteDbPath: string, backupDir: string, keep: number}}
 */
export function resolveStateDbBackupConfig(env) {
  const rawEnabled = (env.STATE_DB_BACKUP_ENABLED ?? '1').trim().toLowerCase();
  const enabled = !['0', 'false', 'off', 'no'].includes(rawEnabled);

  const remoteDbPath = (env.STATE_DB_REMOTE_PATH || STATE_DB_BACKUP_DEFAULTS.remoteDbPath).trim();
  const backupDir = (env.STATE_DB_BACKUP_DIR || STATE_DB_BACKUP_DEFAULTS.backupDir).trim();
  for (const [label, value] of [['STATE_DB_REMOTE_PATH', remoteDbPath], ['STATE_DB_BACKUP_DIR', backupDir]]) {
    if (!SAFE_ABS_PATH.test(value)) {
      throw new Error(`[state-backup] ${label} 必须是仅含字母数字._-/ 的绝对路径，当前：${value}`);
    }
  }

  const rawKeep = env.STATE_DB_BACKUP_KEEP ?? String(STATE_DB_BACKUP_DEFAULTS.keep);
  const keep = Number(rawKeep);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
    throw new Error(`[state-backup] STATE_DB_BACKUP_KEEP 必须是 1~365 的整数，当前：${rawKeep}`);
  }

  return { enabled, remoteDbPath, backupDir, keep };
}

/**
 * 生成在 VPS 上执行的备份脚本（单条 ssh 远程命令）。
 *
 * 行为：state.db 不存在 → 明确报错退出（exit 3）；sqlite3 可用走在线 .backup，
 * 否则 cp 连带 -wal/-shm；最后按文件名倒排清理超出保留份数的旧备份。
 *
 * @param {object} cfg
 * @param {string} cfg.remoteDbPath state.db 在 VPS 上的绝对路径
 * @param {string} cfg.backupDir 备份目录绝对路径
 * @param {string} cfg.dateStamp 备份文件日期戳（YYYYMMDD，北京时区）
 * @param {number} cfg.keep 保留最近 N 份
 * @returns {string} POSIX sh 脚本
 */
export function buildStateDbBackupScript({ remoteDbPath, backupDir, dateStamp, keep }) {
  if (!SAFE_ABS_PATH.test(remoteDbPath) || !SAFE_ABS_PATH.test(backupDir)) {
    throw new Error('[state-backup] remoteDbPath / backupDir 必须是安全绝对路径');
  }
  if (!/^\d{8}$/.test(dateStamp)) {
    throw new Error(`[state-backup] dateStamp 必须是 YYYYMMDD，当前：${dateStamp}`);
  }
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
    throw new Error(`[state-backup] keep 必须是 1~365 的整数，当前：${keep}`);
  }

  return [
    'set -eu',
    `DB='${remoteDbPath}'`,
    `DIR='${backupDir}'`,
    `DEST='${backupDir}/state-${dateStamp}.db'`,
    `KEEP=${keep}`,
    'if [ ! -f "$DB" ]; then echo "[state-backup] state.db 不存在：$DB（生产 STATE_STORE_BACKEND 可能非 sqlite，或路径配置不符）"; exit 3; fi',
    'mkdir -p "$DIR"',
    'if command -v sqlite3 >/dev/null 2>&1; then',
    '  sqlite3 "$DB" ".backup \'$DEST\'"',
    '  echo "[state-backup] sqlite3 在线备份完成 → $DEST"',
    'else',
    '  cp "$DB" "$DEST"',
    '  if [ -f "$DB-wal" ]; then cp "$DB-wal" "$DEST-wal"; fi',
    '  if [ -f "$DB-shm" ]; then cp "$DB-shm" "$DEST-shm"; fi',
    '  echo "[state-backup] 未检测到 sqlite3 CLI，退化为 cp（已连带 -wal/-shm）→ $DEST"',
    'fi',
    'ls -1 "$DIR"/state-*.db 2>/dev/null | sort | head -n -"$KEEP" | while read -r f; do',
    '  rm -f "$f" "$f-wal" "$f-shm"',
    '  echo "[state-backup] 清理旧备份：$f"',
    'done',
    'echo "[state-backup] 当前备份份数：$(ls -1 "$DIR"/state-*.db 2>/dev/null | wc -l)（保留上限 $KEEP）"',
  ].join('\n');
}
