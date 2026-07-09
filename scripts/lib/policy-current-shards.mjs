/**
 * policy/current 分片枚举（共享纯函数 · 多省 Phase B B2）
 *
 * 唯一职责：把「扫 policy/current 目录取 parquet 分片」统一为「顶层扁平 + 省份子目录 current/<省>/」
 * 两遍枚举，供所有读侧消费者（overlap 检测 / quick_reference 统计 / prepublish 门禁 /
 * governance / daily readiness）下钻，避免 B2 落盘子目录后这些站点对子目录「失明」→ 返回 0 分片
 * → 重叠检测假「通过」、shardCount 0（比报错更危险的沉默失败）。
 *
 * 与 server/src/services/data-bootstrapper.ts:discoverInDir **同源语义**（装载层 B1 已落）：
 *   - Pass1 顶层 `.parquet`（branch=undefined，逐字节复刻现状谓词：endsWith('.parquet') + statSync 跟随 symlink）
 *   - Pass2 `^[A-Z]{2}$` 子目录内 `.parquet`（branch=目录名，isFile 排除嵌套 staging/ 等目录）
 *   - readdir 枚举**实际存在**的省份子目录（数据/配置驱动，天然处理 N 省），**禁硬编码 ['SC','SX']**
 *
 * 今天 current/ 扁平无子目录 → 仅返回顶层文件 branch 全 undefined → 与现状逐字节等价（休眠）。
 *
 * 纯 node stdlib（fs/path），无副作用，可被 数据管理/ 与 scripts/ 两侧 import（方向：数据管理 → scripts/lib，
 * 与 parquet-overlap-check.mjs 既有跨目录引用一致）；**禁止反向 import 数据管理/***。
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROVINCE_SUBDIR = /^[A-Z]{2}$/;

/**
 * 枚举 policy/current 下的全部 parquet 分片（顶层 + 省份子目录）。
 * @param {string} currentDir policy/current 根目录绝对/相对路径
 * @returns {Array<{name:string, path:string, branch:string|undefined}>}
 *   顶层文件 branch=undefined；子目录文件 branch=省码。目录不存在 → []。
 */
export function listPolicyCurrentShards(currentDir) {
  if (!existsSync(currentDir)) return [];
  const entries = readdirSync(currentDir);
  const result = [];

  // Pass1：顶层扁平 parquet（**逐字节复刻现状谓词 + statSync 不吞错**，与 discoverInDir / 历史
  // readdirSync().filter().map(statSync) 一致——坏 symlink/权限错应抛出 fail-closed，而非静默少读）。
  for (const name of entries) {
    if (!name.endsWith('.parquet')) continue;
    const fullPath = join(currentDir, name);
    const stat = statSync(fullPath); // 跟随 symlink；不 catch（与 discoverInDir 一致）
    result.push({ name, path: fullPath, branch: undefined });
  }

  // Pass2：省份子目录 current/<省>/（新增；省码不以 .parquet 结尾故与 Pass1 不相交）。
  // 仅子目录 statSync 容错「目录消失则跳过」（纯增量行为，与 discoverInDir 一致）；
  // 子目录内文件 statSync 不吞错（同 Pass1 fail-closed 语义）。
  for (const name of entries) {
    if (!PROVINCE_SUBDIR.test(name)) continue;
    const subDir = join(currentDir, name);
    let subStat;
    try {
      subStat = statSync(subDir);
    } catch {
      continue;
    }
    if (!subStat.isDirectory()) continue;
    for (const f of readdirSync(subDir)) {
      if (!f.endsWith('.parquet')) continue;
      const fullPath = join(subDir, f);
      if (!statSync(fullPath).isFile()) continue; // 子目录内仅取文件，排除嵌套目录；不 catch
      result.push({ name: f, path: fullPath, branch: name });
    }
  }

  return result;
}

/**
 * 把显式文件路径列表转为 DuckDB `read_parquet([...])` 数组字面量（单引号 SQL 转义）。
 *
 * **codex 闸-2 P1**：不暴露宽 `**` glob——`current/**​/*.parquet` 会吃到 helper 明确排除的
 * `current/archive/*.parquet`、`current/<省>/staging/*.parquet`、非省码目录等，破坏「与 helper
 * `^[A-Z]{2}$` 单层语义一致」。改由 listPolicyCurrentShards 显式枚举 → 精确文件列表 → 数组字面量，
 * 所有 DuckDB 读侧消费者语义与 helper 完全一致。**调用方须先保证列表非空**（DuckDB read_parquet
 * 空数组报错；各站点已在「无分片→提前返回」后才调用）。
 * @param {string[]} paths 绝对/相对文件路径
 * @returns {string} 形如 `['/a/x.parquet', '/b/y.parquet']`
 */
