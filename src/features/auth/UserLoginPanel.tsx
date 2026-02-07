import React, { useState } from 'react';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { UserRole } from '../../shared/config/organizations';
import {
  LogOut,
  Shield,
  Building,
  User,
  ChevronDown,
  Check,
} from 'lucide-react';

/**
 * @deprecated 用户身份已迁移到侧边栏底部 SidebarUserPanel 组件。
 * 此组件保留但不再被首页引用，后续可安全删除。
 *
 * 用户登录面板（原首页右侧栏）
 *
 * 功能：
 * - 显示当前登录用户
 * - 用户切换（开发模式）
 * - 登出
 * - 显示用户权限信息
 */
export const UserLoginPanel: React.FC = () => {
  const {
    userPermission,
    isAuthenticated,
    login,
    logout,
    isBranchAdmin,
    isOrgUser,
  } = usePermission();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // 预定义用户列表（用于快速切换）
  const quickUsers = [
    { username: 'admin', displayName: '系统管理员', role: UserRole.BRANCH_ADMIN, icon: Shield },
    { username: 'leshan', displayName: '乐山机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'tianfu', displayName: '天府机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'yibin', displayName: '宜宾机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'deyang', displayName: '德阳机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'xindu', displayName: '新都机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'wuhou', displayName: '武侯机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'luzhou', displayName: '泸州机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'zigong', displayName: '自贡机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'ziyang', displayName: '资阳机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'dazhou', displayName: '达州机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'qingyang', displayName: '青羊机构', role: UserRole.ORG_USER, icon: Building },
    { username: 'gaoxin', displayName: '高新机构', role: UserRole.ORG_USER, icon: Building },
  ];

  const handleLogin = (username: string) => {
    login(username);
    setIsDropdownOpen(false);
  };

  const handleLogout = () => {
    logout();
    setIsDropdownOpen(false);
  };

  // 获取角色显示名称
  const getRoleDisplayName = () => {
    if (isBranchAdmin) return '分公司管理员';
    if (isOrgUser) return '三级机构用户';
    return '未登录';
  };

  // 获取角色显示样式
  const getRoleBadgeClass = () => {
    if (isBranchAdmin) return 'bg-purple-100 text-purple-700';
    if (isOrgUser) return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center">
        <User size={16} className="mr-2 text-gray-500" aria-hidden="true" />
        用户身份
      </h3>

      {/* 当前用户信息 */}
      {isAuthenticated ? (
        <div className="space-y-3">
          {/* 用户卡片 */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center">
              {isBranchAdmin ? (
                <Shield size={24} className="text-purple-500 mr-3" aria-hidden="true" />
              ) : (
                <Building size={24} className="text-blue-500 mr-3" aria-hidden="true" />
              )}
              <div>
                <p className="font-medium text-gray-800">{userPermission?.displayName}</p>
                <p className="text-sm text-gray-500">@{userPermission?.username}</p>
              </div>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${getRoleBadgeClass()}`}>
              {getRoleDisplayName()}
            </span>
          </div>

          {/* 权限说明 */}
          <div className="text-sm text-gray-600 bg-blue-50 rounded-lg p-3">
            <p className="font-medium text-blue-800 mb-1">数据访问权限</p>
            <p className="text-blue-700">
              {isBranchAdmin
                ? '✓ 可查看所有机构数据'
                : `✓ 仅可查看 ${userPermission?.organization} 机构及分公司整体数据`}
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex-1 flex items-center justify-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
            >
              切换用户
              <ChevronDown
                size={16}
                className={`ml-1 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center px-4 py-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors"
              title="登出"
            >
              <LogOut size={16} aria-hidden="true" />
              <span className="ml-1">登出</span>
            </button>
          </div>

          {/* 用户选择下拉 */}
          {isDropdownOpen && (
            <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {quickUsers.map((quickUser) => {
                  const Icon = quickUser.icon;
                  const isCurrentUser = userPermission?.username === quickUser.username;
                  return (
                    <button
                      key={quickUser.username}
                      onClick={() => handleLogin(quickUser.username)}
                      disabled={isCurrentUser}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                        isCurrentUser ? 'bg-gray-100 cursor-default' : ''
                      }`}
                    >
                      <div className="flex items-center">
                        <Icon
                          size={16}
                          className={`mr-2 ${
                            quickUser.role === UserRole.BRANCH_ADMIN
                              ? 'text-purple-500'
                              : 'text-blue-500'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-gray-700">{quickUser.displayName}</span>
                      </div>
                      {isCurrentUser && (
                        <Check size={16} className="text-green-500" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 未登录状态 */
        <div className="space-y-3">
          <p className="text-gray-600 text-sm">请选择用户身份登录：</p>

          <div className="space-y-2">
            {/* 管理员快捷登录 */}
            <button
              onClick={() => handleLogin('admin')}
              className="w-full flex items-center justify-between p-3 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
            >
              <div className="flex items-center">
                <Shield size={20} className="text-purple-500 mr-3" aria-hidden="true" />
                <div className="text-left">
                  <p className="font-medium text-purple-800">系统管理员</p>
                  <p className="text-xs text-purple-600">可查看所有机构数据</p>
                </div>
              </div>
            </button>

            {/* 机构用户登录区域 */}
            <div className="border-t border-gray-200 pt-2 mt-2">
              <p className="text-xs text-gray-500 mb-2">三级机构用户：</p>
              <div className="grid grid-cols-2 gap-2">
                {quickUsers.slice(1).map((quickUser) => {
                  const Icon = quickUser.icon;
                  return (
                    <button
                      key={quickUser.username}
                      onClick={() => handleLogin(quickUser.username)}
                      className="flex items-center p-2 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                    >
                      <Icon size={16} className="text-blue-500 mr-2" aria-hidden="true" />
                      <span className="text-sm text-blue-800">{quickUser.displayName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
