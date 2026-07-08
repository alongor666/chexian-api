/**
 * 双锁一致性检查（BACKLOG 2026-07-06-claude-151236）
 *
 * 背景：server/package.json（semver 范围）+ server/package-lock.json（npm 精确锁定，
 * VPS `npm ci` 用）+ 根/server 的 bun.lock（Bun 本地/CI 用）是「双锁体系」。PR #942 重建
 * bun.lock 时漏同步 package-lock.json，导致锁定版本与 package.json 声明范围不匹配，
 * `npm ci` 在 VPS 部署时连续失败 3 次（GitHub Actions run 28784860923、28785804360），
 * 最终 PR #943（commit c59a5058）人工修复。当时无任何自动化检查防止再次漂移。
 *
 * 本检查解析 server/package.json 的 dependencies + devDependencies，对每个依赖核对
 * server/package-lock.json（npm lockfile v2/v3，`packages['node_modules/<pkg>'].version`）
 * 里锁定的版本是否满足声明的 semver range；不满足或找不到即报错。
 *
 * 不依赖外部 semver 包（避免在 governance 脚本引入新依赖）：手写覆盖 `^`/`~`/精确版本/
 * `>=`/`<=`/`>`/`<`/`*` 这几种常见形式的最小比较器，够用即可，不做成通用 semver 引擎。
 *
 * 省份映射前后端镜像检查（BACKLOG 2026-07-07-claude-e80304）
 *
 * 多省平台（四川 SC / 山西 SX）前后端各自维护省份相关映射常量，此前仅靠人工核对：
 *   - src/shared/utils/branchDisplay.ts 的 BRANCH_LABELS
 *     ↔ server/src/config/branch-names.ts 的 BRANCH_NAMES
 *   - src/shared/config/organizations.ts 的 SX_ORGANIZATIONS / BRANCH_ORGANIZATIONS
 *     ↔ server/src/services/permission.ts 的同名常量
 * 仿 checkFilterCapabilityMirror 的 BEGIN/END 锚点模式，4 处常量定义处各自加了锚点注释
 * （BRANCH_LABELS/BRANCH_NAMES 变量名不同、周边文档注释也可能两端不同，故锚点只框住
 * 纯值域/常量体，不含差异化的文档注释），逐字比对锚点区文本。
 *
 * 从 check-governance.mjs 单体抽出（H5 行数棘轮，仿 upload-size-consistency.mjs 先例），
 * 依赖以 { rootDir, io } 注入。
 */

import fs from 'fs';
import path from 'path';

function parseSemverTriple(versionStr) {
  if (typeof versionStr !== 'string') return null;
  const m = versionStr.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemverTriple(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** 判断 lockedVersion 是否满足 declaredRange（手写最小比较器，见上方函数注释） */
function satisfiesSemverRange(declaredRange, lockedVersion) {
  if (!declaredRange) return false;
  const range = declaredRange.trim();
  if (range === '*' || range === '') return true;
  // 精确匹配（含无 operator 前缀的声明，如 DuckDB 的 "1.4.4-r.1"）优先快速通道
  if (range === lockedVersion) return true;

  const opMatch = range.match(/^(\^|~|>=|<=|>|<)?\s*(.+)$/);
  const op = opMatch ? (opMatch[1] || '') : '';
  const baseStr = opMatch ? opMatch[2] : range;
  const base = parseSemverTriple(baseStr);
  const locked = parseSemverTriple(lockedVersion);
  if (!base || !locked) return false;

  switch (op) {
    case '': {
      // 无 operator 且字符串不相等（上面已判等）→ 视为精确声明未满足
      return false;
    }
    case '^': {
      const [X, Y, Z] = base;
      let upper;
      if (X > 0) upper = [X + 1, 0, 0];
      else if (Y > 0) upper = [0, Y + 1, 0];
      else upper = [0, 0, Z + 1];
      return compareSemverTriple(locked, base) >= 0 && compareSemverTriple(locked, upper) < 0;
    }
    case '~': {
      const [X, Y] = base;
      const upper = [X, Y + 1, 0];
      return compareSemverTriple(locked, base) >= 0 && compareSemverTriple(locked, upper) < 0;
    }
    case '>=':
      return compareSemverTriple(locked, base) >= 0;
    case '<=':
      return compareSemverTriple(locked, base) <= 0;
    case '>':
      return compareSemverTriple(locked, base) > 0;
    case '<':
      return compareSemverTriple(locked, base) < 0;
    default:
      return false;
  }
}

export function checkDualLockConsistency({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查双锁一致性（server/package.json 声明范围 vs server/package-lock.json 锁定版本）...');

  const pkgJsonPath = path.join(rootDir, 'server/package.json');
  const lockPath = path.join(rootDir, 'server/package-lock.json');

  if (!fs.existsSync(pkgJsonPath) || !fs.existsSync(lockPath)) {
    error('双锁一致性检查：server/package.json 或 server/package-lock.json 缺失');
    return false;
  }

  let pkgJson;
  let lockJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch (e) {
    error(`双锁一致性检查：JSON 解析失败 — ${e.message}`);
    return false;
  }

  const declared = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.devDependencies || {}),
  };
  const lockedPackages = lockJson.packages || {};

  const problems = [];
  for (const [name, range] of Object.entries(declared)) {
    const lockKey = `node_modules/${name}`;
    const lockedEntry = lockedPackages[lockKey];
    if (!lockedEntry || !lockedEntry.version) {
      problems.push(`${name}：声明范围 "${range}"，锁文件缺失（package-lock.json 无 ${lockKey}）`);
      continue;
    }
    if (!satisfiesSemverRange(range, lockedEntry.version)) {
      problems.push(`${name}：声明范围 "${range}"，锁定版本 "${lockedEntry.version}" 不满足`);
    }
  }

  if (problems.length > 0) {
    error(`双锁一致性检查失败（${problems.length} 项依赖锁定版本与声明范围不一致）`);
    for (const p of problems) {
      console.log(`    ${p}`);
    }
    console.log('    修复：cd server && npm install 重新生成锁文件，或检查是否漏改 package.json/package-lock.json 其中一处');
    return false;
  }

  success(`双锁一致性检查通过（${Object.keys(declared).length} 个依赖锁定版本均满足声明范围）`);
  return true;
}

/**
 * 通用锚点镜像文本提取 + 对账 helper（供省份映射等前后端镜像检查复用）
 */
function extractAnchoredRegion(filePath, beginMarker, endMarker) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const begin = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (begin === -1 || end === -1 || end <= begin) return null;
  return content.slice(begin, end);
}

