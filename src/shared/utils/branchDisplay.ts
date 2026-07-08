/**
 * 省份显示派生 — 前端单一事实源
 *
 * 平台从四川单省演进到多省（SC=四川 / SX=山西）。任何 UI 要展示「当前用户的省份名 /
 * 分公司名」都从这里派生，禁止再硬编码「四川」字面值。
 *
 * **前后端镜像约束**：本文件的 BRANCH_LABELS 与后端 server/src/config/branch-names.ts 的
 * BRANCH_NAMES 是同一份省份码→中文名映射的两端（前端禁 import server，故镜像）。
 * 新增省份时两处必须同步（branch-names.test.ts 锁后端、本文件单测锁前端）。
 *
 * 纯函数设计：核心派生逻辑（branchLabel/branchCompanyName/resolveEffectiveBranch/
 * isBranchSummaryRow）全为纯函数，可脱离 React Context 直接单测；BranchContext 仅做 wiring。
 */

/** 省份码 → 中文省名（与后端 BRANCH_NAMES 一致；新省两处同步）。governance「省份映射前后端镜像」锚点对账值域。 */
export const BRANCH_LABELS: Record<string, string> = {
  // ── BRANCH-NAME-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
  SC: '四川',
  SX: '山西',
  // ── BRANCH-NAME-MIRROR-END ──
};

/** 通用汇总行关键字（与省份无关，全国统一） */
const GENERIC_SUMMARY_KEYWORDS = ['合计', '汇总', '全部', '整体'] as const;

/**
 * 省份码 → 中文省名。
 * - null / undefined / 'ALL' → '全国'
 * - 未注册码 → 回落码本身（禁臆造）
 */
export function branchLabel(code: string | null | undefined): string {
  if (!code || code === 'ALL') return '全国';
  return BRANCH_LABELS[code] ?? code;
}

/**
 * 省份码 → 「X分公司」业务标签（语义对齐后端 getBranchCompanyName）。
 * - null / undefined / 'ALL' → '全国汇总'
 * - 未注册码 → `${code}分公司`（兜底）
 */
export function branchCompanyName(code: string | null | undefined): string {
  if (!code || code === 'ALL') return '全国汇总';
  const name = BRANCH_LABELS[code];
  return name ? `${name}分公司` : `${code}分公司`;
}

/**
 * 解析「当前有效省」。优先级：超管显式切省 > 用户本省 > 单可见省兜底 > null。
 *
 * 字节安全：四川用户 branchCode='SC' → 返回 'SC'（与改动前硬编码「四川分公司」一致）。
 * 兜底链覆盖 branchCode 漏配但 visibleBranches 单省的历史用户（codex 闸-1 P0-1）。
 *
 * @returns 省份码（'SC'/'SX'/'ALL'…）或 null（无法确定省，如系统超管看全部）
 */
export function resolveEffectiveBranch(opts: {
  /** 超管显式切省值（含 'ALL'），普通用户为 null */
  selectedBranch?: string | null;
  /** 用户本省 branchCode */
  branchCode?: string | null;
  /** 可见省集合（visibleBranches） */
  branches?: readonly string[];
}): string | null {
  const { selectedBranch, branchCode, branches = [] } = opts;
  if (selectedBranch) return selectedBranch;
  if (branchCode) return branchCode;
  if (branches.length === 1) return branches[0];
  return null;
}

/** 所有已知省的分公司名（四川分公司/山西分公司/…）+ 全国汇总，用于汇总行识别（不依赖当前省） */
const KNOWN_SUMMARY_NAMES: ReadonlySet<string> = new Set<string>([
  '全国汇总',
  ...Object.keys(BRANCH_LABELS).map((code) => branchCompanyName(code)),
]);

/**
 * 判断某行名是否为「汇总行」（用于表格置顶/置底/高亮）。
 *
 * 识别口径（精确匹配，非「含『分公司』」通配，避免把名为「XX分公司」的真实机构误判 — codex 闸-1 P1）：
 * 1. 等于显式传入的当前省分公司名 companyName（可选，最精确）
 * 2. 等于任一已知省分公司名（四川分公司/山西分公司）或「全国汇总」
 *    —— 覆盖全国超管 ALL 视角的多省汇总行；单省用户因 RLS 隔离只会出现本省汇总行，故等价于精确匹配
 * 3. 含通用汇总关键字（合计/汇总/全部/整体）
 *
 * @param name 行名（机构名 / 汇总行名）
 * @param companyName 可选，当前省分公司名（显式精确匹配；省略则靠已知省集合 + 通用关键字）
 */
export function isBranchSummaryRow(
  name: string | null | undefined,
  companyName = '',
): boolean {
  const n = name ?? '';
  if (!n) return false;
  if (companyName && n === companyName) return true;
  if (KNOWN_SUMMARY_NAMES.has(n)) return true;
  return GENERIC_SUMMARY_KEYWORDS.some((kw) => n.includes(kw));
}
