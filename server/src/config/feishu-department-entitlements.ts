import fs from 'fs/promises';
import { isValidBranchCodeFormat } from './sql-federation-policy.js';
import { getFeishuDepartmentEntitlementsPath } from './paths.js';

export interface FeishuDepartmentEntitlement {
  feishuDeptId: string;
  feishuDeptName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}

/**
 * 角色特权等级表：数字越大权限越宽。一人挂多个飞书部门授权时，命中多条须按「最小权限」原则
 * 确定性选择，而非并集/升权（用户决议：多部门命中禁止升权，唯一例外走个人映射条目，不硬编码人名）。
 * 当前 FEISHU_DEPARTMENT_ENTITLEMENT.role 只有 'org_user' 一种取值，故本表暂只登记一档；
 * 未来若新增更宽角色（如 branch_admin），追加更高数字即可，选择时等级更高者排后（不被优先选中）。
 */
const ROLE_PRIVILEGE_RANK: Readonly<Record<string, number>> = {
  org_user: 0,
};

/**
 * 从「同一用户命中的多条部门授权」里，按确定性规则选出权限最小的一条：
 *   1. 先按角色特权等级升序（等级越低越靠前）；
 *   2. 同级再按 organization 字符串码点序（`<` / `>`，非 localeCompare——避免不同运行环境 ICU
 *      排序规则差异导致同一输入在不同机器上选出不同结果）。
 * 取排序后第一条。调用方须保证 matches 非空。
 */
export function selectMinimalPrivilegeEntitlement(
  matches: readonly FeishuDepartmentEntitlement[]
): FeishuDepartmentEntitlement {
  return [...matches].sort((a, b) => {
    const rankDiff = (ROLE_PRIVILEGE_RANK[a.role] ?? 0) - (ROLE_PRIVILEGE_RANK[b.role] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    if (a.organization < b.organization) return -1;
    if (a.organization > b.organization) return 1;
    return 0;
  })[0];
}

/**
 * 内置默认部门授权表（零配置兜底）。
 *
 * 这是当**外置配置文件缺失/损坏时**的回退值，等同历史硬编码行为——保证不下发配置文件的
 * 部署（如现网）行为逐项不变。运维如需「新增授权部门零代码」，改走外置文件
 * `server/data/feishu_department_entitlements.json`（见 `loadFeishuDepartmentEntitlements`），
 * 文件一旦存在即**整体接管**本默认表（非合并），种子模板见 `.example` 同名文件。
 */
export const DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS: readonly FeishuDepartmentEntitlement[] = [{
  feishuDeptId: 'od-395bce9db9d4acccae3e6da8d25cb672',
  feishuDeptName: '运城',
  role: 'org_user',
  organization: '运城',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-521363a381f03a6dc7ee461cfd75fa12',
  feishuDeptName: '山分太原二部',
  role: 'org_user',
  organization: '太原二部',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-336028184fa1502690f3cdc3cf0cf17a',
  feishuDeptName: '山分太原一部',
  role: 'org_user',
  organization: '太原一部',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-ba07fad3b10056e77bfd584510457b14',
  feishuDeptName: '长治',
  role: 'org_user',
  organization: '长治',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-d92eee7e7babaf79e9d93b214b0edcee',
  feishuDeptName: '晋中',
  role: 'org_user',
  organization: '晋中',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-ef349a270ef1a78c693fa0e9c70374b1',
  feishuDeptName: '阳泉',
  role: 'org_user',
  organization: '阳泉',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-bf9eb7a081b2f45a9ff9ea0970537491',
  feishuDeptName: '晋城',
  role: 'org_user',
  organization: '晋城',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-e16b27d0cdb8f1e11165f53fb183bfe8',
  feishuDeptName: '大同',
  role: 'org_user',
  organization: '大同',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-8e26a9b703f7976f4590970af4564a51',
  feishuDeptName: '临汾',
  role: 'org_user',
  organization: '临汾',
  branchCode: 'SX',
}, {
  feishuDeptId: 'od-3dca758a46522d5cc57d481c5c4e0bc8',
  feishuDeptName: '吕梁',
  role: 'org_user',
  organization: '吕梁',
  branchCode: 'SX',
}];

// 编译期不变量：内置默认表本身必须永远合法（部门 ID 唯一 + organization 非空 + branchCode 合法格式）。
// 这是回退兜底的正确性底线，任何对上方 DEFAULT 表的改动若违反此约束，模块加载即抛错、fail-fast。
{
  const ids = new Set<string>();
  for (const entitlement of DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS) {
    if (ids.has(entitlement.feishuDeptId)) throw new Error(`重复飞书部门 ID: ${entitlement.feishuDeptId}`);
    if (!entitlement.organization) throw new Error(`飞书部门 ${entitlement.feishuDeptId} 缺 organization`);
    if (!isValidBranchCodeFormat(entitlement.branchCode)) throw new Error(`飞书部门 ${entitlement.feishuDeptId} branchCode 非法`);
    ids.add(entitlement.feishuDeptId);
  }
}

/** 合法角色取值集合（唯一事实源 = ROLE_PRIVILEGE_RANK 的键；新增角色时只需扩充特权表）。 */
const VALID_ROLES: ReadonlySet<string> = new Set(Object.keys(ROLE_PRIVILEGE_RANK));

/**
 * 校验并清洗「外部来源」的部门授权数组（如运维下发的配置文件解析结果）。
 *
 * 逐条 fail-closed：非法条目**跳过并中文告警**，不阻断其余合法条目，也不静默回退默认表——
 * 这样配置文件里写错一条不会连累全部授权，但错误条目绝不会被当合法授权放行（避免误授权/错省）。
 * 校验维度：字段齐全 + role 合法 + organization 非空 + branchCode 合法格式（复用权威格式校验器，
 * 禁硬编码省清单）+ feishuDeptId 全局唯一（重复者跳过后出现的，按先到先得保留首条）。
 */
export function validateDepartmentEntitlements(raw: unknown): FeishuDepartmentEntitlement[] {
  if (!Array.isArray(raw)) {
    console.warn('[FeishuDeptEntitlements] 配置的 entitlements 非数组，忽略');
    return [];
  }
  const ids = new Set<string>();
  const cleaned: FeishuDepartmentEntitlement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      console.warn('[FeishuDeptEntitlements] 存在非对象条目，已跳过');
      continue;
    }
    const { feishuDeptId, feishuDeptName, role, organization, branchCode } = item as Record<string, unknown>;
    if (typeof feishuDeptId !== 'string' || !feishuDeptId) {
      console.warn('[FeishuDeptEntitlements] 条目缺 feishuDeptId，已跳过');
      continue;
    }
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      console.warn(`[FeishuDeptEntitlements] 部门 ${feishuDeptId} role='${String(role)}' 非法（合法值：${[...VALID_ROLES].join('/')}），已跳过`);
      continue;
    }
    if (typeof organization !== 'string' || !organization) {
      console.warn(`[FeishuDeptEntitlements] 部门 ${feishuDeptId} 缺 organization，已跳过`);
      continue;
    }
    if (typeof branchCode !== 'string' || !isValidBranchCodeFormat(branchCode)) {
      console.warn(`[FeishuDeptEntitlements] 部门 ${feishuDeptId} branchCode='${String(branchCode)}' 格式非法（须 CHAR(2) 大写字母），已跳过`);
      continue;
    }
    if (ids.has(feishuDeptId)) {
      console.warn(`[FeishuDeptEntitlements] 部门 ${feishuDeptId} 重复，已跳过（保留首条）`);
      continue;
    }
    ids.add(feishuDeptId);
    cleaned.push({
      feishuDeptId,
      feishuDeptName: typeof feishuDeptName === 'string' ? feishuDeptName : feishuDeptId,
      role: role as FeishuDepartmentEntitlement['role'], // 已过 VALID_ROLES 校验，透传而非硬编码（未来加角色不需改此处）
      organization,
      branchCode,
    });
  }
  return cleaned;
}