export function toDuckdbReadParquetList(paths) {
  return '[' + paths.map(p => `'${String(p).replace(/'/g, "''")}'`).join(', ') + ']';
}

/**
 * policy/current 的 Python glob.glob 模式对（顶层 + 单层 `[A-Z][A-Z]` 省份子目录）。
 * 与 helper `^[A-Z]{2}$` 语义一致（DuckDB/Python `[A-Z][A-Z]` 字符类只匹配两位大写字母目录，
 * 排除 archive/ 等多字符目录与嵌套深目录）；glob.glob 对零匹配返回 []（不报错），扁平布局下
 * 仅顶层命中 → 与现状 `current/*.parquet` 逐字节等价。**非递归**（不用 `**`/recursive）。
 * @param {string} currentDir
 * @returns {string[]} `[<dir>/*.parquet, <dir>/[A-Z][A-Z]/*.parquet]`
 */
export function policyCurrentGlobPatterns(currentDir) {
  return [join(currentDir, '*.parquet'), join(currentDir, '[A-Z][A-Z]', '*.parquet')];
}

/**
 * 检测「子目录省份独占」状态：顶层扁平为空但存在省份子目录分片。
 * 用于读侧 readiness/前置闸 fail-closed —— 消费者（renewal/new_energy convert 等）尚为 flat glob
 * 时，子目录独占态会让消费者读 0 行却静默放行（false-ready），故须 BLOCK 而非跳过。
 * @param {string} currentDir
 * @returns {{flatCount:number, subdirCount:number, subdirOnly:boolean, branches:string[]}}
 */
export function inspectPolicyCurrentLayout(currentDir) {
  const shards = listPolicyCurrentShards(currentDir);
  const flat = shards.filter(s => s.branch === undefined);
  const subdir = shards.filter(s => s.branch !== undefined);
  return {
    flatCount: flat.length,
    subdirCount: subdir.length,
    subdirOnly: flat.length === 0 && subdir.length > 0,
    branches: [...new Set(subdir.map(s => s.branch))].sort(),
  };
}

/**
 * 多省 Phase B B3 · sync 前 GATED 省份子目录闸（镜像 data-bootstrapper.ts:enforceProvinceSubdirGate，
 * 但**比 B1 装载闸更严**）。返回违规消息数组（空=放行）；调用方据此 fail-closed（红字 + exit 1）。
 *
 * 为何比 B1 严（codex 闸-1 P0-1）：B1 装载闸用 `BRANCH_RLS_ENABLED` 作非基准省放行口（cutover 后允许装入）；
 * 但 sync 侧 cutover（把非基准省推生产）是 **B5 独立授权动作**，B3 范围内 `current/<非基准省>/` 必须为空/隔离
 * （SX 仍走 `validation/SX`）。故 B3 sync 闸**无条件** fail-closed 任何非基准省子目录，不给 RLS 开关放行口——
 * 否则 B3 越界执行 B5 cutover。
 *
 * ⚠️ `allowedBranches` 白名单参数驱动（默认 ['SC']=最保守），但**禁用 ETL 的 `BRANCH_CODE` env 注入**
 * （codex 闸-2 P1 原判保留）——若被 sync 闸采信，SX ETL 残留的 env `BRANCH_CODE=SX` 会把 `current/SX/`
 * 误判放行 → 推生产，违 GATED 红线。白名单只能由调用方传**代码里显式写死的授权常量**
 * （sync-vps `SYNC_ALLOWED_BRANCHES`；B5 cutover PR 与 owner 授权同批扩为 ['SC','SX']，SOP §2-1）。
 * 白名单是**推送授权面**（安全闸），不是数据发现面——发现仍 readdir 枚举，不违背禁省常量红线。
 *
 * 两类违规：
 *   ① 扁平顶层 parquet 与省份子目录 parquet 并存 → 迁移态冲突（B2 落子目录后顶层须清空，cutover SOP 处理）。
 *   ② 任何 `branch ∉ allowedBranches` 子目录含分片 → GATED fail-closed（名单外省严禁进 current/→ 推生产）。
 *
 * 扁平布局（无子目录）→ subdir 为空 → 返回 [] 休眠（生产字节安全，闸不触发）。
 * @param {string} currentDir
 * @param {{allowedBranches?: string[]}} [opts] allowedBranches 默认 ['SC']（最保守；禁读 ETL BRANCH_CODE）
 * @returns {string[]} 违规消息（空数组=放行）
 */
