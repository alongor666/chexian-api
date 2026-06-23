/**
 * policy/current Parquet 时间范围重叠门禁（共享纯函数）
 *
 * 三处引用：scripts/check-governance.mjs、scripts/sync-vps.mjs、数据管理/daily.mjs
 * 任意一处变更逻辑都会污染另外两处，故抽到此模块。
 *
 * 互补豁免：剔摩（非摩托）+ 限摩（仅摩托）按险类切分，时间重叠不构成数据翻倍；
 * 单独存在的限摩（无配对剔摩）= 反模式，必须报错。
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIELDS_JSON = join(__dirname, '../../server/src/config/field-registry/fields.json');

// 派生轴解析器（Python/DuckDB）：读 parquet 的 branch_code 列；缺列时从 policy_no[:N] 派生省份。
// 唯一事实源 = fields.json branch_code derivation（mapping / prefixLength 不在此硬编码）。
const BRANCH_RESOLVER_PY = `
import sys, json, duckdb
fields_path, parquet = sys.argv[1], sys.argv[2]
reg = json.load(open(fields_path))
bc = next((f for f in reg.get('fields', []) if f.get('id') == 'branch_code'), None)
deriv = (bc or {}).get('derivation', {})
mapping = deriv.get('mapping', {}); plen = int(deriv.get('prefixLength', 3))
con = duckdb.connect()
cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{parquet}')").fetchall()]
if 'branch_code' in cols:
    vals = [r[0] for r in con.execute(
        f"SELECT DISTINCT branch_code FROM read_parquet('{parquet}') "
        f"WHERE branch_code IS NOT NULL AND TRIM(branch_code) <> ''").fetchall()]
elif 'policy_no' in cols:
    rows = con.execute(
        f"SELECT DISTINCT SUBSTR(CAST(policy_no AS VARCHAR), 1, {plen}) "
        f"FROM read_parquet('{parquet}') WHERE policy_no IS NOT NULL").fetchall()
    vals = [mapping.get(r[0]) for r in rows if mapping.get(r[0])]
else:
    print(json.dumps({"branch": None})); sys.exit(0)
vals = sorted(set(v for v in vals if v))
if len(vals) == 1:
    print(json.dumps({"branch": vals[0]}))
elif len(vals) == 0:
    print(json.dumps({"branch": None}))
else:
    print(json.dumps({"error": "multi:" + ",".join(map(str, vals))}))
`;

/**
 * 从 parquet **派生省份**（数据轴，权威）解析 branch。替代「文件名前缀=省份契约」(#753)。
 *
 * 返回 { branch: 'SC'|'SX'|... } 或 { branchError: '<原因>' }。
 *   - 0 字节 / 明显非 parquet（单测空占位文件）→ 文件名兜底（legacy permissive，向后兼容）
 *   - 有效 parquet 派生单省 → 该省
 *   - 有效 parquet 派生多省（混省）→ branchError（fail-closed，不掩盖事故 · codex 闸-1 P1.4）
 *   - 无 branch 信号（无 branch_code 且无 policy_no）→ 文件名兜底
 *   - 非空文件但读取失败（损坏 / duckdb 缺失）→ branchError（fail-closed，不回退文件名）
 */
