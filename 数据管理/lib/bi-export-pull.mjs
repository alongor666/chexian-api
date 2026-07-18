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
import { provinceCodeFromFilename, stripProvincePrefix } from './source-file-routing.mjs';
import { parseRangePrefix, findCoveredKeys } from './range-coverage.mjs';

/** 五张报表 code 全集（上游契约的完整清单）。 */
export const REQUIRED_REPORT_CODES = Object.freeze(['01', '02', '03', '04', '05']);

/**
 * 可选报表 code（2026-07-05 用户拍板）：04 厂牌明细是低频变化的维表（"很少增量"），
 * 不作为每日发布的硬闸——缺席 / 不新鲜 / 体积异常时：告警 + 跳过分发该文件（本地保留
 * 旧维表继续服务），**不阻塞**发布与 watcher 就绪判定。实证：2026-07-05 上游 04 骤降
 * 4.1MB（前日 39MB），若作硬闸会拦住当天所有核心事实表的发布。
 */
export const OPTIONAL_REPORT_CODES = Object.freeze(['04']);

/** 硬闸 code（缺任一 = 上游断线，告警不降级）：全集减可选。 */
export const HARD_REQUIRED_CODES = Object.freeze(
  REQUIRED_REPORT_CODES.filter((c) => !OPTIONAL_REPORT_CODES.includes(c)),
);

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
 * @param {string[]} [opts.allowStaleCodes=[]] 显式豁免「mtime 非今天」的硬闸 code（应急通道，
 *   如上游某表当天没导但昨天份数据有效仍要发布）。只豁免新鲜度：字节不一致 / 体积骤降仍是 error。
 *   watcher 自动路径不透传本参数——断线闸长期不松。
 * @param {readonly string[]} [opts.requiredCodes=REQUIRED_REPORT_CODES] 本次要考虑的 code 子集
 *   （双批发布：早批 ['01','05'] / 晚批 ['02','03','04']）。不在此集内的 code 完全不校验/不分发。
 *   默认全集 → 与拆批前逐字节一致。
 * @param {readonly string[]} [opts.optionalCodes=OPTIONAL_REPORT_CODES] requiredCodes 中哪些为可选表。
 * @returns {{ok:boolean, issues:Array<{level:'error'|'warn', code:string|null, message:string}>, reports:Array<object>}}
 *   reports = 应分发的报表（硬闸 code 通过检查者 + 可选 code 完全健康者）；issues 有 error 即 ok=false。
 *   可选 code（04 厂牌）任何异常 → warn + 从 reports 剔除（跳过分发保留本地旧维表），不产生 error。
 */
