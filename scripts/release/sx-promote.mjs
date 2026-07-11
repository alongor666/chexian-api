#!/usr/bin/env node
/**
 * SX Premium 晋升脚本 — validation/SX → current/SX/ (分省子目录布局 · B5 cutover SOP §2-2)
 *
 * 布局沿革：#753/Option A 曾用「current/ 顶层 SX_ 前缀扁平文件」过渡；owner 2026-07-04 拍板
 * 分省子目录终局（current/SC/ + current/SX/），B5 cutover（2026-07-06 授权）起本脚本目标改为
 * 「current/SX/ 下裸名文件」（不再加 SX_ 前缀——省份由子目录承载，与装载层 discoverInDir /
 * sync-vps buildPolicyCurrentTasks 的 `current/<省>/` 语义对齐）。
 *
 * ⚠️  部署顺序互锁（architect 闸 P1-2）：本子目录化改造与 sync-vps 多省白名单（SOP §2-1）
 *   **同一 PR 同批合并**——若白名单先开而 promote 仍写顶层扁平前缀文件，等于给「倒灌顶层扁平」
 *   开推送通道，会触发装载层扁平/子目录并存互斥闸拒启。
 *
 * ⚠️  诚实边界：本脚本是 cutover SOP 序列里的「一步」，**不负责**：
 *   - 开启 BRANCH_RLS_ENABLED（服务端安全闸，须 operator 独立核实后手动切换，或由自动化经
 *     真实查询核实——见下方「自动化接入」）
 *   - sync-vps（同步到 VPS 须另跑 `node scripts/sync-vps.mjs --dry-run` 先验）
 *   - 发放山西账号
 *
 * 自动化接入（2026-07-09 起，修复「晋升从未自动化 → SX 生产数据连续多日滞后 2 天且零告警」缺口）：
 *   `scripts/sync-vps.mjs` 的 `runSxAutoPromote()` 在每次 `node scripts/sync-vps.mjs` 运行时，
 *   若检测到本地存在 `validation/SX/` 目录，会先 SSH 到生产 VPS 真实查询
 *   `GET /internal/data-fingerprint` 的 `security.branchRlsEnabled`（服务端运行时取值，
 *   不是本地静态声明），确认为 `true` 后才代为调用：
 *     `node scripts/release/sx-promote.mjs --apply --auto-verified-rls --rls-verification-note "<核实详情>"`
 *   查询失败（网络/端点异常）或明确查到 `false` → **拒绝晋升**，`sync-vps.mjs` 以非零退出码
 *   响亮失败（不静默跳过、不用陈旧 SX 数据继续同步）；细节见该函数与
 *   `数据管理/lib/sx-promote-gate.mjs` 的 `evaluateSxAutoPromoteReadiness()`（纯函数，单测覆盖
 *   promote/block/skip 三态）。`--rls-confirmed`（人工声明）路径完全不变，仍可独立手动调用。
 *
 * ⚠️  崩溃原子性声明（请勿在此处声称"atomic"）：
 *   本脚本的 Phase E（staging → final 批量 rename）**非跨进程崩溃原子**。
 *   rename 是逐文件串行的，进程被 kill 会留下部分 final 已完成 + 部分 staging 仍存在的中间态。
 *
 *   安全靠三层叠加缓解（不声称完全消除）：
 *     ① Day-1 SOP 串行纪律：operator 必须确认本脚本 exit 0 且 .sx-promote-ready
 *        文件存在后，**才**运行 sync-vps.mjs（禁并发）
 *     ② 幂等重跑：sha256 一致自动 skip；残余 staging 由下次运行重新处理
 *     ③ leftover preflight：残留 .staging/.bak_* 默认拦截 --apply（第 4 条）
 *
 *   彻底的崩溃原子（无中间态）需子目录单次 swap 或 sync/bootstrap 共守
 *   文件系统级 lock，超出本脚本范围，已登记为 follow-up。
 *
 * 调用时机：BRANCH_RLS_ENABLED=true 已在服务端核实生效（人工用 --rls-confirmed 声明，或由
 * scripts/sync-vps.mjs 自动化经真实查询核实后传 --auto-verified-rls，见上方「自动化接入」）、
 * SX parquet 在 validation/ 通过 ETL 质量校验、**且本地 current/ 已完成子目录布局迁移**
 * （cutover SOP T-1；布局中间态守卫会拦截扁平未迁移场景）后触发——2026-07-09 起日常发布默认
 * 走自动化路径；operator 手动触发（--rls-confirmed）仍保留，用于应急/首次 cutover/调试。
 *
 * 硬化要点（双闸 P0/P1/P0-2 缓解）：
 *   P0-1. 源省份 fail-fast：每文件 duckdb CLI 查 branch_code='SX' 全行一致，任一不满足 exit 1
 *   P0-2. staging 先校后 rename：复制到 .staging 扩展名 → 完整校验 → 批量 rename → 无竞态窗口
 *   P0-3. --force 回滚护栏：覆盖前先 backup 旧文件 → 失败时恢复；生产模式默认禁止覆盖已存在文件
 *         backup 阶段事务化：任何 renameSync 失败立即按 backupMap 恢复已挪走文件（P1 第2轮）
 *         跨设备 rename 预检：backup 与 dst 须在同一设备（rename 跨设备=EXDEV），否则 exit 1（P1 第2轮）
 *   P0-2a. leftover preflight（P0-2 缓解）：--apply 启动时扫描目标目录残留 .staging/.bak_*，
 *         默认 exit 1 提示人工核对；--resume 跳过（由 operator 显式声明可安全幂等恢复）
 *   P0-2b. ready-marker（P0-2 缓解）：Phase E 全部 rename 成功后写 .sx-promote-ready（含 run-id +
 *         manifest 摘要）；operator 须确认该文件存在后才运行 sync-vps（SOP 纪律，非代码强制）
 *   P1-4. 保费字段改 premium + 缺失 fail-fast（不再降级仅校行数）
 *   P1-5. duckdb CLI 替换 Python，任何文件复制前先 preflight 校验 duckdb 可用
 *   P1-6. 空源 --apply 失败（除非 --allow-empty）
 *   P1-7. 目标已存在时比较 sha256 字节一致；不一致时回退数据级双向 EXCEPT 复核
 *         （parquetDataIdentical）：数据相同（parquet 非确定性序列化差异）→ 幂等 skip，
 *         数据确不同 → fail-fast（--force 才覆盖）
 *   P1-8. sha256 流式计算（createReadStream + hash.update）防大 parquet 整文件进内存（P1 第2轮）
 *   P2-9. assertSxSubdirTarget 在 mkdirSync 之前调用（B5 语义反转：原 assertNoSubdirIntent 防子目录，
 *         现要求目标**必须是** current/SX 省份子目录）
 *   P2-10. --apply 必须携带 --rls-confirmed（operator 声明已核实生产 RLS-on）
 *   B5-11. 布局中间态守卫 assertParentLayoutReady：目标父目录（current/）顶层仍有扁平 parquet
 *         （= cutover T-1 布局迁移未完成）→ --apply 拒绝执行——否则写出 current/SX/ 会造成
 *         「扁平+子目录并存」，装载层互斥闸拒启（本 PR 合并后、cutover 完成前的窗口期事故防线）
 *
 * 文件命名（分省子目录布局，B5 起）：
 *   SX premium ETL 产物形如 `每日数据_<start>_<end>.parquet`，落在 warehouse/validation/SX/
 *   promote 后目标：current/SX/ 下**同名裸名文件**（省份由子目录承载，不再加 SX_ 前缀）。
 *   与装载层 discoverInDir Pass2（`^[A-Z]{2}$` 子目录 → branch=目录名）及 sync-vps
 *   buildPolicyCurrentTasks（`current/<省>/` 每省独立任务）语义对齐；SC 数据在 current/SC/，物理隔离。
 *
 * staging 命名规范：
 *   `.staging` 扩展而非 `.parquet`，确保：
 *   - data-bootstrapper.ts `name.endsWith('.parquet')` 不加载 staging 文件
 *   - sync-vps `*.parquet` glob 不同步 staging 文件
 *   - 两层双保险，staging 期间服务端零风险（staging/backup 路径均随目标一起落在 current/SX/ 内）
 *
 * 互斥安全：data-bootstrapper.ts 的 GATED fail-closed 检测「扁平顶层 parquet 与省份子目录 parquet
 *   并存」。B5 起本脚本写子目录，与该闸的关系从「不建子目录」反转为「只建子目录 + 靠
 *   assertParentLayoutReady 保证顶层已清空」——两侧共同保证不出现并存态。
 *
 * --force 策略（两选一，已选 Option B）：
 *   Option A：--force 带 backup/restore，适合需要覆盖已存在 SX 文件的场景
 *   Option B（本实现）：生产模式禁止覆盖已存在文件，目标须为空（或通过 sha256 验证内容一致则 skip）；
 *             --force 仅用于测试/本地，带 backup→全通过→删 backup，任一失败→恢复 backup。
 *   理由：生产 cutover 场景目标通常是空的；--force 是异常路径，应带 backup/restore 保障。
 *
 * 用法：
 *   node scripts/release/sx-promote.mjs              # 默认 dry-run：打印计划，不写文件
 *   node scripts/release/sx-promote.mjs --apply --rls-confirmed           # 真实复制 + 校验 + 失败自动回滚
 *   node scripts/release/sx-promote.mjs --apply --rls-confirmed --force   # 允许覆盖已存在的 SX_ 文件（测试用）
 *   node scripts/release/sx-promote.mjs --apply --rls-confirmed --allow-empty  # 允许源目录为空
 *   node scripts/release/sx-promote.mjs --apply --rls-confirmed --resume  # 跳过 leftover preflight（幂等恢复）
 *   node scripts/release/sx-promote.mjs --target-dir /tmp/test-current/SX      # 指定目标目录（测试用，末段必须是 SX）
 *   node scripts/release/sx-promote.mjs --source-dir /custom/path              # 覆盖源目录（测试/测试用，需 --unsafe-source-dir）
 *   node scripts/release/sx-promote.mjs --source-dir /custom --unsafe-source-dir  # 非默认源目录（测试用，打 ERROR 警告）
 *   node scripts/release/sx-promote.mjs --run-id 20260623T120000  # 指定 run-id 用于 backup 命名
 *   node scripts/release/sx-promote.mjs --apply --auto-verified-rls --rls-verification-note "..."
 *     # 自动化专用（由 scripts/sync-vps.mjs 代为调用，operator 不应手动传此组合——见「自动化接入」）
 *
 * 退出码：
 *   0 — 成功（dry-run 打印完毕 / apply 校验全通过）
 *   1 — 失败（源文件不存在 / 省份不匹配 / 目标冲突 / 校验不一致 → 已自动回滚）
 *
 * 相关：
 *   数据管理/lib/branch-naming.mjs       — SX 输出根逻辑（branchOutputRoot）
 *   scripts/sync-vps.mjs               — buildPolicyCurrentTasks / SYNC_ALLOWED_BRANCHES（current/<省>/ 任务）
 *   server/src/services/data-bootstrapper.ts — 互斥闸（GATED fail-closed）+ discoverInDir 子目录枚举
 *   开发文档/multi-branch/子目录布局cutover_SOP_2026-07-06.md — §2-2 本改造的授权与顺序互锁
 *   scripts/prepublish-gate/lib/fetch-local-metrics.mjs — duckdb CLI 用法参照
 */

