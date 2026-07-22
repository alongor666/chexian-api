import { describe, expect, it } from 'vitest';
import { buildBranchScope } from '../branch-scope.js';

describe('buildBranchScope', () => {
  it('全国 branch_admin 暴露显式切省与合并能力', () => {
    expect(buildBranchScope({
      role: 'branch_admin',
      branchCode: 'SC',
      visibleBranches: ['SC', 'SX'],
    })).toEqual({
      defaultBranch: 'SC',
      visibleBranches: ['SC', 'SX'],
      canSwitch: true,
      canAggregateAll: true,
    });
  });

  it('单省与脏配置都回落到合法默认省', () => {
    expect(buildBranchScope({
      role: 'branch_admin',
      branchCode: 'SX',
      visibleBranches: ['sc', "X';DROP"],
    })).toEqual({
      defaultBranch: 'SX',
      visibleBranches: ['SX'],
      canSwitch: false,
      canAggregateAll: false,
    });
  });

  it('普通角色不因误配 visibleBranches 获得切省声明', () => {
    expect(buildBranchScope({
      role: 'org_user',
      branchCode: 'SC',
      visibleBranches: ['SC', 'SX'],
    })).toEqual({
      defaultBranch: 'SC',
      visibleBranches: ['SC'],
      canSwitch: false,
      canAggregateAll: false,
    });
  });
});
