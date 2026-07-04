/**
 * 上游 BI 导出（VPS auto_loadbi）拉取管道纯函数 — manifest 校验 / 省份路由 / 覆盖归档规划
 *
 * 背景：上游源头从「用户手动下载 BI xlsx → iCloud → 拷 数据管理/」切换为
 * 「VPS /root/workspace/auto_loadbi/exports/ 定时导出 + latest-manifest.json 契约」。
 * 下游唯一稳定契约 = 读 manifest 按 code 取当前份（文件名日期后缀每天变，禁止硬编文件名）。
 *
 * 契约要点（与 VPS 侧 README-for-etl.md 对齐）：
 *   - reports[].code：01 签单 / 02 报价 / 03 维修资源 / 04 厂牌明细（全国口径无省前缀）/ 05 理赔
 *   - mtime 判新鲜度：不是「北京时间今天」= 上游断线，必须告警，禁止默默用旧数据
 *   - sizeMB 兜异常：骤降 = 疑似空表
 *   - 文件名 shanxi_/sichuan_ 前缀是导出脚本配置标签（PROVINCE 常量），不自动跟登录账号；
 *     省份强校验须从数据内容核验（保单号前缀 → fields.json branch_code.derivation.mapping），
 *     manifest.province 只是声明值
 *
 * ⚠️ mtime 时区陷阱：manifest mtime 是真 UTC；本机时钟不一定在北京时区，
 * 判「是否今天」必须换算 Asia/Shanghai 再比，禁止直接用本地 Date 的日期。
 *
 * 无副作用、不读文件系统 / env / 网络，可被 vitest 直接 import。
 * 副作用编排（rsync / 抽样 / 分发落盘）在 scripts/pull-bi-exports.mjs。
 */
import { provinceCodeFromFilename } from './source-file-routing.mjs';
import { parseRangePrefix, findCoveredKeys } from './range-coverage.mjs';

/** 五张报表 code 全集（manifest 缺任一 = 上游断线，告警不降级）。 */
export const REQUIRED_REPORT_CODES = Object.freeze(['01', '02', '03', '04', '05']);

/**
 * 各 code 体积下限（MB）——「突然变很小 = 疑似空表」兜底。
 * 参照 2026-07-04 实测：01≈69.5 / 02≈4.3 / 03≈6.6 / 04≈39 / 05≈12.1，
 * 下限取典型值的 10%~30%，只拦骤降不拦正常波动（02 报价单日量随业务波动，下限最宽）。
 */
export const MIN_SIZE_MB_BY_CODE = Object.freeze({
  '01': 10,
  '02': 0.2,
  '03': 1,
  '04': 5,
  '05': 2,
});

/** manifest schema 前缀（版本号可演进，主版本兼容判断交给上游）。 */
export const MANIFEST_SCHEMA_PREFIX = 'sinosafe-bi-export/manifest@';

/**
 * 把任意时间值换算成北京时区的日历日（YYYY-MM-DD）。
 * sv-SE locale 的日期串即 ISO 格式；无效时间返回 null（调用方按校验失败处理）。
 * @param {string|number|Date} value
 * @returns {string|null}
 */
export function beijingDayOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/**
 * 校验 manifest + 本地落地文件（rsync 之后调用）。纯函数：文件系统状态由调用方注入。
 *
 * @param {object} manifest 解析后的 latest-manifest.json
 * @param {object} opts
 * @param {string} opts.todayBeijing 北京时区今天（YYYY-MM-DD），调用方用 beijingDayOf(new Date()) 求得
 * @param {Record<string, {size:number}|null>} opts.statByName 文件名 → 本地 stat（不存在传 null/缺键）
 * @returns {{ok:boolean, issues:Array<{level:'error'|'warn', code:string|null, message:string}>, reports:Array<object>}}
 *   reports 仅含通过「存在性」检查的必需 code 报表（供后续分发）；issues 有 error 即 ok=false。
 */
export function evaluateManifestReports(manifest, { todayBeijing, statByName }) {
  const issues = [];
  const err = (code, message) => issues.push({ level: 'error', code, message });

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.reports)) {
    err(null, 'manifest 结构非法：缺 reports 数组（上游导出可能中断）');
    return { ok: false, issues, reports: [] };
  }
  if (typeof manifest.schema !== 'string' || !manifest.schema.startsWith(MANIFEST_SCHEMA_PREFIX)) {
    err(null, `manifest schema 非预期：${manifest.schema ?? '(缺失)'}（期望前缀 ${MANIFEST_SCHEMA_PREFIX}）`);
  }

  const reports = [];
  for (const code of REQUIRED_REPORT_CODES) {
    const r = manifest.reports.find((x) => x && x.code === code);
    if (!r) {
      err(code, `manifest 缺 code ${code}（上游断线兜底：当天可能缺文件，禁止默默用旧数据）`);
      continue;
    }
    const stat = statByName?.[r.file] ?? null;
    if (!stat) {
      err(code, `code ${code} 本地文件缺失：${r.file}（rsync 未落地？）`);
      continue;
    }
    if (Number.isFinite(r.sizeBytes) && stat.size !== r.sizeBytes) {
      err(code, `code ${code} 字节数不一致：本地 ${stat.size} ≠ manifest ${r.sizeBytes}（传输不完整或上游正在重写）`);
    }
    const day = beijingDayOf(r.mtime);
    if (day !== todayBeijing) {
      err(code, `code ${code} mtime 不是北京时间今天：${day ?? '(无效)'} ≠ ${todayBeijing}（上游断线，禁止默默用旧数据）`);
    }
    const minMB = MIN_SIZE_MB_BY_CODE[code];
    if (minMB != null && Number.isFinite(r.sizeMB) && r.sizeMB < minMB) {
      err(code, `code ${code} 体积骤降：${r.sizeMB}MB < 下限 ${minMB}MB（疑似空表）`);
    }
    reports.push(r);
  }

  return { ok: !issues.some((i) => i.level === 'error'), issues, reports };
}

