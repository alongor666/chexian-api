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