export function evaluateManifestReports(manifest, {
  todayBeijing, statByName, allowStaleCodes = [],
  requiredCodes = REQUIRED_REPORT_CODES, optionalCodes = OPTIONAL_REPORT_CODES,
}) {
  const issues = [];
  const err = (code, message) => issues.push({ level: 'error', code, message });
  const warn = (code, message) => issues.push({ level: 'warn', code, message });

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.reports)) {
    err(null, 'manifest 结构非法：缺 reports 数组（上游导出可能中断）');
    return { ok: false, issues, reports: [] };
  }
  if (typeof manifest.schema !== 'string' || !manifest.schema.startsWith(MANIFEST_SCHEMA_PREFIX)) {
    err(null, `manifest schema 非预期：${manifest.schema ?? '(缺失)'}（期望前缀 ${MANIFEST_SCHEMA_PREFIX}）`);
  }

  const reports = [];
  for (const code of requiredCodes) {
    const optional = optionalCodes.includes(code);
    // 可选 code 的问题一律降 warn（告警 + 跳过分发，不阻塞）；硬闸 code 保持 error
    const report = optional ? warn : err;
    const optNote = optional ? '（可选表：跳过分发，保留本地旧维表）' : '';

    // 分省上线后，同一 code 下可能有多个省份的当前份（如 01/02/03/05 各有 SC+SX 两条）。
    // .find() 只取数组里第一条会静默丢弃后面省份的报表 —— 必须 .filter() 逐条校验+分发
    // （2026-07-06 实测：SX 排在 manifest 前面，.find() 版本导致 SC 的 01/03/05 从未被
    // 分发，ETL 每天重复处理同一份陈旧源文件却不报错）。
    const entries = manifest.reports.filter((x) => x && x.code === code);
    if (entries.length === 0) {
      report(code, `manifest 缺 code ${code}${optional ? optNote : '（上游断线兜底：当天可能缺文件，禁止默默用旧数据）'}`);
      continue;
    }
    for (const r of entries) {
      const tag = r.province ? `[${r.province}] ` : '';
      const stat = statByName?.[r.file] ?? null;
      if (!stat) {
        report(code, `code ${code} ${tag}本地文件缺失：${r.file}（rsync 未落地？）${optNote}`);
        continue;
      }
      let healthy = true;
      if (Number.isFinite(r.sizeBytes) && stat.size !== r.sizeBytes) {
        // 传输完整性问题不属于"新鲜度"，--allow-stale 不豁免
        report(code, `code ${code} ${tag}字节数不一致：本地 ${stat.size} ≠ manifest ${r.sizeBytes}（传输不完整或上游正在重写）${optNote}`);
        healthy = false;
      }
      const day = beijingDayOf(r.mtime);
      if (day !== todayBeijing) {
        if (!optional && allowStaleCodes.includes(code)) {
          warn(code, `code ${code} ${tag}mtime 停在 ${day ?? '(无效)'}（≠ 北京今天 ${todayBeijing}）——已被 --allow-stale 显式豁免，按旧份分发`);
          // 豁免：不影响 healthy，照常分发
        } else {
          report(code, `code ${code} ${tag}mtime 不是北京时间今天：${day ?? '(无效)'} ≠ ${todayBeijing}${optional ? optNote : '（上游断线，禁止默默用旧数据）'}`);
          healthy = false;
        }
      }
      const minMB = MIN_SIZE_MB_BY_CODE[code];
      if (minMB != null && Number.isFinite(r.sizeMB) && r.sizeMB < minMB) {
        report(code, `code ${code} ${tag}体积骤降：${r.sizeMB}MB < 下限 ${minMB}MB（疑似空表）${optNote}`);
        healthy = false;
      }
      // 硬闸 code：即使个别检查失败也保留在 reports 之外由 ok=false 整体拦截（原语义）；
      // 可选 code：只有完全健康才进入分发列表
      if (!optional || healthy) reports.push(r);
    }
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
 * @param {readonly string[]} [opts.requiredCodes=REQUIRED_REPORT_CODES] 本次要判就绪的 code 子集
 *   （双批发布：早批只探 ['01','05'] / 晚批只探 ['02','03','04']）。默认全集 → 与拆批前一致。
 * @param {readonly string[]} [opts.optionalCodes=OPTIONAL_REPORT_CODES] requiredCodes 中哪些为可选表。
 * @returns {{ready:boolean, issues:Array<{level:'error'|'warn', code:string|null, message:string}>, reports:Array<object>}}
 *   ready 只由硬闸 code（requiredCodes 减 optionalCodes）决定；可选 code（04 厂牌维表）异常 → warn
 *   不拦就绪（否则上游 04 偶发骤降会一直拦住核心事实表的每日发布）。
 */
export function evaluateRemoteManifest(manifest, {
  todayBeijing, requiredCodes = REQUIRED_REPORT_CODES, optionalCodes = OPTIONAL_REPORT_CODES,
}) {
  const issues = [];

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.reports)) {
    issues.push({ level: 'error', code: null, message: 'manifest 结构非法：缺 reports 数组（上游导出可能中断）' });
    return { ready: false, issues, reports: [] };
  }
  if (typeof manifest.schema !== 'string' || !manifest.schema.startsWith(MANIFEST_SCHEMA_PREFIX)) {
    issues.push({ level: 'error', code: null, message: `manifest schema 非预期：${manifest.schema ?? '(缺失)'}（期望前缀 ${MANIFEST_SCHEMA_PREFIX}）` });
  }

  const reports = [];
  for (const code of requiredCodes) {
    const optional = optionalCodes.includes(code);
    const level = optional ? 'warn' : 'error';
    const optNote = optional ? '（可选表不拦就绪）' : '';
    const push = (message) => issues.push({ level, code, message });

    // 同一 code 可能有多省份当前份（见 evaluateManifestReports 同一处修复说明），
    // 就绪判定要求该 code 下每个省份的当前份都新鲜，否则某省会被静默漏发布。
    const entries = manifest.reports.filter((x) => x && x.code === code);
    if (entries.length === 0) {
      push(`code ${code} 未出表（manifest 缺席）${optNote}`);
      continue;
    }
    for (const r of entries) {
      const tag = r.province ? `[${r.province}] ` : '';
      const day = beijingDayOf(r.mtime);
      if (day !== todayBeijing) {
        push(`code ${code} ${tag}mtime 停在 ${day ?? '(无效)'}（≠ 北京今天 ${todayBeijing}），未出今天的表${optNote}`);
        continue;
      }
      const minMB = MIN_SIZE_MB_BY_CODE[code];
      if (minMB != null && Number.isFinite(r.sizeMB) && r.sizeMB < minMB) {
        push(`code ${code} ${tag}体积骤降：${r.sizeMB}MB < 下限 ${minMB}MB（疑似空表）${optNote}`);
        continue;
      }
      reports.push(r);
    }
  }
  return { ready: !issues.some((i) => i.level === 'error'), issues, reports };
}