import {
  existsSync, mkdirSync, readdirSync, statSync,
  copyFileSync, renameSync, unlinkSync, writeFileSync,
  createReadStream,
} from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { beijingDayOf } from '../../数据管理/lib/bi-export-pull.mjs';

// ─────────────────────────── 路径常量 ───────────────────────────

const __filename = fileURLToPath(import.meta.url);
// scripts/release/sx-promote.mjs → 项目根
const PROJECT_ROOT = resolve(__filename, '../../..');

const WAREHOUSE_ROOT = join(PROJECT_ROOT, '数据管理', 'warehouse');
const DEFAULT_SOURCE_DIR = join(WAREHOUSE_ROOT, 'validation', 'SX');
// B5 子目录布局：晋升目标 = current/SX/（裸名文件，省份由子目录承载）
const DEFAULT_TARGET_DIR = join(WAREHOUSE_ROOT, 'fact', 'policy', 'current', 'SX');

// 省码（子目录名）；SX_ 前缀仅用于识别旧 #753 扁平前缀产物（防呆），不再用于目标命名
const BRANCH_PREFIX = 'SX';
const BRANCH_PAT = `${BRANCH_PREFIX}_`;

// ─────────────────────────── 参数解析 ───────────────────────────

const argv = process.argv.slice(2);
const args = {
  apply: false,
  force: false,
  allowEmpty: false,
  rlsConfirmed: false,
  autoVerifiedRls: false,       // 自动化专用：由调用方（sync-vps.mjs）在真实查询生产 RLS 状态通过后传入
  rlsVerificationNote: null,    // 配合 --auto-verified-rls：核实方式说明，落盘进 manifest 供审计追溯
  unsafeSourceDir: false,
  resume: false,  // 跳过 leftover preflight，由 operator 显式声明可安全幂等恢复
  sourceDir: null,
  targetDir: null,
  runId: null,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eat = () => argv[++i];
  if (a === '--apply') args.apply = true;
  else if (a === '--force') args.force = true;
  else if (a === '--allow-empty') args.allowEmpty = true;
  else if (a === '--rls-confirmed') args.rlsConfirmed = true;
  else if (a === '--auto-verified-rls') args.autoVerifiedRls = true;
  else if (a === '--rls-verification-note') args.rlsVerificationNote = eat();
  else if (a === '--unsafe-source-dir') args.unsafeSourceDir = true;
  else if (a === '--resume') args.resume = true;
  else if (a === '--source-dir') args.sourceDir = resolve(eat());
  else if (a === '--target-dir') args.targetDir = resolve(eat());
  else if (a === '--run-id') args.runId = eat();
  else if (a === '--help' || a === '-h') {
    console.log('见文件头注释。用法：node scripts/release/sx-promote.mjs [--apply] [--rls-confirmed | --auto-verified-rls --rls-verification-note "<说明>"] [--force] [--allow-empty] [--target-dir <dir>] [--source-dir <dir> --unsafe-source-dir] [--run-id <id>]');
    process.exit(0);
  } else {
    console.error(`❌ 未知参数: ${a}（见 --help）`);
    process.exit(1);
  }
}

// --run-id 用于 backup 文件名；若未传则用 process.hrtime 生成一个（避免 Date.now()）
const RUN_ID = args.runId ?? `run_${process.hrtime.bigint()}`;

const sourceDir = args.sourceDir || DEFAULT_SOURCE_DIR;
const targetDir = args.targetDir || DEFAULT_TARGET_DIR;

// ─────────────────────────── 日志工具 ───────────────────────────

function log(level, msg) {
  const PREFIX = { info: 'ℹ', ok: '✅', warn: '⚠️ ', error: '❌', plan: '📋', dryrun: '🔍' };
  console.log(`${PREFIX[level] ?? level}  ${msg}`);
}

// ─────────────────────────── sha256 工具 ───────────────────────────

/**
 * 流式计算文件的 sha256 hex 摘要（P1-8 第2轮硬化）。
 * 使用 createReadStream + hash.update 逐块处理，防止大 parquet 整文件进内存导致 OOM/中途崩。
 * promote 是逐字节复制（copyFileSync），dest sha256 == source sha256 是完美证明。
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(new Error(`sha256File 读取失败 "${filePath}": ${err.message}`)));
  });
}

// ─────────────────────────── duckdb CLI 工具 ───────────────────────────

/**
 * duckdb CLI preflight：检查 duckdb 命令可用。
 * 不可用 → 立即 exit 1，不进入任何文件复制。
 * 参照 scripts/prepublish-gate/lib/fetch-local-metrics.mjs 用法。
 */