export function findPolicyCurrentSyncGateViolations(currentDir, { allowedBranches = ['SC'] } = {}) {
  const shards = listPolicyCurrentShards(currentDir);
  const subdir = shards.filter(s => s.branch !== undefined);
  if (subdir.length === 0) return []; // 扁平/空 → 休眠放行
  const violations = [];

  const flat = shards.filter(s => s.branch === undefined);
  if (flat.length > 0) {
    violations.push(
      `迁移态冲突：current/ 同时存在顶层扁平 parquet（${flat.length} 个）与省份子目录 parquet` +
      `（${[...new Set(subdir.map(s => s.branch))].sort().join(',')}）。子目录迁移须一次性——` +
      `B2 落盘 current/<省>/ 后顶层须清空，否则同省数据双计；物理迁移走 cutover SOP。`,
    );
  }

  const nonAllowed = [...new Set(subdir.map(s => s.branch))].filter(b => !allowedBranches.includes(b)).sort();
  if (nonAllowed.length > 0) {
    violations.push(
      `GATED fail-closed：current/ 发现同步白名单外省份子目录数据 [${nonAllowed.join(',')}]` +
      `（同步白名单=[${allowedBranches.join(',')}]）。名单外省份严禁同步进生产（跨省串读 + 越界执行` +
      ` cutover）——应隔离在 validation/<省>/，真正上线是独立 GATED cutover，须 owner 授权后经 PR 扩白名单。`,
    );
  }

  return violations;
}

/**
 * 非 SC 省维度隔离副本枚举（warehouse/validation/<省>/dim/<域>/ 下全部 *.parquet）。
 *
 * 与 sync-vps.mjs:buildValidationDimSyncTasks 同一套省/子域发现规则（同 DIM_SUBDOMAINS、同 key
 * 前缀 `validation/<省>/dim/<域>/`），供 governance checkDataDrift 复用——避免各消费者各自维护一份
 * 省/子域清单导致漂移（2026-07-08 实测：check-governance.mjs 静态 dirMappings 未收录该路径，误报
 * SX dim/salesman、dim/plan「已删除」，阻断 release:daily）。
 *
 * 枚举整个子域目录下的全部 .parquet（而非只认 latest.parquet 单一文件名）：与
 * sync-vps.mjs:writeSyncManifest 对该目录 `readdirSync(...).filter(f => f.endsWith('.parquet'))`
 * 同一发现规则——若该目录未来出现 latest.parquet 之外的产物（如按快照归档），两侧仍逐字节一致，
 * 不会因为本 helper 只认单一文件名而漏检/误报「已删除」（2026-07-09 codex 对抗性评审发现）。
 *
 * @param {string} validationRoot 通常为 数据管理/warehouse/validation 绝对路径
 * @returns {Array<{key:string, path:string}>}
 */
export function listValidationDimShards(validationRoot) {
  if (!existsSync(validationRoot)) return [];
  const DIM_SUBDOMAINS = ['salesman', 'plan', 'repair'];
  const shards = [];
  const provinces = readdirSync(validationRoot)
    .filter((entry) => entry !== 'SC' && /^[A-Z]{2}$/.test(entry));
  for (const province of provinces) {
    const dimDir = join(validationRoot, province, 'dim');
    if (!existsSync(dimDir) || !statSync(dimDir).isDirectory()) continue;
    for (const subdomain of DIM_SUBDOMAINS) {
      const subDir = join(dimDir, subdomain);
      if (!existsSync(subDir) || !statSync(subDir).isDirectory()) continue;
      for (const f of readdirSync(subDir).filter((name) => name.endsWith('.parquet'))) {
        shards.push({ key: `validation/${province}/dim/${subdomain}/${f}`, path: join(subDir, f) });
      }
    }
  }
  return shards;
}

/**
 * governance checkDataDrift 用：枚举 validation 维度副本并组装成 {key: {size, mtimeMs}} 条目，
 * 供 Object.assign 并入 currentFiles。抽出本 helper 是为避免 check-governance.mjs 内联循环
 * 膨胀单体（H5 体积棘轮 4000 行）——新检查进独立模块，不回流主脚本。
 *
 * @param {string} validationRoot 通常为 数据管理/warehouse/validation 绝对路径
 * @returns {Record<string, {size:number, mtimeMs:number}>}
 */
export function collectValidationDimFileEntries(validationRoot) {
  const entries = {};
  for (const shard of listValidationDimShards(validationRoot)) {
    const stat = statSync(shard.path);
    entries[shard.key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
  }
  return entries;
}
