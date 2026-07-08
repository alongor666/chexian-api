/**
 * 分公司编码 ↔ 中文名映射（plan v2 Phase 0E SQL 拔硬编码用）
 *
 * **用途**：SQL 层需要展示"四川分公司汇总"等中文标签时，避免硬编码字面值；
 *          按当前用户的 branchCode 派生对应分公司中文名。
 *
 * **数据来源**：与 server/src/config/preset-users.ts 的 branchCode 字段值域对齐，
 *              与 server/src/config/field-registry/fields.json branch_code 字段定义一致。
 *
 * **当前条目**：仅 SC（四川）。SX（山西）/ ALL（系统级跨省）字段值已预留，
 *              山西上线 + 跨省汇总功能时补齐对应中文名。
 *
 * **设计要点**：
 *   - 输入 `null` / `undefined` / 未注册的 code → 返回 `'全国'` / `'全国汇总'`
 *     （兼容 0F flag off 期的"无 branch 维度"调用方）
 *   - 不在此文件硬编码业务规则（如"非营业车口径"等）— 仅做名称映射
 */

/** 分公司编码 → 省份中文名（山西 2026-06-26 cutover 上线）。governance「省份映射前后端镜像」锚点对账值域，与前端 BRANCH_LABELS 逐字一致。 */
export const BRANCH_NAMES: Record<string, string> = {
  // ── BRANCH-NAME-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
  SC: '四川',
  SX: '山西',
  // ── BRANCH-NAME-MIRROR-END ──
};

/**
 * 取分公司的省份中文名（用于 ORDER BY 字面值 / 日志标签 / 报表标题）。
 *
 * @param branchCode CHAR(2) 分公司编码，null/undefined 视为系统级跨省视角
 * @returns 省份中文名；未识别的 code 用其本身作为 fallback，避免直接抛错
 */
export function getBranchChineseName(branchCode: string | null | undefined): string {
  if (!branchCode) return '全国';
  return BRANCH_NAMES[branchCode] ?? branchCode;
}

/**
 * 取分公司的公司中文名（用于"X分公司汇总"等业务标签）。
 *
 * @param branchCode CHAR(2) 分公司编码，null/undefined 视为系统级跨省视角
 * @returns 公司中文名（如 '四川分公司'）；null/undefined → '全国汇总'
 */
export function getBranchCompanyName(branchCode: string | null | undefined): string {
  if (!branchCode) return '全国汇总';
  const provName = BRANCH_NAMES[branchCode];
  return provName ? `${provName}分公司` : `${branchCode}分公司`;
}
