/**
 * 机构级短中长期报告的机构清单读取（B004 生成端 · 纯函数层）。
 *
 * SSOT = 数据管理/config/branch-org-mapping/<branchCode>.json 的 `units`
 * （与缺口清单 B004 约定一致；SX 该文件同时是 ETL 机构归一化映射，SC 仅作清单）。
 * daily.mjs 第 9 步按本清单循环调用 diagnose-period-trend skill
 * `--org <unit> --branch <branchCode>`，产物落
 * public/reports/diagnose-period-trend/orgs/<branchCode>/<unit>/
 * （与 server/src/routes/reports.ts parseStaticReportOwner 授权 schema 对齐）。
 *
 * fail-closed：branchCode 非 ^[A-Z]{2}$ 抛错；SSOT 文件缺失返回 null（调用方
 * 告警跳过机构级、不臆造清单）；units 缺失/为空/含非法值（非字符串、空串、
 * 路径字符）抛错——SSOT 坏了要响，不静默吞。
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** branch 段 schema，与 parseStaticReportOwner / gen-reports-manifest 三方对齐 */
export const BRANCH_CODE_RE = /^[A-Z]{2}$/;

/**
 * 判定 diagnose-period-trend skill CLI 是否支持机构级参数（`--org`，v2.3.0+）。
 * 输入是 `cli.py --help` 的输出文本；不支持时 daily.mjs 须**显式红字告警**并跳过
 * 机构级循环——B346 治理教训：skill 版本落后时逐机构 spawn 静默失败（仅黄字
 * 每机构一条 warn），机构版 HTML 长期缺席却无人察觉。
 * @param {string} helpText - `cli.py --help` 的 stdout+stderr
 * @returns {boolean}
 */
export function skillSupportsOrgFlag(helpText) {
  // (?![\w-]) 拒绝 --organization / --org-x 等相似 flag 误判
  return typeof helpText === 'string' && /(^|[\s[])--org(?![\w-])/.test(helpText);
}

/**
 * 解析 SKILL.md frontmatter 的 `version: "X.Y.Z"`。
 * @param {string} skillMdText - SKILL.md 全文
 * @returns {{major:number,minor:number,patch:number}|null} 解析失败返回 null
 */
export function parseSkillVersion(skillMdText) {
  if (typeof skillMdText !== 'string') return null;
  const m = /^version:\s*"?(\d+)\.(\d+)\.(\d+)"?/m.exec(skillMdText);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * 判定 skill 是否支持「仅 `--branch`（无 `--org`）」省级分省报告模式（v2.5.0+）。
 *
 * 为什么用版本而非 `--help` 探测（区别于 skillSupportsOrgFlag）：v2.4 与 v2.5 的 `--help`
 * 都列出 `--branch`，但 v2.4 在**运行时**拒绝「仅 --branch」（`--org 与 --branch 必须成对`），
 * help 文本无法区分二者的配对行为。若沿用 help 探测，v2.4 会通过探测、却在 `--branch SX`
 * 调用时被拒 → fail-warn 湮没 → `branches/SX/` 恒不产出 → SX 分公司管理员持续 404（静默降级）。
 * 故省级分省能力以 SKILL.md 版本作**可执行发布契约**判据（每次 daily/report 运行强制核验）。
 * @param {{major:number,minor:number,patch:number}|null} version - parseSkillVersion 结果
 * @returns {boolean}
 */
export function skillSupportsBranchOnlyMode(version) {
  if (!version || typeof version.major !== 'number' || typeof version.minor !== 'number') {
    return false;
  }
  return version.major > 2 || (version.major === 2 && version.minor >= 5);
}

/**
 * report 独立发布入口是否必须停止 VPS 同步。
 * 能力闸未通过或任一非部署省省级报告生成失败时，继续同步会把缺失/陈旧的
 * branches/<省>/ 产物上线，导致该省分公司管理员继续 404。
 * @param {{provinceContractFailed?: boolean, provinceGenFailures?: string[]}|undefined} result
 * @returns {boolean}
 */
export function shouldAbortReportSync(result) {
  return result?.provinceContractFailed === true
    || (Array.isArray(result?.provinceGenFailures) && result.provinceGenFailures.length > 0);
}

/**
 * 枚举已注册省份（数据驱动，禁硬编码 SC/SX）：扫描 branch-org-mapping/ 下
 * 形如 <两位大写>.json 的文件名。新省上线只需落一份 <branch>.json，
 * daily.mjs 机构级报告循环即自动覆盖，零代码改动。
 * @param {string} configDir - 数据管理/config 目录绝对路径
 * @returns {string[]} 已排序省份码；目录不存在 → []
 */
export function listBranchOrgMappingCodes(configDir) {
  const dir = join(configDir, 'branch-org-mapping');
  if (!existsSync(dir)) return [];
  const codes = [];
  for (const name of readdirSync(dir)) {
    const m = /^([A-Z]{2})\.json$/.exec(name);
    if (m) codes.push(m[1]);
  }
  return codes.sort();
}

/**
 * 从省级产物文件名中选出「最新一期 cutoff」的文件组（纯函数）。
 * daily.mjs 据此把根目录省级报告镜像到 branches/<部署省>/ ——
 * 根目录 legacy 布局不携带省份身份，镜像后门户可按 branch_admin 的省份取数
 * （B346：单省山西管理员不得读到四川省级报告）。
 * @param {string[]} fileNames - slug 根目录文件名列表
 * @returns {{ date: string, files: string[] } | null} 无匹配 → null
 */
export function planProvinceMirror(fileNames) {
  const byDate = new Map();
  for (const name of fileNames ?? []) {
    const m = /^(\d{4}-\d{2}-\d{2})(-.*)?\.html?$/i.exec(name);
    if (!m) continue;
    const arr = byDate.get(m[1]) ?? [];
    arr.push(name);
    byDate.set(m[1], arr);
  }
  if (byDate.size === 0) return null;
  const date = [...byDate.keys()].sort().at(-1);
  return { date, files: [...byDate.get(date)].sort() };
}

/**
 * 读取机构清单。
 * @param {string} configDir - 数据管理/config 目录绝对路径
 * @param {string} branchCode - 两位大写分公司码（SC/SX）
 * @returns {string[] | null} 机构清单；SSOT 文件不存在 → null
 */
export function readBranchOrgUnits(configDir, branchCode) {
  if (!BRANCH_CODE_RE.test(branchCode ?? '')) {
    throw new Error(`branchCode '${branchCode}' 非法（须两位大写字母，如 SC/SX）`);
  }
  const mappingPath = join(configDir, 'branch-org-mapping', `${branchCode}.json`);
  if (!existsSync(mappingPath)) {
    return null;
  }
  const cfg = JSON.parse(readFileSync(mappingPath, 'utf-8'));
  const units = cfg?.units;
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error(`${mappingPath} 的 units 缺失或为空（机构清单 SSOT 损坏）`);
  }
  for (const u of units) {
    if (typeof u !== 'string' || !u.trim() || /[/\\\0]|\.\./.test(u)) {
      throw new Error(`${mappingPath} 的 units 含非法机构名：${JSON.stringify(u)}`);
    }
  }
  return units;
}
