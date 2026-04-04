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
import { colorClasses } from '../../shared/styles';

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
    if (isBranchAdmin) return `${colorClasses.bg.purple} ${colorClasses.text.purple}`;
    if (isOrgUser) return `${colorClasses.bg.primary} ${colorClasses.text.primary}`;
    return `${colorClasses.bg.neutral} ${colorClasses.text.neutral}`;
  };

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 p-5">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-4 flex items-center">
        <User size={16} className="mr-2 text-neutral-500" aria-hidden="true" />
        用户身份
      </h3>

      {/* 当前用户信息 */}
      {isAuthenticated ? (
        <div className="space-y-3">
          {/* 用户卡片 */}
          <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
            <div className="flex items-center">
              {isBranchAdmin ? (
                <Shield size={24} className={`${colorClasses.text.purple} mr-3`} aria-hidden="true" />
              ) : (
                <Building size={24} className="text-primary mr-3" aria-hidden="true" />
              )}
              <div>
                <p className="font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">{userPermission?.displayName}</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 font-mono">@{userPermission?.username}</p>
              </div>
            </div>
            <span className={`px-2 py-1 rounded text-[11px] font-semibold tracking-wide ${getRoleBadgeClass()}`}>
              {getRoleDisplayName()}
            </span>
          </div>

          {/* 权限说明 */}
          <div className="text-sm text-primary-dark bg-primary-bg rounded-lg p-3">
            <p className="font-semibold tracking-tight mb-1">数据访问权限</p>
            <p className="opacity-90">
              {isBranchAdmin
                ? '✓ 可查看所有机构数据'
                : `✓ 仅可查看 ${userPermission?.organization} 机构及分公司整体数据`}
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex-1 flex items-center justify-center px-4 py-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg text-neutral-700 dark:text-neutral-300 font-medium text-sm transition-colors"
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
              className="flex items-center justify-center px-4 py-2 bg-danger-bg hover:bg-danger-light rounded-lg text-danger font-medium text-sm transition-colors"
              title="登出"
            >
              <LogOut size={16} aria-hidden="true" />
              <span className="ml-1">登出</span>
            </button>
          </div>

          {/* 用户选择下拉 */}
          {isDropdownOpen && (
            <div className="mt-2 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {quickUsers.map((quickUser) => {
                  const Icon = quickUser.icon;
                  const isCurrentUser = userPermission?.username === quickUser.username;
                  return (
                    <button
                      key={quickUser.username}
                      onClick={() => handleLogin(quickUser.username)}
                      disabled={isCurrentUser}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${isCurrentUser ? 'bg-neutral-100 dark:bg-neutral-800 cursor-default' : ''
                        }`}
                    >
                      <div className="flex items-center">
                        <Icon
                          size={16}
                          className={`mr-2 ${quickUser.role === UserRole.BRANCH_ADMIN
                              ? colorClasses.text.purple
                              : 'text-primary'
                            }`}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{quickUser.displayName}</span>
                      </div>
                      {isCurrentUser && (
                        <Check size={16} className="text-success" aria-hidden="true" />
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
        <div className="space-y-4">
          <p className="text-neutral-600 dark:text-neutral-400 text-sm font-medium">请选择用户身份登录：</p>

          <div className="space-y-3">
            {/* 管理员快捷登录 */}
            <button
              onClick={() => handleLogin('admin')}
              className={`w-full flex items-center justify-between p-3 ${colorClasses.bg.purple} hover:bg-purple-bg rounded-lg border ${colorClasses.border.purple} transition-colors`}
            >
              <div className="flex items-center">
                <Shield size={20} className={`${colorClasses.text.purple} mr-3`} aria-hidden="true" />
                <div className="text-left">
                  <p className={`text-sm font-semibold ${colorClasses.text.purple}`}>系统管理员</p>
                  <p className={`text-xs ${colorClasses.text.purple}`}>可查看所有机构数据</p>
                </div>
              </div>
            </button>

            {/* 机构用户登录区域 */}
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 mt-3">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-500 mb-2">三级机构用户：</p>
              <div className="grid grid-cols-2 gap-2">
                {quickUsers.slice(1).map((quickUser) => {
                  const Icon = quickUser.icon;
                  return (
                    <button
                      key={quickUser.username}
                      onClick={() => handleLogin(quickUser.username)}
                      className="flex items-center p-2 bg-primary-bg hover:bg-primary-100 rounded-lg border border-primary-200 transition-colors"
                    >
                      <Icon size={16} className="text-primary mr-2" aria-hidden="true" />
                      <span className="text-sm font-medium text-primary-dark">{quickUser.displayName}</span>
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
