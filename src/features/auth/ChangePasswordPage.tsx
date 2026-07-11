import React, { useState, useCallback } from 'react';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { Lock, Eye, EyeOff, AlertCircle, ShieldCheck, LogOut } from 'lucide-react';
import { colorClasses, cn } from '../../shared/styles';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('ChangePasswordPage');

/**
 * 首登强制改密页（统一初始密码链路）
 *
 * 使用统一初始密码登录的账号（后端会话携带 pwc 声明）被 AuthGuard 强制渲染本页，
 * 改密成功前无法进入任何业务页；后端中间件同步拦截业务 API（双保险）。
 * 改密成功后后端换发新会话，无需重新登录。
 */
export const ChangePasswordPage: React.FC = () => {
  const { userPermission, changePassword, logout } = usePermission();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedOld = oldPassword.normalize('NFKC').trim();
    const normalizedNew = newPassword.normalize('NFKC').trim();
    const normalizedConfirm = confirmPassword.normalize('NFKC').trim();

    if (!normalizedOld) {
      setError('请输入初始密码');
      return;
    }
    if (normalizedNew.length < 8) {
      setError('新密码长度至少 8 位');
      return;
    }
    if (!/[A-Za-z]/.test(normalizedNew) || !/[0-9]/.test(normalizedNew)) {
      setError('新密码必须同时包含字母和数字');
      return;
    }
    if (normalizedNew === normalizedOld) {
      setError('新密码不能与初始密码相同');
      return;
    }
    if (normalizedNew !== normalizedConfirm) {
      setError('两次输入的新密码不一致');
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(normalizedOld, normalizedNew);
      // 成功后 mustChangePassword 复位，AuthGuard 自动放行业务页，无需手动跳转
    } catch (err) {
      logger.error('改密失败:', err);
      setError(err instanceof Error && err.message ? err.message : '修改密码失败，请稍后重试');
      setIsSubmitting(false);
    }
  }, [oldPassword, newPassword, confirmPassword, changePassword]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-solid rounded-2xl mb-4 shadow-lg">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>请设置您的专属密码</h1>
          <p className={cn(colorClasses.text.neutralMuted, 'mt-2')}>
            {userPermission?.displayName ? `${userPermission.displayName}，` : ''}
            首次登录须将统一初始密码修改为个人密码后方可使用系统
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className={cn('flex items-center gap-2 p-3 border rounded-lg text-sm', colorClasses.bg.danger, colorClasses.border.danger, colorClasses.text.danger)}>
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="old-password" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                初始密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="old-password"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className={cn('block w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors', colorClasses.border.neutral)}
                  placeholder="请输入当前使用的初始密码"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label htmlFor="new-password" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                新密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={cn('block w-full pl-10 pr-12 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors', colorClasses.border.neutral)}
                  placeholder="至少 8 位，须同时包含字母和数字"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className={cn('absolute inset-y-0 right-0 pr-3 flex items-center', colorClasses.text.neutralMuted, 'hover:text-neutral-600')}
                  aria-label={showNewPassword ? '隐藏密码' : '显示密码'}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                确认新密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="confirm-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={cn('block w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors', colorClasses.border.neutral)}
                  placeholder="再次输入新密码"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center py-3 px-4 bg-primary-solid hover:bg-primary-dark disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors shadow-lg shadow-primary-600/30"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                  提交中...
                </>
              ) : (
                '设置新密码并进入系统'
              )}
            </button>
          </form>

          <div className={cn('mt-6 pt-6 border-t', colorClasses.border.neutral)}>
            <button
              type="button"
              onClick={logout}
              className={cn('w-full flex items-center justify-center text-sm', colorClasses.text.neutralMuted, 'hover:text-neutral-600')}
            >
              <LogOut size={14} className="mr-1" />
              退出登录，稍后再改
            </button>
          </div>
        </div>

        <p className={cn('text-center text-xs mt-6', colorClasses.text.neutralMuted)}>
          新密码仅您本人可见，请妥善保管；忘记密码请联系系统管理员重置
        </p>
      </div>
    </div>
  );
};
