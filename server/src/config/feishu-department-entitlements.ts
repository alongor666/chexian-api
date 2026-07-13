import { isValidBranchCodeFormat } from './sql-federation-policy.js';

export interface FeishuDepartmentEntitlement {
  feishuDeptId: string;
  feishuDeptName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}

export const FEISHU_DEPARTMENT_ENTITLEMENTS: readonly FeishuDepartmentEntitlement[] = [{
  feishuDeptId: 'od-395bce9db9d4acccae3e6da8d25cb672',
  feishuDeptName: '运城',
  role: 'org_user',
  organization: '运城',
  branchCode: 'SX',
}];

const ids = new Set<string>();
for (const entitlement of FEISHU_DEPARTMENT_ENTITLEMENTS) {
  if (ids.has(entitlement.feishuDeptId)) throw new Error(`重复飞书部门 ID: ${entitlement.feishuDeptId}`);
  if (!entitlement.organization) throw new Error(`飞书部门 ${entitlement.feishuDeptId} 缺 organization`);
  if (!isValidBranchCodeFormat(entitlement.branchCode)) throw new Error(`飞书部门 ${entitlement.feishuDeptId} branchCode 非法`);
  ids.add(entitlement.feishuDeptId);
}