export function duckdbPreflight() {
  const result = spawnSync('duckdb', ['--version'], { encoding: 'utf-8', windowsHide: true });
  if (result.error || result.status !== 0) {
    log('error', `duckdb CLI 不可用（preflight 失败）：${result.error?.message ?? result.stderr}`);
    log('error', `  请先安装 duckdb CLI：brew install duckdb`);
    process.exit(1);
  }
  log('info', `duckdb CLI 可用：${(result.stdout || result.stderr || '').trim()}`);
}

/**
 * 执行 duckdb CLI SQL，返回 JSON 行数组（-json 模式）。
 * @param {string} sql
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export function runDuckdbCli(sql, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('duckdb', ['-json', '-c', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`duckdb 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`duckdb 启动失败：${err.message}（确认 duckdb 在 PATH）`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`duckdb 退出码 ${code}\nstderr: ${stderr.trim()}\nsql: ${sql.slice(0, 400)}`));
      }
      try {
        const trimmed = stdout.trim();
        resolve(trimmed.length === 0 ? [] : JSON.parse(trimmed));
      } catch (e) {
        reject(new Error(`duckdb 输出非 JSON：${e.message}\nstdout 前 400: ${stdout.slice(0, 400)}`));
      }
    });
  });
}

/**
 * 校验单个 parquet 文件的省份完整性（P0-1 源省份 fail-fast）：
 *   1. branch_code 列必须存在
 *   2. COUNT(*) == COUNT(*) FILTER (WHERE branch_code='SX')（全部行均为 SX）
 * 任一不满足 → 抛错，调用方 exit 1。
 *
 * @param {string} parquetPath  单个 parquet 文件路径（源文件或 staging 文件均可）
 * @param {{ runDuckdb?: Function }} [opts]  注入式，便于单测
 * @returns {Promise<{ rowCount: number, premiumSum: number }>}
 */
