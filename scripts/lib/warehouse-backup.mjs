/**
 * warehouse 源数据备份 — 纯函数层（BACKLOG 2026-07-12-claude-3dac98 · 审计FIND-002）
 *
 * 背景：生产 VPS 的 server/data（保单/赔案/报价 parquet + 维度表）此前无任何自动化备份，
 * 唯一"备份说明"是 DEPLOYMENT_GUIDE.md 里一段手抄 heredoc，且 `*.parquet` 扁平通配
 * 匹配不到分省子目录（current/SC/、current/SX/），从未入仓、从未自动执行。
 * 磁盘故障/误删时只能靠本地 Mac 重跑全量 ETL——而该 Mac 又是发布链单点（FIND-001）。
 *
 * 设计要点（与 scripts/lib/state-db-backup.mjs 同构：纯函数生成 POSIX sh，调用方执行）：
 * - 备份 = find 文件清单（递归，天然覆盖分省子目录）→ 逐文件 sha256 清单 → tar 按清单打包
 *   （不用 shell 通配，杜绝扁平 glob 漏文件的老毛病）
 * - 排除 state.db*（已有独立在线备份通道，且 SQLite 热文件在 tar 读取中变化会致非零退出）
 *   与备份目录自身（防自包含递归）
 * - 校验 = 从归档完整还原到临时目录 → sha256 -c 逐文件对账 + 文件数双向核对
 * - 保留最近 N 份滚动清理（可移植写法，GNU/BSD 工具链均可跑，便于本地合成数据自测）
 * - 同日重跑幂等覆盖（文件名按天戳）
 * - 生成的 sh 零依赖（tar + find + sha256sum/shasum），可直接挂 VPS crontab——
 *   但「挂定时」是后续单独一步，本模块只交付能力，不碰生产
 */

/** 备份路径/保留份数默认值（生产 PM2 部署根 = /var/www/chexian） */
export const WAREHOUSE_BACKUP_DEFAULTS = Object.freeze({
  srcDir: '/var/www/chexian/server/data',
  backupDir: '/var/backups/chexian/warehouse',
  keep: 7,
});

/** 绝对路径白名单：斜杠开头，仅含字母数字与 . _ - /（防 shell 注入与相对路径） */
const SAFE_ABS_PATH = /^\/[A-Za-z0-9._/-]+$/;

function assertSafeAbsPath(label, value) {
  if (!SAFE_ABS_PATH.test(value)) {
    throw new Error(`[warehouse-backup] ${label} 必须是仅含字母数字._-/ 的绝对路径，当前：${value}`);
  }
}

function assertKeep(keep) {
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
    throw new Error(`[warehouse-backup] keep 必须是 1~365 的整数，当前：${keep}`);
  }
}

/**
 * 从环境变量解析备份配置。非法值直接抛错（调用方 fail-fast）。
 *
 * 环境变量：
 *   WAREHOUSE_BACKUP_SRC   源数据目录绝对路径（默认生产 server/data）
 *   WAREHOUSE_BACKUP_DIR   备份目录绝对路径（必须在源目录之外）
 *   WAREHOUSE_BACKUP_KEEP  保留份数（1~365 整数）
 *
 * @param {Record<string, string|undefined>} env 一般传 process.env
 * @returns {{srcDir: string, backupDir: string, keep: number}}
 */
export function resolveWarehouseBackupConfig(env) {
  const srcDir = (env.WAREHOUSE_BACKUP_SRC || WAREHOUSE_BACKUP_DEFAULTS.srcDir).trim().replace(/\/+$/, '');
  const backupDir = (env.WAREHOUSE_BACKUP_DIR || WAREHOUSE_BACKUP_DEFAULTS.backupDir).trim().replace(/\/+$/, '');
  assertSafeAbsPath('WAREHOUSE_BACKUP_SRC', srcDir);
  assertSafeAbsPath('WAREHOUSE_BACKUP_DIR', backupDir);
  if (backupDir === srcDir || backupDir.startsWith(`${srcDir}/`)) {
    throw new Error(`[warehouse-backup] 备份目录不得位于源目录内部（防自包含递归）：${backupDir}`);
  }

  const rawKeep = env.WAREHOUSE_BACKUP_KEEP ?? String(WAREHOUSE_BACKUP_DEFAULTS.keep);
  const keep = Number(rawKeep);
  assertKeep(keep);

  return { srcDir, backupDir, keep };
}

/** sha256 工具探测片段（Linux=sha256sum，macOS=shasum -a 256），两模式共用 */
const DETECT_SHA = [
  'if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum;',
  'elif command -v shasum >/dev/null 2>&1; then SHA="shasum -a 256";',
  'else echo "[warehouse-backup] 缺少 sha256sum/shasum，无法生成校验清单"; exit 5; fi',
].join(' ');

/**
 * 生成备份脚本（POSIX sh）。
 *
 * 行为：源目录不存在/无文件 → 明确报错退出（exit 3）；生成
 * warehouse-<日期戳>.tar.gz + 同名 .manifest（逐文件 sha256，相对路径），
 * 归档成员按 find 清单逐一列入（含任意深度子目录），最后滚动清理超出保留份数的旧备份。
 *
 * @param {object} cfg
 * @param {string} cfg.srcDir 源数据目录绝对路径
 * @param {string} cfg.backupDir 备份目录绝对路径
 * @param {string} cfg.dateStamp 备份文件日期戳（YYYYMMDD，北京时区）
 * @param {number} cfg.keep 保留最近 N 份
 * @returns {string} POSIX sh 脚本
 */
