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

const ids = new Set<string>();
for (const entitlement of FEISHU_DEPARTMENT_ENTITLEMENTS) {
  if (ids.has(entitlement.feishuDeptId)) throw new Error(`重复飞书部门 ID: ${entitlement.feishuDeptId}`);
  if (!entitlement.organization) throw new Error(`飞书部门 ${entitlement.feishuDeptId} 缺 organization`);
  if (!isValidBranchCodeFormat(entitlement.branchCode)) throw new Error(`飞书部门 ${entitlement.feishuDeptId} branchCode 非法`);
  ids.add(entitlement.feishuDeptId);
}