export async function validateBranchCodeSX(parquetPath, { runDuckdb = runDuckdbCli } = {}) {
  // 转义路径中的单引号
  const safePathForQuote = parquetPath.replace(/'/g, "''");

  // Step 1：检查 branch_code 列是否存在
  const schemaRows = await runDuckdb(
    `SELECT column_name FROM information_schema.columns WHERE table_name='main' ` +
    `UNION ALL ` +
    `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${safePathForQuote}') LIMIT 0)`,
    { timeoutMs: 30_000 },
  ).catch(async () => {
    // 回退：用 DESCRIBE 方式
    return runDuckdb(
      `DESCRIBE SELECT * FROM read_parquet('${safePathForQuote}') LIMIT 0`,
      { timeoutMs: 30_000 },
    );
  });

  // 实际用 DESCRIBE 检查 branch_code
  const descRows = await runDuckdb(
    `DESCRIBE SELECT * FROM read_parquet('${safePathForQuote}') LIMIT 0`,
    { timeoutMs: 30_000 },
  );
  const colNames = descRows.map((r) => (r.column_name ?? r['column name'] ?? '').toLowerCase());
  if (!colNames.includes('branch_code')) {
    throw new Error(
      `[sx-promote] 源省份校验失败：文件 "${basename(parquetPath)}" 缺少 branch_code 列。` +
      `（发现列：${colNames.slice(0, 10).join(', ')}）`
    );
  }

  // Step 2：检查 premium 字段存在
  if (!colNames.includes('premium')) {
    throw new Error(
      `[sx-promote] 保费字段校验失败：文件 "${basename(parquetPath)}" 缺少 premium 列（项目标准保费字段）。` +
      `（发现列：${colNames.slice(0, 10).join(', ')}）`
    );
  }

  // Step 3：COUNT(*) == COUNT(*) FILTER (WHERE branch_code='SX')
  const statsRows = await runDuckdb(
    `SELECT COUNT(*) AS total, ` +
    `COUNT(*) FILTER (WHERE branch_code='${BRANCH_PREFIX}') AS sx_count, ` +
    `SUM(premium) AS premium_sum ` +
    `FROM read_parquet('${safePathForQuote}')`,
    { timeoutMs: 120_000 },
  );

  if (!statsRows || statsRows.length === 0) {
    throw new Error(`[sx-promote] duckdb 统计查询返回空结果：${parquetPath}`);
  }

  const { total, sx_count, premium_sum } = statsRows[0];
  const totalNum = Number(total);
  const sxCountNum = Number(sx_count);

  if (totalNum !== sxCountNum) {
    throw new Error(
      `[sx-promote] 源省份校验失败：文件 "${basename(parquetPath)}" 含非 SX 行。` +
      `总行数=${totalNum}，branch_code='SX' 行数=${sxCountNum}，` +
      `非 SX 行数=${totalNum - sxCountNum}。拒绝 promote，防止混省串读。`
    );
  }

  return {
    rowCount: totalNum,
    premiumSum: premium_sum !== null && premium_sum !== undefined ? Number(premium_sum) : null,
  };
}

/**
 * 数据级等价复核（P1-7 sha256 冲突的回退闸）。
 *
 * 背景：parquet 非确定性序列化（行组顺序 / 压缩块 / 元数据时间戳）会让**同一份数据**
 * 两次写出产生不同 sha256，令 P1-7 的 sha256 硬比对把"数据完全相同"误判为"内容冲突"
 * 而拒绝晋升。本函数在 sha256 不一致时做数据级复核：行数相同 **且** 双向 EXCEPT 差集
 * 均为 0 → 判定两文件数据等价（可安全视为幂等 skip，无需 --force 覆盖）。
 *
 * 只在 sha256 已不一致的罕见分支调用；正常路径（sha256 一致）不触发本查询，零额外开销。
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ runDuckdb?: Function }} [opts]  注入式，便于单测
 * @returns {Promise<boolean>}  true = 两文件数据完全相同（行序 / 序列化差异无关）
 */
export async function parquetDataIdentical(pathA, pathB, { runDuckdb = runDuckdbCli } = {}) {
  const a = pathA.replace(/'/g, "''");
  const b = pathB.replace(/'/g, "''");

  // 先比行数：快速短路（行数不同必不等，省去昂贵的 EXCEPT）
  const countRows = await runDuckdb(
    `SELECT (SELECT COUNT(*) FROM read_parquet('${a}')) AS a_rows, ` +
    `(SELECT COUNT(*) FROM read_parquet('${b}')) AS b_rows`,
    { timeoutMs: 60_000 },
  );
  if (!countRows || countRows.length === 0) return false;
  if (Number(countRows[0].a_rows) !== Number(countRows[0].b_rows)) return false;

  // 双向 EXCEPT 差集：均为 0 → 两侧互为子集 → 数据完全相同（与行序 / 序列化无关）
  const diffRows = await runDuckdb(
    `SELECT ` +
    `(SELECT COUNT(*) FROM (SELECT * FROM read_parquet('${a}') EXCEPT SELECT * FROM read_parquet('${b}'))) AS a_minus_b, ` +
    `(SELECT COUNT(*) FROM (SELECT * FROM read_parquet('${b}') EXCEPT SELECT * FROM read_parquet('${a}'))) AS b_minus_a`,
    { timeoutMs: 120_000 },
  );
  if (!diffRows || diffRows.length === 0) return false;
  return Number(diffRows[0].a_minus_b) === 0 && Number(diffRows[0].b_minus_a) === 0;
}

// ─────────────────────────── 安全护栏 ───────────────────────────

/**
 * 省份子目录目标护栏（B5 语义反转，原 assertNoSubdirIntent）：
 * 目标路径末段**必须是** SX 省份子目录（分省子目录布局，如 .../current/SX）。
 * 反转原因：#753/Option A 时代目标是 current/ 顶层扁平前缀文件，防误建子目录；
 * B5 cutover 起子目录是终局布局，反过来要求目标就是 current/SX——防止误传 current/ 根
 * 又写出顶层扁平文件（会与 current/SC/ 并存 → 装载层互斥闸拒启）。
 * 必须在 mkdirSync 之前调用（P2-9）。
 * @param {string} targetRoot
 */
export function assertSxSubdirTarget(targetRoot) {
  const dirName = basename(targetRoot);
  if (dirName !== BRANCH_PREFIX) {
    throw new Error(
      `[sx-promote] --target-dir "${targetRoot}" 末段是「${dirName}」，不是 SX 省份子目录。` +
      `B5 分省子目录布局下晋升目标必须是 current/${BRANCH_PREFIX}/（裸名文件，省份由子目录承载）。` +
      `写 current/ 根会重新制造顶层扁平文件 → 与 current/SC/ 并存 → 装载层互斥闸拒启。`
    );
  }
}

/**
 * 布局中间态守卫（B5-11，新增）：目标父目录（current/）顶层不得残留扁平 parquet。
 *
 * 窗口期风险：本子目录化 PR 合并后、cutover T-1 布局迁移完成前，current/ 仍是扁平混放
 * （SC 裸名 + 旧 SX_ 前缀）。此时若跑 promote 写出 current/SX/，会形成「扁平+子目录并存」——
 * 装载层 enforceProvinceSubdirGate 与 sync GATED 预检都会 fail-closed，服务拒启。
 * 本守卫把事故从「装载层拒启（事后）」提前到「promote 拒绝执行（事前）」。
 *
 * 判定：父目录不存在 / 为空 / 仅子目录（已完成迁移）→ 放行；顶层存在任何 *.parquet → 拒绝。
 * @param {string} targetRoot 目标目录（current/SX）
 */
export function assertParentLayoutReady(targetRoot) {
  const parentDir = dirname(targetRoot);
  if (!existsSync(parentDir)) return; // 父目录不存在（全新环境/测试 tmpdir）→ mkdirSync 会一并创建
  let entries;
  try {
    entries = readdirSync(parentDir);
  } catch {
    return; // 读取失败不在此拦（权限问题由后续 mkdirSync/复制流程暴露）
  }
  const flatParquets = entries.filter((f) => f.endsWith('.parquet'));
  if (flatParquets.length > 0) {
    throw new Error(
      `[sx-promote] 布局中间态守卫：目标父目录 ${parentDir} 顶层仍有 ${flatParquets.length} 个扁平 parquet` +
      `（如 ${flatParquets.slice(0, 3).join('、')}）——current/ 尚未完成分省子目录布局迁移（cutover SOP T-1）。` +
      `此时写 current/${BRANCH_PREFIX}/ 会造成「扁平+子目录并存」，装载层互斥闸将拒绝启动。` +
      `请先按 cutover SOP 完成 T-1 布局迁移（顶层 parquet 全部归入 SC/、SX/ 子目录）后再晋升。`
    );
  }
}

/**
 * P0-2a leftover preflight：--apply 启动时扫描目标目录中本工具遗留的 .staging 和 .bak_* 残留。
 * 若发现残留（疑似上次被 kill）→ exit 1，打印残留文件清单，提示人工核对/清理后重试。
 * 传入 resume=true 时跳过（operator 显式声明可安全幂等恢复）。
 *
 * @param {string} targetDir
 * @param {{ resume?: boolean }} [opts]
 */
export function leftoverPreflight(targetDir, { resume = false } = {}) {
  if (resume) {
    log('warn', `[leftover-preflight] --resume 已声明，跳过残留检查（operator 确认可幂等恢复）`);
    return;
  }
  if (!existsSync(targetDir)) return; // 目标目录不存在 → 无残留

  let entries;
  try {
    entries = readdirSync(targetDir);
  } catch {
    return; // 读取失败不阻断（目标目录权限问题在后续 mkdirSync 处理）
  }

  const stagingFiles = entries.filter(f => f.endsWith('.staging'));
  const bakFiles = entries.filter(f => f.includes('.bak_'));

  const leftovers = [...stagingFiles, ...bakFiles];
  if (leftovers.length === 0) return;

  log('error', `[sx-promote] 检测到上次未完成 promote 的残留文件（疑似进程被 kill）:`);
  for (const f of leftovers) {
    log('error', `    ${join(targetDir, f)}`);
  }
  log('error', `请人工核对/清理后重试：`);
  log('error', `  - 若上次 promote 已部分完成，可传 --resume 跳过此检查（幂等重跑 sha256 一致自动 skip）`);
  log('error', `  - 若需清理残留：rm -f <上述文件路径>`);
  throw new Error(`[sx-promote] leftover preflight 失败：发现 ${leftovers.length} 个未清理残留`);
}

/**
 * --force 安全护栏（B5 子目录版）：只允许覆盖 **SX 子目录内**的文件，绝不允许覆盖
 * SX/ 之外（如 current/ 顶层 SC 裸名、current/SC/ 内）的文件。
 * 布局沿革：#753 时代按 `SX_` 文件名前缀判定；B5 起省份由子目录承载（目标文件是裸名），
 * 判定基准随之改为「所在目录末段 === 'SX'」。
 * @param {string} dstPath 目标文件完整路径
 */
export function assertForceOnlyInSxSubdir(dstPath) {
  if (basename(dirname(dstPath)) !== BRANCH_PREFIX) {
    throw new Error(
      `[sx-promote] --force 仅允许覆盖 current/${BRANCH_PREFIX}/ 子目录内的文件，拒绝覆盖: ${dstPath}。` +
      `此护栏防止误删 SC 或其他省数据。`
    );
  }
}

/**
 * P1-5 源目录安全护栏：--apply 时默认只允许源目录 = DEFAULT_SOURCE_DIR。
 * 若传了 --source-dir 须同时传 --unsafe-source-dir，且打 ERROR 级警告。
 */
export function assertSourceDirSafety({ sourceDir, defaultSourceDir, unsafeSourceDir, apply }) {
  if (!apply) return; // dry-run 不强制
  const resolvedSource = resolve(sourceDir);
  const resolvedDefault = resolve(defaultSourceDir);
  if (resolvedSource !== resolvedDefault) {
    if (!unsafeSourceDir) {
      throw new Error(
        `[sx-promote] --apply 模式下，源目录必须是默认 SX 验证目录：\n` +
        `  默认：${resolvedDefault}\n` +
        `  传入：${resolvedSource}\n` +
        `自定义源目录须同时传 --unsafe-source-dir 旗标（仅测试用）。`
      );
    }
    // 打 ERROR 级警告但不 exit（已显式声明 unsafe）
    log('error', `⚠️  WARNING：使用非默认源目录（--unsafe-source-dir 已声明，仅测试用）：${resolvedSource}`);
  }
}

/**
 * P0-3 backup EXDEV 预检：验证 dst 与 bak 路径在同一设备（同一文件系统）。
 * rename 跨设备（EXDEV）会失败，backup 前必须确认。
 * 简单实现：比较 dst 所在目录与 bakDir（= targetDir）的 st_dev。
 *
 * @param {string} dstPath  目标文件路径（用于取所在目录的 device）
 * @param {string} bakDir   backup 文件存放目录（通常 = targetDir）
 */
export function assertSameDevice(dstPath, bakDir) {
  try {
    const dstDev = statSync(dirname(dstPath)).dev;
    // bakDir 可能尚未存在（第一次 promote），取其最近存在的祖先
    let bakCheck = bakDir;
    while (!existsSync(bakCheck)) {
      const parent = dirname(bakCheck);
      if (parent === bakCheck) break; // 到达根目录
      bakCheck = parent;
    }
    const bakDev = statSync(bakCheck).dev;
    if (dstDev !== bakDev) {
      throw new Error(
        `[sx-promote] backup 路径与目标路径跨设备（EXDEV），rename 会失败。` +
        `  目标目录 device=${dstDev}，backup 目录 device=${bakDev}。` +
        `  请确保 backup 与 target 在同一文件系统。`
      );
    }
  } catch (e) {
    if (e.message.includes('[sx-promote]')) throw e;
    // stat 本身失败（目录不存在等）→ 非跨设备错误，忽略（后续流程处理）
  }
}

/**
 * P0-2b ready-marker：Phase E 全部 rename 成功后写 .sx-promote-ready 标记文件。
 * 含 run-id + manifest 摘要，operator 须确认此文件存在后才运行 sync-vps（SOP 纪律）。
 *
 * ⚠️  ready-marker 是 best-effort（写入失败仅 warn，不阻断 exit 0）。
 *     原子性不比 Phase E 更强（same OS，同步写，但仍非事务性保证）。
 *
 * @param {object} manifest
 * @param {string} targetDir
 */
export function writeReadyMarker(manifest, targetDir) {
  const markerPath = join(targetDir, '.sx-promote-ready');
  const markerContent = {
    runId: manifest.runId,
    promotedAt: manifest.promotedAt,
    totalPromoted: manifest.summary?.totalPromoted ?? 0,
    totalSkipped: manifest.summary?.totalSkipped ?? 0,
    totalRows: manifest.summary?.totalRows ?? 0,
    files: (manifest.files ?? []).map(f => ({ name: f.dstName, status: f.status, sha256: f.sha256?.slice(0, 16) })),
    note: 'Phase E 全部 rename 成功。operator 确认此文件存在后才运行 sync-vps（SOP 纪律）。',
  };
  try {
    writeFileSync(markerPath, JSON.stringify(markerContent, null, 2), 'utf-8');
    log('ok', `ready-marker 已写入: ${markerPath}`);
    log('info', `  operator SOP：确认此文件存在后才运行 sync-vps`);
  } catch (e) {
    log('warn', `ready-marker 写入失败（非阻断，可手动补写）: ${e.message}`);
  }
}

// ─────────────────────────── 文件发现 ───────────────────────────

/**
 * 扫描 sourceDir，收集所有 *.parquet 文件。
 * SX ETL 产出格式：`每日数据_<start>_<end>.parquet`（与 SC current/ 同格式）。
 * 按文件名字典序排列，保证输出确定性。
 *
 * @returns {Array<{name: string, srcPath: string, dstName: string, dstPath: string, stagingPath: string}>}
 */
export function discoverSourceFiles({ sourceDir, targetDir }) {
  if (!existsSync(sourceDir)) {
    log('error', `源目录不存在: ${sourceDir}`);
    log('error', `  SX premium ETL 产物应落在 warehouse/validation/SX/`);
    log('error', `  请先运行: BRANCH_CODE=SX node 数据管理/daily.mjs premium`);
    process.exit(1);
  }

  const entries = readdirSync(sourceDir).filter(f => f.endsWith('.parquet')).sort();

  if (entries.length === 0) {
    return [];
  }

  return entries.map(name => {
    // 禁止：源文件带旧 #753 扁平前缀（疑似旧 promote 产物被误放回 validation/SX；
    // B5 裸名布局下若照搬会把带前缀文件名带进 current/SX/，命名污染且暗示源目录被污染）
    if (name.startsWith(BRANCH_PAT)) {
      throw new Error(
        `[sx-promote] 源文件 "${name}" 已带 ${BRANCH_PAT} 前缀，` +
        `疑似旧扁平前缀时代 promote 产物被误放回 validation/SX。请检查源目录。`
      );
    }
    const dstName = name;  // B5 子目录布局：current/SX/ 下裸名（省份由子目录承载，不加前缀）
    const dstPath = join(targetDir, dstName);
    // staging 路径：不以 .parquet 结尾，bootstrapper 和 sync-vps 均不会加载
    const stagingPath = `${dstPath}.staging`;
    return {
      name,
      srcPath: join(sourceDir, name),
      dstName,
      dstPath,
      stagingPath,
    };
  });
}

// ─────────────────── 被取代滚动分片归档（2026-07-11 根因修复） ───────────────────

/**
 * SX 滚动分片命名：每日数据_<start>_<end>.parquet（每天全量重刷，仅 <end> 前移）。
 * 晋升新分片后旧分片若残留，会与新分片时间范围重叠，被 sync-vps 的
 * assertNoPolicyCurrentOverlap 闸拦停整条发布链（2026-07-11 自动发布两次失败实证；
 * 此前 .archive/20260708~20260710 均为人工兜底归档）。
 */
const ROLLING_SHARD_RE = /^每日数据_(\d{8})_(\d{8})\.parquet$/;

/**
 * 找出 targetDir 顶层被取代的旧滚动分片：同 <start> 分组，仅保留 <end> 最大者，
 * 其余全部视为被取代。不同 <start> 的分片（如历史定稿分片）互不影响。
 *
 * @param {string} targetDir
 * @returns {string[]} 被取代的文件名（字典序）
 */
export function findSupersededRollingShards(targetDir) {
  const groups = new Map(); // start → [{ name, end }]
  for (const name of readdirSync(targetDir)) {
    const m = ROLLING_SHARD_RE.exec(name);
    if (!m) continue;
    const [, start, end] = m;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push({ name, end });
  }
  const superseded = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const maxEnd = list.reduce((mx, f) => (f.end > mx ? f.end : mx), '');
    for (const f of list) {
      if (f.end < maxEnd) superseded.push(f.name);
    }
  }
  return superseded.sort();
}

/**
 * 把被取代的旧滚动分片归档到 targetDir/.archive/<北京日YYYYMMDD>/（同日已存在则
 * 追加 -2、-3 后缀，与既有人工归档惯例一致）。归档 = rename 移动，可人工回滚。
 * .archive/ 是子目录，不被顶层 *.parquet glob（bootstrapper / sync-vps / overlap 闸）匹配。
 *
 * @param {string} targetDir
 * @param {{ beijingDay?: string }} [opts] beijingDay：YYYY-MM-DD（测试注入；默认取当前北京日）
 * @returns {{ archived: string[], archiveDir: string|null }}
 */
export function archiveSupersededRollingShards(targetDir, { beijingDay } = {}) {
  const superseded = findSupersededRollingShards(targetDir);
  if (superseded.length === 0) return { archived: [], archiveDir: null };

  const day = (beijingDay ?? beijingDayOf(new Date())).replaceAll('-', '');
  const base = join(targetDir, '.archive', day);
  let archiveDir = base;
  for (let i = 2; existsSync(archiveDir); i++) archiveDir = `${base}-${i}`;
  mkdirSync(archiveDir, { recursive: true });

  const archived = [];
  for (const name of superseded) {
    renameSync(join(targetDir, name), join(archiveDir, name));
    archived.push(name);
    log('ok', `  已归档被取代分片: ${name} → ${join('.archive', basename(archiveDir), name)}`);
  }
  return { archived, archiveDir };
}

// ─────────────────────────── 计划打印（dry-run） ───────────────────────────

/**
 * 打印 dry-run 计划（不写任何文件）。
 * @param {ReturnType<typeof discoverSourceFiles>} files
 */
async function printPlan(files) {
  log('dryrun', `【DRY-RUN 模式】不会写入任何文件。传 --apply --rls-confirmed 才真实复制。`);
  console.log('');
  log('plan', `源目录: ${sourceDir}`);
  log('plan', `目标目录: ${targetDir}`);
  console.log('');

  if (files.length === 0) {
    log('warn', '无可 promote 的 parquet 文件（源目录为空）。');
    return;
  }

  console.log(`  ${'源文件名'.padEnd(50)} → ${'目标文件名（current/SX/ 裸名）'}`);
  console.log('  ' + '─'.repeat(90));

  for (const f of files) {
    const srcStat = statSync(f.srcPath);
    const srcMB = (srcStat.size / 1024 / 1024).toFixed(1);
    const exists = existsSync(f.dstPath) ? ' [已存在]' : '';
    console.log(`  ${f.name.padEnd(50)} → ${f.dstName}  (${srcMB} MB)${exists}`);
  }

  console.log('');
  console.log(`  共 ${files.length} 个文件`);
  console.log('');
  log('plan', '预读源文件行数/保费（duckdb CLI 只读）...');

  let totalRows = 0;
  let totalPremium = 0;
  let premiumAvailable = true;

  for (const f of files) {
    try {
      const { rowCount, premiumSum } = await validateBranchCodeSX(f.srcPath);
      totalRows += rowCount;
      if (premiumSum !== null) {
        totalPremium += premiumSum;
      } else {
        premiumAvailable = false;
      }
      const pStr = premiumSum !== null
        ? `  保费合计: ${premiumSum.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
        : '';
      console.log(`    ${f.name}: ${rowCount.toLocaleString()} 行${pStr} [branch_code=SX ✅]`);
    } catch (e) {
      log('warn', `  ${f.name} 预读失败（dry-run 非阻断）: ${e.message}`);
      premiumAvailable = false;
    }
  }

  console.log('');
  log('plan', `总计: ${totalRows.toLocaleString()} 行${premiumAvailable ? `，保费合计 ${totalPremium.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '（保费字段不可用）'}`);
  log('info', `promote 后落点: current/SX/ 下裸名文件（与装载层 discoverInDir Pass2 / sync-vps current/<省>/ 任务对齐）`);
  log('info', `bootstrap 兼容性: 省份子目录文件，branch='SX'；前提 = current/ 顶层已无扁平 parquet（布局守卫把关）`);
  console.log('');
  log('dryrun', `确认无误后，运行：node scripts/release/sx-promote.mjs --apply --rls-confirmed`);
}

// ─────────────────────────── 主 promote 逻辑 ───────────────────────────

/**
 * 执行实际 promote（P0-2 staging 先校后 rename 架构）：
 *   Phase A：对所有源文件并行校验（branch_code=SX + premium 字段存在）
 *   Phase B：复制到 staging（.staging 扩展，bootstrapper/sync-vps 均不加载）
 *   Phase C：对所有 staging 文件校验（sha256 + branch_code + premium）
 *   Phase D：全部通过 → 短窗口批量 rename staging→final；任一失败 → 回滚
 * @param {ReturnType<typeof discoverSourceFiles>} files
 */
/**
 * 归档被取代滚动分片；失败即写 manifest 并退出（残留重叠分片必然被下游
 * overlap 闸拦停，晚失败不如此处响亮失败）。已晋升的文件不回滚（数据本身正确）。
 *
 * @param {object} manifest
 * @param {string} failStatus 失败时写入 manifest.summary.status 的标签
 * @returns {{ archived: string[], archiveDir: string|null }}
 */
function runSupersededArchiveOrDie(manifest, failStatus) {
  try {
    return archiveSupersededRollingShards(targetDir);
  } catch (e) {
    log('error', `被取代分片归档失败：${e.message}`);
    log('error', `  残留的重叠分片会被 sync-vps 的 overlap 闸拦停发布，请人工归档后重试：`);
    log('error', `  mv "${targetDir}/每日数据_<旧end>.parquet" "${targetDir}/.archive/<北京日YYYYMMDD>/"`);
    manifest.summary = { status: failStatus, error: e.message };
    writeManifest(manifest);
    process.exit(1);
  }
}

export async function applyPromote(files) {
  log('info', `【APPLY 模式】正式 promote：${files.length} 个文件`);
  log('info', `  源: ${sourceDir}`);
  log('info', `  目标: ${targetDir}`);
  console.log('');

  // P2-9: assertSxSubdirTarget 在 mkdirSync 之前（B5 语义反转）+ B5-11 布局中间态守卫
  assertSxSubdirTarget(targetDir);
  assertParentLayoutReady(targetDir);

  // 确保目标目录存在
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    log('info', `已创建目标目录: ${targetDir}`);
  }

  const manifest = {
    promotedAt: new Date().toISOString(),
    runId: RUN_ID,
    sourceDir,
    targetDir,
    // 审计追溯：这次 promote 的 RLS 安全闸是人工声明还是自动化真实核实（+ 核实方式说明）。
    rlsVerification: args.rlsConfirmed
      ? { source: 'manual', note: 'operator 手动声明 --rls-confirmed' }
      : { source: 'automated', note: args.rlsVerificationNote },
    files: [],
    summary: null,
  };

  // ─── Phase A：源文件校验（branch_code 全 SX + premium 字段存在） ───
  log('info', '─── Phase A：源文件校验（省份完整性 + 保费字段）───');
  const srcStats = new Map(); // name → { rowCount, premiumSum }
  const srcHash = new Map();  // name → sha256
  for (const f of files) {
    log('info', `  校验源文件: ${f.name}`);
    try {
      const stats = await validateBranchCodeSX(f.srcPath);
      srcStats.set(f.name, stats);
      const hash = await sha256File(f.srcPath);
      srcHash.set(f.name, hash);
      log('ok', `    branch_code=SX 全行一致 ✅  行数=${stats.rowCount.toLocaleString()}  sha256=${hash.slice(0, 16)}...`);
    } catch (e) {
      log('error', `  Phase A 失败：${e.message}`);
      log('error', `  任何文件校验失败均终止 promote（防混省）`);
      manifest.summary = { status: 'PHASE_A_FAILED', error: e.message };
      writeManifest(manifest);
      process.exit(1);
    }
  }
  log('ok', `Phase A 通过：${files.length} 个文件均 branch_code=SX`);
  console.log('');

  // ─── 目标冲突检查（P1-7 sha256 一致则 skip，不一致 fail-fast） ───
  log('info', '─── 目标冲突检查（sha256）───');
  const toProcess = []; // 过滤掉 sha256 一致的 skip 文件
  for (const f of files) {
    if (existsSync(f.dstPath)) {
      const srcH = srcHash.get(f.name);
      const dstH = await sha256File(f.dstPath);
      if (srcH === dstH) {
        log('ok', `  ${f.dstName}：目标已存在且 sha256 完全一致，跳过（幂等）`);
        manifest.files.push({ name: f.name, dstName: f.dstName, status: 'skipped_identical', sha256: srcH });
        continue;
      }
      // sha256 不一致 → 先做数据级复核（P1-7 回退，治 parquet 非确定性序列化误报）
      const dataIdentical = await parquetDataIdentical(f.srcPath, f.dstPath);
      if (dataIdentical) {
        log('ok', `  ${f.dstName}：sha256 不同但数据级双向差集为 0（parquet 非确定性序列化），视为幂等跳过`);
        manifest.files.push({ name: f.name, dstName: f.dstName, status: 'skipped_data_identical', srcSha256: srcH, dstSha256: dstH });
        continue;
      }
      // 数据级复核确认内容确实不同
      if (!args.force) {
        log('error', `  目标已存在且内容不一致（sha256 与数据级比对均不同），传 --force 才允许覆盖（仅测试用）`);
        log('error', `    目标: ${f.dstPath}`);
        log('error', `    源 sha256=${srcH?.slice(0, 16)}... 目标 sha256=${dstH.slice(0, 16)}...`);
        manifest.summary = { status: 'CONFLICT_NOT_FORCE', file: f.dstName };
        writeManifest(manifest);
        process.exit(1);
      }
      // --force：只允许覆盖 SX 子目录内文件（护栏，B5 子目录版）
      assertForceOnlyInSxSubdir(f.dstPath);
      log('warn', `  --force：目标内容不一致（数据级确认不同），将先 backup 再覆盖：${f.dstName}`);
    }
    toProcess.push(f);
  }

  if (toProcess.length === 0) {
    // 全部 skip（幂等）。仍执行被取代分片归档：修复上一轮 promote 成功但归档失败的残留，
    // 否则重叠分片会一直卡死下游 sync-vps 的 overlap 闸。
    const archiveResult = runSupersededArchiveOrDie(manifest, 'ARCHIVE_FAILED_ALL_SKIPPED');
    manifest.summary = { status: 'SUCCESS_ALL_SKIPPED', totalSkipped: files.length };
    manifest.archivedShards = archiveResult;
    writeManifest(manifest);
    log('ok', `promote 完成：所有文件目标已存在且 sha256 完全一致，无需重新复制。`);
    return;
  }

  // ─── Phase B：--force 模式先 backup 旧文件（P0-3 事务化：任何失败立即恢复已挪走的文件） ───
  const backupMap = new Map(); // dstPath → backupPath（本次覆盖的旧文件）
  if (args.force) {
    log('info', '─── Phase B（force）：backup 旧文件 ───');

    // EXDEV 预检：目标目录与 backup 目录须在同一设备，否则 rename 会报 EXDEV
    for (const f of toProcess) {
      if (existsSync(f.dstPath)) {
        try {
          assertSameDevice(f.dstPath, targetDir);
        } catch (e) {
          log('error', `Phase B EXDEV 预检失败：${e.message}`);
          manifest.summary = { status: 'BACKUP_EXDEV_PREFLIGHT_FAILED', error: e.message };
          writeManifest(manifest);
          process.exit(1);
        }
      }
    }

    // 事务化 backup：逐文件 renameSync，任何异常立即恢复已挪走的文件
    for (const f of toProcess) {
      if (!existsSync(f.dstPath)) continue;
      const backupPath = `${f.dstPath}.bak_${RUN_ID}`;
      try {
        renameSync(f.dstPath, backupPath);
        backupMap.set(f.dstPath, backupPath);
        log('info', `  已 backup：${f.dstName} → ${basename(backupPath)}`);
      } catch (e) {
        // backup 本身失败：按 backupMap 恢复已挪走的旧文件，然后 exit 1
        log('error', `  Phase B backup 失败（${f.dstName}）：${e.message}`);
        log('error', `  正在恢复已 backup 的文件...`);
        for (const [dstPath, bkPath] of backupMap.entries()) {
          if (existsSync(bkPath)) {
            try {
              renameSync(bkPath, dstPath);
              log('ok', `    已恢复：${basename(bkPath)} → ${basename(dstPath)}`);
            } catch (re) {
              log('error', `    恢复失败（需人工处理）：${basename(bkPath)}: ${re.message}`);
            }
          }
        }
        manifest.summary = { status: 'BACKUP_FAILED_RESTORED', error: e.message };
        writeManifest(manifest);
        process.exit(1);
      }
    }
  }

  // ─── Phase C：复制到 staging ───
  log('info', '─── Phase C：复制到 staging（bootstrapper/sync-vps 不加载 .staging）───');
  const stagedFiles = []; // 已复制到 staging 的条目，用于回滚
  let stagingFailed = false;

  for (const f of toProcess) {
    // 清理旧 staging 残留
    if (existsSync(f.stagingPath)) {
      try { unlinkSync(f.stagingPath); } catch {}
    }
    try {
      copyFileSync(f.srcPath, f.stagingPath);
      stagedFiles.push(f);
      log('ok', `  已复制到 staging: ${basename(f.stagingPath)}`);
    } catch (e) {
      log('error', `  staging 复制失败：${f.name}: ${e.message}`);
      stagingFailed = true;
      break;
    }
  }

  if (stagingFailed) {
    log('error', 'Phase C staging 复制失败，回滚...');
    rollbackAll(stagedFiles, backupMap);
    manifest.summary = { status: 'STAGING_COPY_FAILED' };
    writeManifest(manifest);
    process.exit(1);
  }

  log('ok', `Phase C 通过：${stagedFiles.length} 个文件已 staging`);
  console.log('');

  // ─── Phase D：对 staging 文件做完整校验（sha256 + branch_code + premium） ───
  log('info', '─── Phase D：staging 文件完整校验（sha256 + branch_code=SX + premium）───');
  let verifyFailed = false;

  for (const f of stagedFiles) {
    log('info', `  校验 staging: ${basename(f.stagingPath)}`);
    try {
      // sha256 主校验（证明 staging == source）
      const srcH = srcHash.get(f.name);
      const stgH = await sha256File(f.stagingPath);
      if (srcH !== stgH) {
        throw new Error(
          `sha256 不一致（复制损坏）：源=${srcH?.slice(0, 16)}...  staging=${stgH.slice(0, 16)}...`
        );
      }
      log('ok', `    sha256 一致 ✅  ${stgH.slice(0, 16)}...`);

      // 叠加业务不变量（staging 上再次验 branch_code=SX）
      const stgStats = await validateBranchCodeSX(f.stagingPath);
      const srcSt = srcStats.get(f.name);
      if (stgStats.rowCount !== srcSt.rowCount) {
        throw new Error(`行数不一致：源=${srcSt.rowCount} staging=${stgStats.rowCount}`);
      }
      log('ok', `    branch_code=SX 全行一致 ✅  行数=${stgStats.rowCount.toLocaleString()}`);

      manifest.files.push({
        name: f.name, dstName: f.dstName, status: 'staged_verified',
        sha256: stgH,
        srcStats: srcSt, stagingStats: stgStats,
      });
    } catch (e) {
      log('error', `  Phase D 校验失败：${e.message}`);
      verifyFailed = true;
      manifest.files.push({ name: f.name, dstName: f.dstName, status: 'verify_failed', error: e.message });
    }
  }

  if (verifyFailed) {
    log('error', 'Phase D 校验失败，回滚 staging...');
    rollbackAll(stagedFiles, backupMap);
    manifest.summary = { status: 'VERIFY_FAILED_ROLLED_BACK' };
    writeManifest(manifest);
    log('error', 'promote 失败，已回滚。');
    process.exit(1);
  }

  log('ok', `Phase D 通过：${stagedFiles.length} 个 staging 文件 sha256 + branch_code=SX 全部验证通过`);
  console.log('');

  // ─── Phase E：短窗口批量 rename staging → final ───
  log('info', '─── Phase E：批量 rename staging → final（消除竞态窗口）───');
  const renamedFinals = [];
  let renameFailed = false;

  for (const f of stagedFiles) {
    try {
      renameSync(f.stagingPath, f.dstPath);
      renamedFinals.push(f);
      log('ok', `  rename 完成: ${f.dstName}`);
    } catch (e) {
      log('error', `  rename 失败（${f.dstName}）: ${e.message}`);
      renameFailed = true;
      break;
    }
  }

  if (renameFailed) {
    // rename 失败：清理已 rename 的 final 文件 + 未 rename 的 staging 文件 + 恢复 backup
    log('error', 'Phase E rename 失败，回滚...');
    for (const f of renamedFinals) {
      try { unlinkSync(f.dstPath); } catch {}
    }
    for (const f of stagedFiles) {
      if (existsSync(f.stagingPath)) {
        try { unlinkSync(f.stagingPath); } catch {}
      }
    }
    // 恢复 backup
    for (const [dstPath, backupPath] of backupMap.entries()) {
      if (existsSync(backupPath)) {
        try { renameSync(backupPath, dstPath); } catch {}
      }
    }
    manifest.summary = { status: 'RENAME_FAILED_ROLLED_BACK' };
    writeManifest(manifest);
    process.exit(1);
  }

  // ─── 全部成功：删除 backup ───
  if (args.force && backupMap.size > 0) {
    log('info', '删除 backup 文件（promote 成功确认）...');
    for (const [, backupPath] of backupMap.entries()) {
      try {
        if (existsSync(backupPath)) unlinkSync(backupPath);
        log('ok', `  已删除 backup: ${basename(backupPath)}`);
      } catch (e) {
        log('warn', `  backup 删除失败（非阻断，可手动清理）：${basename(backupPath)}: ${e.message}`);
      }
    }
  }

  // ─── Phase F：归档被取代的旧滚动分片（防下游 overlap 闸拦停发布链） ───
  log('info', '─── Phase F：归档被取代的旧滚动分片（.archive/<北京日>/）───');
  const archiveResult = runSupersededArchiveOrDie(manifest, 'SUCCESS_ARCHIVE_FAILED');
  manifest.archivedShards = archiveResult;
  if (archiveResult.archived.length === 0) {
    log('info', '  无被取代分片，跳过');
  }

  // 更新 manifest：将 staged_verified 改为 ok
  for (const entry of manifest.files) {
    if (entry.status === 'staged_verified') entry.status = 'ok';
  }

  const okFiles = manifest.files.filter(f => f.status === 'ok');
  const skippedFiles = manifest.files.filter(f => f.status === 'skipped_identical' || f.status === 'skipped_data_identical');
  manifest.summary = {
    status: 'SUCCESS',
    totalPromoted: okFiles.length,
    totalSkipped: skippedFiles.length,
    totalRows: okFiles.reduce((s, f) => s + (f.srcStats?.rowCount ?? 0), 0),
    totalPremium: okFiles.every(f => f.srcStats?.premiumSum !== null)
      ? okFiles.reduce((s, f) => s + (f.srcStats?.premiumSum ?? 0), 0)
      : null,
  };

  writeManifest(manifest);
  // P0-2b ready-marker：全部 rename 成功后写入标记，operator 须确认此文件存在才运行 sync-vps
  writeReadyMarker(manifest, targetDir);

  console.log('');
  log('ok', `SX promote 完成！`);
  log('ok', `  已 promote: ${okFiles.length} 个文件，共 ${manifest.summary.totalRows.toLocaleString()} 行` +
    (manifest.summary.totalPremium !== null
      ? `，保费合计 ${manifest.summary.totalPremium.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
      : ''));
  if (skippedFiles.length > 0) {
    log('info', `  已跳过（sha256 一致，无需重新复制）: ${skippedFiles.length} 个文件`);
  }
  console.log('');
  log('info', '⬇  后续步骤（需 operator 手动确认后执行）：');
  log('info', '   1. 确认服务端 BRANCH_RLS_ENABLED=true 已生效（SX 用户只能查 SX 数据）');
  log('info', '   2. 同步到 VPS（先 dry-run；SX 在 SYNC_ALLOWED_BRANCHES 白名单内，无需任何 env）:');
  log('info', '      node scripts/sync-vps.mjs --dry-run');
  log('info', '      node scripts/sync-vps.mjs');
  log('info', '   3. PM2 reload: sudo /usr/local/bin/deploy-chexian-api reload');
  log('info', '   4. 健康检查: curl https://chexian.cretvalu.com/health');
}

// ─────────────────────────── 回滚工具 ───────────────────────────

/**
 * 回滚辅助：清理 staging 文件 + 恢复 backup（若有）
 * @param {Array} stagedFiles
 * @param {Map<string, string>} backupMap  dstPath → backupPath
 */
function rollbackAll(stagedFiles, backupMap) {
  for (const f of stagedFiles) {
    if (existsSync(f.stagingPath)) {
      try { unlinkSync(f.stagingPath); log('ok', `  已清理 staging: ${basename(f.stagingPath)}`); } catch {}
    }
  }
  for (const [dstPath, backupPath] of backupMap.entries()) {
    if (existsSync(backupPath)) {
      try {
        renameSync(backupPath, dstPath);
        log('ok', `  已恢复 backup: ${basename(backupPath)} → ${basename(dstPath)}`);
      } catch (e) {
        log('error', `  backup 恢复失败（需人工处理）: ${basename(backupPath)}: ${e.message}`);
      }
    }
  }
}

// ─────────────────────────── Manifest 落盘 ───────────────────────────

function writeManifest(manifest) {
  // manifest 落点跟随 targetDir（与 .sx-promote-ready 标记一致），而非固定仓库相对路径。
  //   - 真实 promote（targetDir = current/SX/）：清单与 .sx-promote-ready + 裸名 parquet 同处一地，
  //     operator 可在同一目录核查（Day-1 SOP「确认 ready-marker 存在后才跑 sync-vps」纪律不变）。
  //   - 测试（--target-dir /tmp/...）：清单落 tmp，绝不覆写被 git 追踪的仓库文件（防 spurious 脏状态）。
  // 这两份产物均以 . 开头且非 .parquet，不被 bootstrapper/sync-vps 加载或同步，并经 .gitignore 排除。
  const outPath = join(targetDir, '.sx-promote-manifest.json');
  try {
    writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
    log('info', `清单已落盘: ${outPath}`);
  } catch (e) {
    log('warn', `清单落盘失败（非阻断）: ${e.message}`);
    console.log(JSON.stringify(manifest, null, 2));
  }
}

// ─────────────────────────── 主入口 ───────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SX Premium 晋升 — validation/SX → current/SX/（分省子目录布局 · B5）');
  const rlsFlagLabel = args.rlsConfirmed ? ' [--rls-confirmed]' : (args.autoVerifiedRls ? ' [--auto-verified-rls]' : '');
  console.log(`  模式: ${args.apply ? '【APPLY】' : '【DRY-RUN（默认）】'}${args.force ? ' [--force]' : ''}${rlsFlagLabel}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // P2-10：--apply 必须携带 --rls-confirmed（operator 手动声明）或 --auto-verified-rls（自动化
  // 已对生产做过真实查询核实，见 scripts/sync-vps.mjs runSxAutoPromote() + queryVpsSecurityStatus()）。
  // 二者二选一即可，缺一律拒绝——不接受"既非人工声明也非自动核实"的裸 --apply。
  if (args.apply && !args.rlsConfirmed && !args.autoVerifiedRls) {
    log('error', `[sx-promote] --apply 拒绝执行：缺少 --rls-confirmed 或 --auto-verified-rls 旗标。`);
    log('error', `  本脚本是跨省数据 cutover 步骤，须在生产 BRANCH_RLS_ENABLED=true 已核实后调用。`);
    log('error', `  operator 核实生产 RLS-on 后，传 --rls-confirmed 声明，再运行：`);
    log('error', `  node scripts/release/sx-promote.mjs --apply --rls-confirmed`);
    log('error', `  （自动化调用方须改用 --auto-verified-rls，且必须在真实查询到 RLS=true 后才传，见文件头注释）`);
    process.exit(1);
  }
  if (args.apply && args.autoVerifiedRls && !args.rlsVerificationNote) {
    log('error', `[sx-promote] --auto-verified-rls 必须配合 --rls-verification-note "<核实方式说明>"（审计追溯用，不可留空）。`);
    process.exit(1);
  }

  // P0-1 源目录安全校验（--apply 时默认只允许 DEFAULT_SOURCE_DIR）
  try {
    assertSourceDirSafety({
      sourceDir,
      defaultSourceDir: DEFAULT_SOURCE_DIR,
      unsafeSourceDir: args.unsafeSourceDir,
      apply: args.apply,
    });
  } catch (e) {
    log('error', e.message);
    process.exit(1);
  }

  // P2-9：assertSxSubdirTarget 在 mkdirSync 之前（main 顶部，B5 语义反转：目标必须是 current/SX）
  try {
    assertSxSubdirTarget(targetDir);
  } catch (e) {
    log('error', e.message);
    process.exit(1);
  }

  // B5-11 布局中间态守卫：current/ 顶层仍有扁平 parquet（cutover T-1 未完成）→ apply 拒绝执行；
  // dry-run 仅警告（允许在迁移前预览计划，但明确标注当前不可 apply）
  try {
    assertParentLayoutReady(targetDir);
  } catch (e) {
    if (args.apply) {
      log('error', e.message);
      process.exit(1);
    }
    log('warn', `${e.message}`);
    log('warn', `（dry-run 继续打印计划；完成 cutover T-1 布局迁移前 --apply 会被本守卫拒绝）`);
  }

  // P0-2a leftover preflight：检测目标目录残留 .staging/.bak_*（仅 apply 模式）
  if (args.apply) {
    try {
      leftoverPreflight(targetDir, { resume: args.resume });
    } catch (e) {
      log('error', e.message);
      process.exit(1);
    }
  }

  // P1-5：任何文件复制前先 duckdb preflight（仅 apply 模式）
  if (args.apply) {
    duckdbPreflight();
    console.log('');
  }

  // 发现源文件
  let files;
  try {
    files = discoverSourceFiles({ sourceDir, targetDir });
  } catch (e) {
    log('error', e.message);
    process.exit(1);
  }

  // P1-6：--apply 下 0 个文件 → exit 1（除非 --allow-empty）
  if (files.length === 0) {
    if (args.apply && !args.allowEmpty) {
      log('error', `[sx-promote] --apply 拒绝执行：源目录 ${sourceDir} 无 parquet 文件。`);
      log('error', `  如确需空源 apply（测试用），传 --allow-empty。`);
      process.exit(1);
    }
    log('warn', `源目录无 parquet 文件: ${sourceDir}`);
    if (!args.apply) {
      log('warn', `  请先运行 SX premium ETL 生成分片`);
    }
  }

  if (!args.apply) {
    await printPlan(files);
  } else {
    await applyPromote(files);
  }
}

// 仅在作为入口脚本运行时执行 main()（import 时不执行，避免测试副作用）
// 用 import.meta.url 与 process.argv[1] 比较，是 ESM 标准的"main module"检测方式
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch(e => {
    log('error', `未捕获错误: ${e.message}`);
    process.exit(1);
  });
}
