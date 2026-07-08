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
import { existsSync, readFileSync } from 'fs';
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