export function buildWarehouseBackupScript({ srcDir, backupDir, dateStamp, keep }) {
  assertSafeAbsPath('srcDir', srcDir);
  assertSafeAbsPath('backupDir', backupDir);
  if (!/^\d{8}$/.test(dateStamp)) {
    throw new Error(`[warehouse-backup] dateStamp 必须是 YYYYMMDD，当前：${dateStamp}`);
  }
  assertKeep(keep);

  return [
    'set -eu',
    `SRC='${srcDir}'`,
    `DIR='${backupDir}'`,
    `ARCHIVE='${backupDir}/warehouse-${dateStamp}.tar.gz'`,
    `KEEP=${keep}`,
    DETECT_SHA,
    'if [ ! -d "$SRC" ]; then echo "[warehouse-backup] 源目录不存在：$SRC"; exit 3; fi',
    'mkdir -p "$DIR"',
    'LIST=$(mktemp); trap \'rm -f "$LIST"\' EXIT',
    // 递归文件清单：排除 state.db*（独立备份通道 + 热文件）与源目录内可能存在的 backups/
    "( cd \"$SRC\" && find . -type f ! -name 'state.db*' ! -path './backups/*' | LC_ALL=C sort > \"$LIST\" )",
    'COUNT=$(wc -l < "$LIST" | tr -d " ")',
    'if [ "$COUNT" -eq 0 ]; then echo "[warehouse-backup] 源目录无可备份文件：$SRC"; exit 3; fi',
    // 逐文件 sha256 清单（相对路径，供 verify 模式 -c 对账）
    '( cd "$SRC" && xargs $SHA < "$LIST" > "$ARCHIVE.manifest.tmp" )',
    // 按清单打包：不经 shell 通配，任意深度子目录（如 fact/policy/current/SC/）逐一入档
    'tar -czf "$ARCHIVE.tmp" -C "$SRC" -T "$LIST"',
    'mv "$ARCHIVE.tmp" "$ARCHIVE" && mv "$ARCHIVE.manifest.tmp" "$ARCHIVE.manifest"',
    'echo "[warehouse-backup] 备份完成：$ARCHIVE（$COUNT 个文件，$(du -h "$ARCHIVE" | cut -f1)）"',
    // 滚动清理（可移植写法：不依赖 GNU head -n -N）
    'TOTAL=$(ls -1 "$DIR"/warehouse-*.tar.gz 2>/dev/null | wc -l | tr -d " ")',
    'EXCESS=$((TOTAL - KEEP))',
    'if [ "$EXCESS" -gt 0 ]; then',
    '  ls -1 "$DIR"/warehouse-*.tar.gz | LC_ALL=C sort | head -n "$EXCESS" | while read -r f; do',
    '    rm -f "$f" "$f.manifest"',
    '    echo "[warehouse-backup] 清理旧备份：$f"',
    '  done',
    'fi',
    'echo "[warehouse-backup] 当前备份份数：$(ls -1 "$DIR"/warehouse-*.tar.gz 2>/dev/null | wc -l | tr -d " ")（保留上限 $KEEP）"',
  ].join('\n');
}

/**
 * 生成校验脚本（POSIX sh）：从归档完整还原到临时目录 → 逐文件 sha256 对账 + 文件数双向核对。
 * 任何不一致（缺文件/多文件/内容被改）→ 非零退出并打印差异。
 *
 * @param {object} cfg
 * @param {string} cfg.archivePath 归档绝对路径（.tar.gz，清单为同名 .manifest）
 * @returns {string} POSIX sh 脚本
 */
export function buildWarehouseVerifyScript({ archivePath }) {
  assertSafeAbsPath('archivePath', archivePath);
  if (!archivePath.endsWith('.tar.gz')) {
    throw new Error(`[warehouse-backup] archivePath 必须以 .tar.gz 结尾，当前：${archivePath}`);
  }

  return [
    'set -eu',
    `ARCHIVE='${archivePath}'`,
    `MANIFEST='${archivePath}.manifest'`,
    DETECT_SHA,
    'if [ ! -f "$ARCHIVE" ]; then echo "[warehouse-verify] 归档不存在：$ARCHIVE"; exit 3; fi',
    'if [ ! -f "$MANIFEST" ]; then echo "[warehouse-verify] 校验清单不存在：$MANIFEST"; exit 3; fi',
    'TMP=$(mktemp -d); trap \'rm -rf "$TMP"\' EXIT',
    'tar -xzf "$ARCHIVE" -C "$TMP"',
    // 方向一：清单里的每个文件都必须存在且哈希一致
    'if ! OUT=$(cd "$TMP" && $SHA -c "$MANIFEST" 2>&1); then',
    '  echo "[warehouse-verify] ❌ 校验失败（内容被改或文件缺失）："',
    '  printf \'%s\\n\' "$OUT" | grep -v ": OK$" | head -20',
    '  exit 4',
    'fi',
    // 方向二：还原产物不得多出清单之外的文件
    'EXPECT=$(wc -l < "$MANIFEST" | tr -d " ")',
    'GOT=$(find "$TMP" -type f | wc -l | tr -d " ")',
    'if [ "$EXPECT" -ne "$GOT" ]; then',
    '  echo "[warehouse-verify] ❌ 文件数不一致：清单 $EXPECT vs 还原 $GOT"; exit 4',
    'fi',
    'echo "[warehouse-verify] ✅ 还原对账通过：$GOT 个文件哈希全部一致"',
  ].join('\n');
}

/** 北京时区日期戳 YYYYMMDD（业务时区 UTC+8，禁用本机裸 date） */
export function beijingDateStamp(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
    .format(now)
    .replaceAll('-', '');
}