/**
 * 远程就绪探测校验（auto-release watcher 用）：只看 manifest 本身，不比对本地文件。
 * 用于「ssh 只读 manifest 判五张是否齐全」的轻量轮询——避免每次轮询都 rsync 135MB；
 * 就绪后真正拉取仍走 evaluateManifestReports（含本地字节比对，兜传输完整性）。
 *
 * @param {object} manifest 解析后的 latest-manifest.json
 * @param {object} opts
 * @param {string} opts.todayBeijing 北京时区今天（YYYY-MM-DD）
 * @returns {{ready:boolean, issues:Array<{level:'error', code:string|null, message:string}>, reports:Array<object>}}
 */
export function evaluateRemoteManifest(manifest, { todayBeijing }) {
  const issues = [];
  const err = (code, message) => issues.push({ level: 'error', code, message });

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.reports)) {
    err(null, 'manifest 结构非法：缺 reports 数组（上游导出可能中断）');
    return { ready: false, issues, reports: [] };
  }
  if (typeof manifest.schema !== 'string' || !manifest.schema.startsWith(MANIFEST_SCHEMA_PREFIX)) {
    err(null, `manifest schema 非预期：${manifest.schema ?? '(缺失)'}（期望前缀 ${MANIFEST_SCHEMA_PREFIX}）`);
  }

  const reports = [];
  for (const code of REQUIRED_REPORT_CODES) {
    const r = manifest.reports.find((x) => x && x.code === code);
    if (!r) {
      err(code, `code ${code} 未出表（manifest 缺席）`);
      continue;
    }
    const day = beijingDayOf(r.mtime);
    if (day !== todayBeijing) {
      err(code, `code ${code} mtime 停在 ${day ?? '(无效)'}（≠ 北京今天 ${todayBeijing}），未出今天的表`);
      continue;
    }
    const minMB = MIN_SIZE_MB_BY_CODE[code];
    if (minMB != null && Number.isFinite(r.sizeMB) && r.sizeMB < minMB) {
      err(code, `code ${code} 体积骤降：${r.sizeMB}MB < 下限 ${minMB}MB（疑似空表）`);
      continue;
    }
    reports.push(r);
  }
  return { ready: issues.length === 0, issues, reports };
}

/**
 * 按文件名前缀路由目标省份：shanxi_→SX、sichuan_→SC、无前缀→SC（含 04 厂牌全国口径）。
 * 目标目录由调用方用 branchSourceDir(数据管理目录, code) 求得（SC=根目录 / 其余=staging/<省>）。
 * @param {string} name
 * @returns {string} branch_code（CHAR(2)）
 */
export function routeBranchCode(name) {
  return provinceCodeFromFilename(name) ?? 'SC';
}

/**
 * 从保单号抽样派生数据真实省份（防「换账号没改配置」的前缀错配）。
 * @param {string[]} samples 保单号抽样值
 * @param {Record<string,string>} mapping fields.json branch_code.derivation.mapping（如 {"610":"SC","618":"SX"}）
 * @param {number} [prefixLength=3] fields.json derivation.prefixLength
 * @returns {{code:string|null, consistent:boolean, counts:Record<string,number>, unknownPrefixes:Record<string,number>, sampled:number}}
 *   consistent = 恰好一个已注册省 && 无未知前缀 && 样本非空
 */
export function derivePolicyProvince(samples, mapping, prefixLength = 3) {
  const counts = {};
  const unknownPrefixes = {};
  let sampled = 0;
  for (const raw of samples || []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    sampled += 1;
    const prefix = s.slice(0, prefixLength);
    const code = mapping?.[prefix];
    if (code) counts[code] = (counts[code] || 0) + 1;
    else unknownPrefixes[prefix] = (unknownPrefixes[prefix] || 0) + 1;
  }
  const codes = Object.keys(counts);
  const consistent = sampled > 0 && codes.length === 1 && Object.keys(unknownPrefixes).length === 0;
  return { code: consistent ? codes[0] : null, consistent, counts, unknownPrefixes, sampled };
}

/**
 * 分发落盘前的「区间覆盖归档」规划：目标目录里被新文件同品类严格覆盖的旧范围 xlsx 应归档，
 * 防止 multi_file_merge 域（如 03 维修资源）源文件无限堆积、每日全量重转越来越慢。
 * 复用 range-coverage 纯函数：仅同 qualifier 互斥（剔摩/限摩、不同命名系列天然不互相归档）；
 * 非范围命名（单日 02 报价、legacy 文件）parseRangePrefix 返回 null，不参与归档。
 * daily.mjs 自身的 premium / claims 覆盖归档护栏保持不变，本规划是分发层的前置减负。
 *
 * @param {string} incomingName 新文件名
 * @param {string[]} existingNames 目标目录现有 xlsx 文件名
 * @returns {{archive:string[], incomingRedundant:boolean}}
 *   incomingRedundant=true 表示目录中已有同区间同品类且字典序更大的文件（新文件无需落盘）。
 */
export function planCoverageArchive(incomingName, existingNames) {
  const incoming = parseRangePrefix(incomingName);
  if (!incoming) return { archive: [], incomingRedundant: false };
  const items = [{ key: incomingName, ...incoming }];
  for (const name of existingNames || []) {
    if (name === incomingName) continue;
    const parsed = parseRangePrefix(name);
    if (parsed) items.push({ key: name, ...parsed });
  }
  const losers = findCoveredKeys(items);
  return {
    archive: [...losers].filter((k) => k !== incomingName),
    incomingRedundant: losers.has(incomingName),
  };
}
