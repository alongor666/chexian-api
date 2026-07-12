import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, AlertCircle, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { apiClient } from '../../shared/api/client';
import { colorClasses, cn } from '../../shared/styles';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('ResetPasswordPage');

/**
 * 前端密码策略镜像校验（体验层；后端 server/src/config/password-policy.ts 是强制层，口径一致）：
 * ≥8 位 + ≥2 类字符（大写/小写/数字/符号）+ 不含 chexian 字样。
 * 找回场景不知道用户名（防枚举：全程不让用户输入用户名），用户名相关规则仅后端拦截。
 */
function validateNewPasswordMirror(password: string): string | null {
  if (password.length < 8) return '新密码长度至少 8 位';
  let classes = 0;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  if (classes < 2) return '新密码至少包含大写字母、小写字母、数字、符号中的两类';
  if (password.toLowerCase().includes('chexian')) return '新密码不能包含 chexian 等系统相关字样';
  return null;
}

/** HashRouter 下查询串在 hash 内（/#/reset-password?feishu=ready），location.search 读不到，须手动解析 */
function readHashQueryParam(key: string): string | null {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get(key);
}

/**
 * 重设密码页（全员密码闭环 · 阶段二找回双通道，公开路由 /reset-password）
 *
 * 两种进入方式：
 *   - 飞书扫码找回：callback 已把一次性重置令牌种进 httpOnly cookie（前端不可读、不展示），
 *     URL 带 ?feishu=ready → 隐藏令牌输入框，直接设新密；
 *   - 管理员发放重置令牌：用户粘贴 cx_rst_ 令牌 + 设新密。
 * 成功后引导回登录页用新密码登录（本页不签发会话）。
 */
export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  // 挂载时判定一次即可：feishu=ready 由后端 callback 重定向带入，会话内不变化
  const isFeishuFlow = useMemo(() => readHashQueryParam('feishu') === 'ready', []);

  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedToken = token.trim();
    const normalizedNew = newPassword.normalize('NFKC').trim();
    const normalizedConfirm = confirmPassword.normalize('NFKC').trim();

    if (!isFeishuFlow && !normalizedToken) {
      setError('请粘贴管理员发放的重置令牌');
      return;
    }
    const policyViolation = validateNewPasswordMirror(normalizedNew);
    if (policyViolation) {
      setError(policyViolation);
      return;
    }
    if (normalizedNew !== normalizedConfirm) {
      setError('两次输入的新密码不一致');
      return;
    }

    setIsSubmitting(true);
    try {
      // 飞书链路不传 token（httpOnly cookie 随请求自动携带）；管理员链路传粘贴的令牌
      await apiClient.auth.resetPassword({
        token: isFeishuFlow ? undefined : normalizedToken,
        newPassword: normalizedNew,
      });
      setIsDone(true);
    } catch (err) {
      logger.error('重设密码失败:', err);
      setError(err instanceof Error && err.message ? err.message : '重设密码失败，请稍后重试');
      setIsSubmitting(false);
    }
  }, [token, newPassword, confirmPassword, isFeishuFlow]);

  if (isDone) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-solid rounded-2xl mb-4 shadow-lg">
              <CheckCircle2 size={32} className="text-white" />
            </div>
            <h1 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>密码已重设</h1>
            <p className={cn(colorClasses.text.neutralMuted, 'mt-2 mb-6')}>
              新密码已生效，旧密码即刻失效。请使用新密码重新登录。
            </p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full flex items-center justify-center py-3 px-4 bg-primary-solid hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-lg shadow-primary-600/30"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-solid rounded-2xl mb-4 shadow-lg">
            <KeyRound size={32} className="text-white" />
          </div>
          <h1 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>重设登录密码</h1>
          <p className={cn(colorClasses.text.neutralMuted, 'mt-2')}>
            {isFeishuFlow
              ? '飞书身份验证成功，请直接设置新的登录密码'
              : '请粘贴管理员发放的一次性重置令牌，并设置新的登录密码'}
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

            {!isFeishuFlow && (
              <div>
                <label htmlFor="reset-token" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                  重置令牌
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound size={18} className={colorClasses.text.neutralMuted} />
                  </div>
                  <input
                    id="reset-token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className={cn('block w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors font-mono text-sm', colorClasses.border.neutral)}
                    placeholder="cx_rst_ 开头的一次性令牌"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="reset-new-password" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                新密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="reset-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={cn('block w-full pl-10 pr-12 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors', colorClasses.border.neutral)}
                  placeholder="至少 8 位，含大写/小写/数字/符号中的两类"
                  autoComplete="new-password"
                  autoFocus={isFeishuFlow}
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
              <label htmlFor="reset-confirm-password" className={cn('block text-sm font-medium mb-2', colorClasses.text.neutral)}>
                确认新密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="reset-confirm-password"
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
                '重设密码'
              )}
            </button>
          </form>

          <div className={cn('mt-6 pt-6 border-t', colorClasses.border.neutral)}>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className={cn('w-full flex items-center justify-center text-sm', colorClasses.text.neutralMuted, 'hover:text-neutral-600')}
            >
              <ArrowLeft size={14} className="mr-1" />
              返回登录页
            </button>
          </div>
        </div>

        <p className={cn('text-center text-xs mt-6', colorClasses.text.neutralMuted)}>
          重置令牌一次性有效；如已过期请重新发起飞书找回或联系管理员重新发放
        </p>
      </div>
    </div>
  );
};
