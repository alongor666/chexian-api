/**
 * full_snapshot 缓存键计算（纯逻辑，抽自 daily.mjs 便于单测）。
 *
 * full_snapshot 策略命中缓存时直接 copy 旧快照、跳过 convert 脚本（见 daily.mjs
 * runStrategyFullSnapshot）。因此缓存键必须覆盖「所有影响产物内容的输入」，否则会服务陈旧产物。
 *
 * daily.mjs 顶层执行 main()，无法被 import（同 lib/shard-classify.mjs / claims-freshness.mjs），
 * 故把缓存键逻辑抽到本模块单独单测。
 */
import { existsSync, statSync, readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { basename, dirname, join } from 'path';
import { stripOuterDoubleQuotes, stripArgQuotes } from './arg-quotes.mjs';

// 不影响 parquet 产物内容、仅控制 data-sources.json 旁路写入的参数（base_converter.py:206
// 仅用 --no-metadata 门控 update_data_sources；对 parquet 字节零影响）。从缓存材料剔除，
// 避免 manifest 运行（带 --no-metadata）与直接运行（不带）在同一 batch 间反复 cache miss 重算。
// denylist 而非 allowlist：未知新参数默认保留（fail-safe，宁可多算不可服务陈旧）。
const CONTENT_NEUTRAL_FLAGS = new Set(['--no-metadata']);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 内容指纹：{name, size, sha256}（与 daily.mjs fileFingerprint 的 cache 用子集一致）。 */
function contentFingerprint(path) {
  return { name: basename(path), size: statSync(path).size, sha256: sha256File(path) };
}

export function fullSnapshotOutputName(id, trigger) {
  return trigger.snapshot_output || `${id}.parquet`;
}

export function fullSnapshotDependencyPaths(pipelineDir, scriptPath) {
  // 多省 P3-B（codex 闸-2 P2-2）：补 derived_fields.py + field-registry/fields.json 进缓存
  //   key—— 仅改 prefix mapping / guard 逻辑（不动 convert_*.py）时，旧 cache 可能误复用，
  //   导致 branch_code 派生错乱。registry 文件相对路径：pipelineDir 上溯两级到仓库根，再进
  //   server/src/config/field-registry/fields.json（与 derived_fields.py 读法对齐）。
  const repoRoot = join(pipelineDir, '..', '..');
  return [
    scriptPath,
    join(pipelineDir, 'base_converter.py'),
    join(pipelineDir, 'etl_validation.py'),
    join(pipelineDir, 'parquet_utils.py'),
    join(pipelineDir, 'derived_fields.py'),
    join(repoRoot, 'server', 'src', 'config', 'field-registry', 'fields.json'),
  ];
}

/**
 * 从 extraArgs 解析 --policy-dir 的值（支持 `--policy-dir <dir>` 与 `--policy-dir=<dir>` 两种写法）。
 * daily.mjs 当前以两元素裸路径形式注入（见 new_energy_claims 调用处）。
 *
 * 对取出的值剥离最外层双引号：daily.mjs 另有调用点沿用历史 `"${dir}"` 写法（由 runPythonScript
 * 中央剥引号后再喂 Python）。若未来某 full_snapshot 域用带引号形态注入，不剥引号会导致
 * existsSync('"dir"') 判 false → policyInputs 退化为 [] → 陈旧缓存漏洞复活（R17 同类 foot-gun）。
 */
export function parsePolicyDir(extraArgs = []) {
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    if (arg === '--policy-dir') {
      const value = extraArgs[i + 1];
      return value == null ? null : stripOuterDoubleQuotes(value);
    }
    if (typeof arg === 'string' && arg.startsWith('--policy-dir=')) {
      return stripOuterDoubleQuotes(arg.slice('--policy-dir='.length));
    }
  }
  return null;
}

/**
 * 对 --policy-dir 目录下的 *.parquet 做内容指纹（与 convert_new_energy_claims.py 的
 * `read_parquet('<dir>/*.parquet')` JOIN 输入集严格对齐：非递归、仅 *.parquet、按文件名排序）。
 * 目录缺失 / 无 parquet → 返回 []（与 Python 端「policy_dir 不存在则跳过回填」语义一致）。
 * 仅纳入常规文件：以 .parquet 结尾的目录 / FIFO 等若被 stat/readFile 会在缓存键计算阶段抛错
 * 中断整条 ETL（policy/current 由 ETL renameSync 写出，正常只含常规 parquet 文件）。
 *
 * 多省 Phase B B2：**故意保持 flat-within-dir（isFile 过滤天然排除省份子目录 current/<省>/）**，
 * 与消费者 convert_new_energy_claims.py 的 read_parquet('<dir>/*.parquet') 非递归 glob 严格对齐——
 * 子目录布局下 daily.mjs 把 --policy-dir 指向 current/<省>/ 本身（branchOutputRoot 派生），指纹与
 * convert 读到的是同一组 flat 分片，无需下钻。**禁止改为递归**（否则指纹覆盖 convert 没读到的文件）。
 */
export function collectPolicyInputFingerprints(policyDir) {
  if (!policyDir || !existsSync(policyDir)) return [];
  return readdirSync(policyDir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.parquet'))
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b))
    .map(name => contentFingerprint(join(policyDir, name)));
}

/**
 * full_snapshot 缓存键：覆盖所有影响产物内容的输入。
 *
 * 除 sources（域自身 xlsx）+ dependencies（共享 .py 脚本）外，还纳入：
 *   - extraArgs：调用方注入的命令行参数（剔除 CONTENT_NEUTRAL_FLAGS 后；保留 --policy-dir
 *     路径 / --branch-code 等会改变产物的参数）。任一变化都可能改变产物，故保守整组纳入。
 *   - policyInputs：--policy-dir 目录下 policy/current parquet 的内容指纹。这是承重项——
 *     new_energy_claims 的 org_level_3 由 VIN JOIN policy 回填，policy 内容变化但 xlsx/batchDate
 *     不变时，仅靠 extraArgs（路径字符串两次运行间恒定）无法触发缓存失效，必须对 policy 内容指纹。
 *     （根因见 PR：codex 对抗评审在 PR #732 发现）。
 *
 * extraArgs / policyInputs 始终写入 material（即使为空数组），保持键结构可预测；
 * 上线后各 full_snapshot 域首跑会一次性 cache miss 重算，符合「缓存逻辑变更应重算」预期。
 */
export function buildFullSnapshotCacheKey({ id, batchDate, sourceFingerprints, scriptPath, trigger, extraArgs = [] }) {
  // 镜像 runPythonScript 的中央剥引号：缓存键反映 Python 实际所见的参数，与 `"${dir}"` vs 裸路径
  // 的写法无关（两者产生同一产物，理应同一键）。再剔除内容中性参数，避免无谓重算。
  const normalizedArgs = stripArgQuotes(extraArgs).filter(a => !CONTENT_NEUTRAL_FLAGS.has(a));
  const dependencies = fullSnapshotDependencyPaths(dirname(scriptPath), scriptPath)
    .filter(p => existsSync(p))
    .map(contentFingerprint);
  const policyInputs = collectPolicyInputFingerprints(parsePolicyDir(normalizedArgs));
  const material = {
    id,
    batchDate,
    snapshotMode: trigger.snapshot_mode,
    outputName: fullSnapshotOutputName(id, trigger),
    dependencies,
    sources: sourceFingerprints
      .map(f => ({ name: f.name, size: f.size, sha256: f.sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    extraArgs: normalizedArgs,
    policyInputs,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}