/**
 * 契约外「补导文件」识别（2026-07-05）：上游补导历史窗口时（实证：07-05 上午批量补导
 * shanxi_20260624~20260703 报价单日文件），manifest 只登记「当前份」，补导文件躺在
 * exports 目录（随 rsync 进 inbox）但不在 manifest.reports 里。本函数从 inbox 文件清单
 * 里挑出「符合五张表命名模式、且不是 manifest 当前份」的 xlsx，交给分发层按同规则路由。
 *
 * 命名模式（剥省前缀后）：YYYYMMDD_0X_* 或 YYYYMMDD-YYYYMMDD_0X_*（X ∈ 1..5）。
 * manifest / README 等非 xlsx、FineBI 残留（`xxx (1).xlsx`）天然排除。
 *
 * @param {string[]} inboxNames inbox 目录文件名清单
 * @param {string[]} currentFiles manifest.reports[].file 全集（含可选 code——04 当前份
 *   即使异常也必须排除，防止被当补导文件从侧门分发）
 * @param {readonly string[]} [allowedCodes=REQUIRED_REPORT_CODES] 只补导这些 code 的文件
 *   （双批发布：早批 pull 只分发 ['01','05'] 的补导文件，防止把上游昨日的 02/03 当补导误分发进早批）。
 * @returns {string[]} 应补导分发的文件名（排序稳定）
 */
export function planBackfillFiles(inboxNames, currentFiles, allowedCodes = REQUIRED_REPORT_CODES) {
  const current = new Set(currentFiles || []);
  // 只匹配 allowedCodes 里的 code，如 ['01','05'] → /_(01|05)_/。code 是两位数字，无正则元字符。
  const codeAlt = [...allowedCodes].join('|');
  const PATTERN = new RegExp(`^\\d{8}(-\\d{8})?_(${codeAlt})_.+\\.xlsx$`, 'i');
  return (inboxNames || [])
    .filter((n) => /\.xlsx$/i.test(n))
    .filter((n) => !/\s?\(\d+\)\.xlsx$/i.test(n)) // 浏览器重复下载残留不入 ETL（与 daily.mjs ls() 同规则）
    .filter((n) => !current.has(n))
    .filter((n) => PATTERN.test(stripProvincePrefix(n)))
    .sort();
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