function compareAnchoredMirror(label, frontPath, backPath, beginMarker, endMarker, io) {
  const { error } = io;
  const front = extractAnchoredRegion(frontPath, beginMarker, endMarker);
  const back = extractAnchoredRegion(backPath, beginMarker, endMarker);

  if (front === null || back === null) {
    error(`${label}：锚点（${beginMarker}/${endMarker}）缺失或文件不存在`);
    console.log(`    前端: ${frontPath}`);
    console.log(`    后端: ${backPath}`);
    return false;
  }

  if (front !== back) {
    error(`${label}：前后端镜像不一致（锚点区必须逐字相同）`);
    const fl = front.split('\n');
    const bl = back.split('\n');
    for (let i = 0; i < Math.max(fl.length, bl.length); i++) {
      if (fl[i] !== bl[i]) {
        console.log(`    首个差异（锚点区第 ${i + 1} 行）:`);
        console.log(`      前端: ${(fl[i] ?? '<缺行>').trim()}`);
        console.log(`      后端: ${(bl[i] ?? '<缺行>').trim()}`);
        break;
      }
    }
    console.log('    修复：把改动同步到另一端镜像（两文件锚点区逐字一致）');
    return false;
  }

  return true;
}

export function checkBranchMappingMirror({ rootDir, io }) {
  const { info, success } = io;
  info('检查省份映射两端一致（BRANCH_LABELS/BRANCH_NAMES + SX_ORGANIZATIONS/BRANCH_ORGANIZATIONS 前后端镜像）...');

  const labelsFrontPath = path.join(rootDir, 'src/shared/utils/branchDisplay.ts');
  const labelsBackPath = path.join(rootDir, 'server/src/config/branch-names.ts');
  const orgFrontPath = path.join(rootDir, 'src/shared/config/organizations.ts');
  const orgBackPath = path.join(rootDir, 'server/src/services/permission.ts');

  let ok = true;
  ok = compareAnchoredMirror(
    '省份中文名映射（BRANCH_LABELS/BRANCH_NAMES）',
    labelsFrontPath, labelsBackPath,
    'BRANCH-NAME-MIRROR-BEGIN', 'BRANCH-NAME-MIRROR-END', io,
  ) && ok;
  ok = compareAnchoredMirror(
    '山西经营单元列表（SX_ORGANIZATIONS）',
    orgFrontPath, orgBackPath,
    'SX-ORG-MIRROR-BEGIN', 'SX-ORG-MIRROR-END', io,
  ) && ok;
  ok = compareAnchoredMirror(
    '分公司→机构列表（BRANCH_ORGANIZATIONS）',
    orgFrontPath, orgBackPath,
    'BRANCH-ORG-MIRROR-BEGIN', 'BRANCH-ORG-MIRROR-END', io,
  ) && ok;

  if (ok) {
    success('省份映射前后端镜像一致（3 组锚点）');
  }
  return ok;
}