/**
 * 加载部门授权（外置配置文件优先，缺文件回退内置默认表）。
 *
 * - 文件不存在（ENOENT）：回退 `DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS`——保证零配置部署行为不变。
 * - 文件存在但 JSON 解析失败：回退默认表 + 中文告警——避免一次坏下发就把现网合法授权全部清空。
 * - 文件存在且解析成功：走 `validateDepartmentEntitlements` 清洗，**整体接管**默认表（非合并）；
 *   即便清洗后为空数组也按配置为准（运维显式提供文件 = 显式意图），fail-closed 不再回退默认。
 *
 * 每次调用实时读盘（与角色映射文件 loadRoleMapping 一致），便于运维改文件后无需重启即生效。
 * 配置根结构：`{ "entitlements": [ ... ] }`。
 */
export async function loadFeishuDepartmentEntitlements(): Promise<readonly FeishuDepartmentEntitlement[]> {
  const filePath = getFeishuDepartmentEntitlementsPath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[FeishuDeptEntitlements] 配置读取失败（${filePath}）：${error?.message}，回退内置默认表`);
    }
    return DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS;
  }
  try {
    const root = JSON.parse(raw);
    return validateDepartmentEntitlements(root?.entitlements);
  } catch (error: any) {
    console.warn(`[FeishuDeptEntitlements] 配置 JSON 解析失败（${filePath}）：${error?.message}，回退内置默认表`);
    return DEFAULT_FEISHU_DEPARTMENT_ENTITLEMENTS;
  }
}
