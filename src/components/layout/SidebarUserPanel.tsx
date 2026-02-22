import React, { useState, useRef, useEffect } from 'react';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { UserRole } from '../../shared/config/organizations';
import { useSidebar } from './SidebarLayout';
import {
  LogOut,
  Shield,
  Building,
  User,
  ChevronUp,
  Check,
} from 'lucide-react';

/**
 * 侧边栏底部用户面板
 *
 * 功能：
 * - 紧凑布局：角色图标 + 显示名 + 角色标签
 * - 展开态：点击向上弹出菜单（权限信息 + 切换用户 + 登出）
 * - 收起态：只显示图标，点击向右浮动弹出面板
 * - 未登录：显示灰色用户图标
 */
export const SidebarUserPanel: React.FC = () => {
  const {
    userPermission,
    isAuthenticated,
    login,
    logout,
    isBranchAdmin,
    isOrgUser,
  } = usePermission();
  const { collapsed, isMobile } = useSidebar();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const showExpanded = isMobile || !collapsed;

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // 预定义用户列表
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
    setIsOpen(false);
  };

  const handleLogout = () => {
    logout();
    setIsOpen(false);
  };

  const getRoleLabel = () => {
    if (isBranchAdmin) return '管理员';
    if (isOrgUser) return '机构';
    return '';
  };

  const getRoleBadgeClass = () => {
    if (isBranchAdmin) return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-100 dark:border-purple-800';
    if (isOrgUser) return 'bg-primary-bg text-primary-dark dark:bg-blue-900/30 dark:text-blue-400 border border-primary-200 dark:border-blue-800';
    return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700';
  };

  const RoleIcon = isBranchAdmin ? Shield : isOrgUser ? Building : User;
  const iconColor = isBranchAdmin ? 'text-purple-500 dark:text-purple-400' : isOrgUser ? 'text-primary dark:text-primary-light' : 'text-neutral-400 dark:text-neutral-500';

  // 弹出面板内容（共用于向上和向右弹出）
  const popoverContent = (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-56 overflow-hidden">
      {/* 权限信息 */}
      {isAuthenticated && userPermission && (
        <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200">
          <p className="text-xs text-gray-500">数据访问权限</p>
          <p className="text-xs text-gray-700 mt-0.5">
            {isBranchAdmin
              ? '可查看所有机构数据'
              : `仅可查看 ${userPermission.organization} 及整体数据`}
          </p>
        </div>
      )}

      {/* 用户列表 */}
      <div className="max-h-52 overflow-y-auto py-1">
        {quickUsers.map((u) => {
          const Icon = u.icon;
          const isCurrent = userPermission?.username === u.username;
          return (
            <button
              key={u.username}
              onClick={() => handleLogin(u.username)}
              disabled={isCurrent}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-50 transition-colors ${isCurrent ? 'bg-gray-100 cursor-default' : ''
                }`}
            >
              <div className="flex items-center">
                <Icon
                  size={14}
                  className={`mr-2 flex-shrink-0 ${u.role === UserRole.BRANCH_ADMIN ? 'text-purple-500' : 'text-blue-500'
                    }`}
                  aria-hidden="true"
                />
                <span className="text-gray-700 truncate">{u.displayName}</span>
              </div>
              {isCurrent && <Check size={14} className="text-green-500 flex-shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* 登出 */}
      {isAuthenticated && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-1">
          <button
            onClick={handleLogout}
            className="w-full flex items-center px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg dark:hover:bg-red-900/20 rounded transition-colors"
          >
            <LogOut size={14} className="mr-2" aria-hidden="true" />
            登出
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={panelRef} className="relative">
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center rounded-lg transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800 ${showExpanded ? 'px-3 py-2 gap-2.5' : 'justify-center p-2'
          }`}
        title={!showExpanded ? (isAuthenticated ? userPermission?.displayName : '选择用户') : undefined}
      >
        <RoleIcon size={20} className={`flex-shrink-0 ${iconColor}`} aria-hidden="true" />
        {showExpanded && (
          <>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200 truncate">
                {isAuthenticated ? userPermission?.displayName : '未登录'}
              </p>
            </div>
            {isAuthenticated && (
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-wide flex-shrink-0 ${getRoleBadgeClass()}`}>
                {getRoleLabel()}
              </span>
            )}
            <ChevronUp
              size={14}
              className={`text-neutral-400 dark:text-neutral-500 flex-shrink-0 transition-transform ${isOpen ? '' : 'rotate-180'}`}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {/* 弹出面板 */}
      {isOpen && (
        showExpanded ? (
          // 展开态：向上弹出
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
            {popoverContent}
          </div>
        ) : (
          // 收起态：向右浮动
          <div className="absolute bottom-0 left-full ml-2 z-50">
            {popoverContent}
          </div>
        )
      )}
    </div>
  );
};