export function resolveBranchFromParquet(filePath) {
  const name = basename(filePath);
  let size = -1;
  try {
    size = statSync(filePath).size;
  } catch {
    return { branch: parseBranchFromFilename(name) }; // 文件不存在 → 文件名兜底（不应阻断）
  }
  if (size === 0) return { branch: parseBranchFromFilename(name) }; // 空占位（单测）→ legacy
  try {
    const out = execFileSync('python3', ['-c', BRANCH_RESOLVER_PY, FIELDS_JSON, filePath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r = JSON.parse(out.trim());
    if (r.error) return { branchError: `${name}: parquet 派生省份多值/混省（${r.error}）` };
    if (r.branch == null) return { branch: parseBranchFromFilename(name) }; // 无 branch 信号 → 文件名
    return { branch: r.branch };
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    return { branchError: `${name}: parquet 读取失败，无法判定省份（${msg}）` };
  }
}

export function parseDateRangeFromFilename(filename) {
  if (!filename.endsWith('.parquet')) return null;
  // 旧后缀式：*_YYYYMMDD_YYYYMMDD.parquet（每日数据_*/01_签单清单_* 遗留命名）
  const legacy = filename.match(/_(\d{8})_(\d{8})\.parquet$/);
  if (legacy) return { start: parseInt(legacy[1], 10), end: parseInt(legacy[2], 10) };
  // 新前缀式（2026-06-10 上游重构）：YYYYMMDD-YYYYMMDD_01_签单清单_定稿.parquet
  // 日期对在头部、连字符分隔、后接业务名 — 原正则对此失明，跨命名代际的
  // 时间重叠（保费翻倍事故原始形态）检测不到（daily.mjs/sync-vps/governance 三处共用）。
  const prefixed = filename.match(/(?:^|_)(\d{8})-(\d{8})_/);
  if (prefixed) return { start: parseInt(prefixed[1], 10), end: parseInt(prefixed[2], 10) };
  return null;
}

/**
 * 从文件名提取省份编码（CHAR(2)）。多省物理隔离用：不同省份的同期分片不构成数据翻倍。
 * 约定：省份前缀 `<BRANCH>_...`（如 SX_）；无前缀＝四川裸名（向后兼容），回退 'SC'。
 */
export function parseBranchFromFilename(filename) {
  const m = filename.match(/^([A-Z]{2})_/);
  return m ? m[1] : 'SC';
}

export function isComplementaryPair(a, b) {
  const aTuomo = /_剔摩_/.test(a);
  const aXianmo = /_限摩_/.test(a);
  const bTuomo = /_剔摩_/.test(b);
  const bXianmo = /_限摩_/.test(b);
  return (aTuomo && bXianmo) || (aXianmo && bTuomo);
}

/**
 * 计算所有重叠对（含互补豁免）。
 * @returns {{count:number, files:number, overlaps:Array<{a:string,b:string,aRange:[number,number],bRange:[number,number]}>}}
 */
export function detectPolicyCurrentOverlap(currentDir) {
  if (!existsSync(currentDir)) {
    return { count: 0, files: 0, overlaps: [], skipped: true, reason: 'dir-not-exist' };
  }

  const parquetFiles = readdirSync(currentDir)
    .filter((f) => f.endsWith('.parquet') && !f.startsWith('test-data'))
    .map((f) => ({ name: f, range: parseDateRangeFromFilename(f) }))
    .filter((f) => f.range !== null);

  // 多省物理隔离：按省份分组，仅在同省组内做两两重叠比对。
  // 不同省份的同期分片（如 SC 与 SX 都覆盖 2021-2026）是独立数据，不构成数据翻倍。
  // 省份取自 parquet **派生轴**（数据权威，替代文件名契约 #753）；空占位/无信号回退文件名。
  // 派生多省（混省）/ 读取失败 → branchError，由 assertNoPolicyCurrentOverlap fail-closed。
  // 即使只有 ≤1 个分片也要解析：单文件混省本身即违规，须能被检出（不靠两两重叠）。
  const byBranch = new Map();
  const branchErrors = [];
  for (const f of parquetFiles) {
    const res = resolveBranchFromParquet(join(currentDir, f.name));
    if (res.branchError) {
      branchErrors.push(res.branchError);
      continue;
    }
    const branch = res.branch;
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(f);
  }

  if (parquetFiles.length <= 1) {
    return { count: 0, files: parquetFiles.length, overlaps: [], branchErrors, skipped: false };
  }

  const overlaps = [];
  for (const group of byBranch.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.range.start <= b.range.end && b.range.start <= a.range.end) {
          if (isComplementaryPair(a.name, b.name)) continue;
          overlaps.push({
            a: a.name,
            b: b.name,
            aRange: [a.range.start, a.range.end],
            bRange: [b.range.start, b.range.end],
          });
        }
      }
    }
  }

  return { count: overlaps.length, files: parquetFiles.length, overlaps, branchErrors, skipped: false };
}

/**
 * 命令行入口（独立可执行）：检查 policy/current 重叠，发现则 exit(1)。
 * 用于 daily.mjs / sync-vps.mjs 在关键节点 spawn 调用，或本地手测。
 */
export function assertNoPolicyCurrentOverlap(currentDir, { onPass, onFail } = {}) {
  const result = detectPolicyCurrentOverlap(currentDir);

  if (result.skipped) {
    if (onPass) onPass(`policy/current 目录不存在，跳过重叠检测`);
    return true;
  }

  // fail-closed：parquet 派生省份混省/读取失败 → 直接失败，不被「无重叠」掩盖（codex 闸-1 P1.4）
  if (result.branchErrors && result.branchErrors.length > 0) {
    if (onFail) {
      const lines = result.branchErrors.map((m) => `  - ${m}`);
      onFail(
        `policy/current 存在单文件混省或不可判定省份的 parquet（数据轴权威）：\n${lines.join('\n')}\n` +
          `  ▶ 修复：拆分混省 parquet（单文件单省），或核查损坏文件；省份以 parquet 内派生为准（非文件名）`
      );
    }
    return false;
  }

  if (result.count === 0) {
    if (onPass) onPass(`policy/current 重叠检测通过（${result.files} 个文件，区间互补无重叠）`);
    return true;
  }

  if (onFail) {
    const lines = result.overlaps.map(
      (o) => `  - "${o.a}" [${o.aRange[0]}~${o.aRange[1]}] ↔ "${o.b}" [${o.bRange[0]}~${o.bRange[1]}]`
    );
    onFail(
      `policy/current Parquet 时间范围重叠（将导致数据翻倍）：\n${lines.join('\n')}\n` +
        `  ▶ 修复：删除冗余文件（裸名主分片+限摩=反模式），或确保剔摩↔限摩成对存在`
    );
  }
  return false;
}
