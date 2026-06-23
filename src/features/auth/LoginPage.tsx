import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, getDefaultRoute } from '../../shared/config/organizations';
import { Lock, User, Eye, EyeOff, AlertCircle, Shield, Building, QrCode } from 'lucide-react';
import { apiClient } from '../../shared/api/client';
import { maskUsernameForLog, resolveRedirectPath, sanitizePathForLog } from '../../shared/utils/redirect-state';
import { Logger } from '../../shared/utils/logger';
import { colorClasses, cn } from '../../shared/styles';

const logger = new Logger('LoginPage');

/**
 * 内网登录页面
 *
 * 功能：
 * - 用户名密码表单登录
 * - 错误提示
 * - 记住登录状态
 * - 登录成功后跳转
 */
export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithPassword, loginWithWecomToken, restoreSession, isAuthenticated, userPermission } = usePermission();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isWeComLoading, setIsWeComLoading] = useState(false);

  // 获取重定向目标
  const from = resolveRedirectPath(location.state, '/');

  // G8 多省接入：监听会话过期事件，刷新 token 失败（旧 token 被 fail-closed）时显示提示
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const handleSessionExpired = () => setSessionExpired(true);
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, []);

  const resolveTargetPath = useCallback(() => {
    if (!userPermission) {
      return from;
    }
    return canAccessRoute(userPermission, from) ? from : getDefaultRoute(userPermission);
  }, [userPermission, from]);

  // 如果已登录，直接跳转
  useEffect(() => {
    if (isAuthenticated) {
      const targetPath = resolveTargetPath();
      logger.debug('Auth restored, navigate to target path', {
        targetPath: sanitizePathForLog(targetPath),
        fromPath: sanitizePathForLog(from),
      });
      navigate(targetPath, { replace: true });
    }
  }, [from, isAuthenticated, navigate, resolveTargetPath]);

  // 处理企微登录回调
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wecomToken = params.get('wecom_token');
    const wecomSuccess = params.get('wecom');
    const wecomError = params.get('error');

    if (wecomError) {
      const errorMap: Record<string, string> = {
        'missing_wecom_code': '企微授权失败，请重试',
        'wecom_not_enterprise_user': '非法用户或非企业微信成员',
        'wecom_auth_denied': '您不在权限白名单/通讯录中，请联系业务管理员',
        'wecom_auth_failed': '企微登录异常，请稍后重试',
      };
      setError(errorMap[wecomError] || '企微登录失败');
      // 清除 URL 中的错误参数
      window.history.replaceState({}, '', window.location.pathname);
    } else if (wecomToken) {
      loginWithWecomToken(wecomToken).then((success: boolean) => {
        if (!success) setError('企微令牌无效或已过期');
      });
      // 清除 URL 中的 token
      window.history.replaceState({}, '', window.location.pathname);
    } else if (wecomSuccess === 'success') {
      restoreSession().then((success) => {
        if (!success) setError('企微会话恢复失败，请重新扫码登录');
      });
      // 清除 URL 中的 token
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loginWithWecomToken, restoreSession]);

  const handleWeComLogin = useCallback(async () => {
    setIsWeComLoading(true);
    setError('');
    try {
      const config = await apiClient.auth.getWeComConfig();
      if (config) {
        const { corpId, agentId, callbackUrl } = config;
        // Generate State
        const state = Math.random().toString(36).substring(7);
        // 跳转到企微扫码授权页面
        const qrUrl = `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${corpId}&agentid=${agentId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;
        window.location.href = qrUrl;
      } else {
        setError('获取企微配置失败');
        setIsWeComLoading(false);
      }
    } catch (err) {
      setError('无法连接到服务器');
      setIsWeComLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedUsername = username.normalize('NFKC').trim();
    const normalizedPassword = password.normalize('NFKC');

    if (!normalizedUsername) {
      setError('请输入用户名');
      return;
    }

    if (!normalizedPassword.trim()) {
      setError('请输入密码');
      return;
    }

    setIsLoading(true);

    try {
      const success = await loginWithPassword(normalizedUsername, normalizedPassword, rememberMe);
      if (success) {
        const targetPath = resolveTargetPath();
        logger.debug('Login succeeded, navigate to target path', {
          username: maskUsernameForLog(normalizedUsername),
          targetPath: sanitizePathForLog(targetPath),
          fromPath: sanitizePathForLog(from),
        });
        navigate(targetPath, { replace: true });
      } else {
        setError('用户名或密码错误');
      }
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  }, [username, password, rememberMe, loginWithPassword, navigate, resolveTargetPath]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-solid rounded-2xl mb-4 shadow-lg">
            <Shield size={32} className="text-white" />
          </div>
          <h1 className={cn("text-2xl font-bold", colorClasses.text.neutralBlack)}>车险业绩分析系统</h1>
          <p className={cn(colorClasses.text.neutralMuted, "mt-2")}>内网用户登录</p>
        </div>

        {/* 登录表单卡片 */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* G8 会话过期提示（多省接入：旧 token fail-closed 场景） */}
            {sessionExpired && !error && (
              <div className={cn("flex items-center gap-2 p-3 border rounded-lg text-sm", colorClasses.bg.warning, colorClasses.border.warning, colorClasses.text.warning)}>
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>会话已过期，请重新登录刷新权限</span>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className={cn("flex items-center gap-2 p-3 border rounded-lg text-sm", colorClasses.bg.danger, colorClasses.border.danger, colorClasses.text.danger)}>
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 用户名输入 */}
            <div>
              <label htmlFor="username" className={cn("block text-sm font-medium mb-2", colorClasses.text.neutral)}>
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={cn("block w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors", colorClasses.border.neutral)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* 密码输入 */}
            <div>
              <label htmlFor="password" className={cn("block text-sm font-medium mb-2", colorClasses.text.neutral)}>
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className={colorClasses.text.neutralMuted} />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn("block w-full pl-10 pr-12 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors", colorClasses.border.neutral)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={cn("absolute inset-y-0 right-0 pr-3 flex items-center", colorClasses.text.neutralMuted, "hover:text-neutral-600")}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* 记住登录 */}
            <div className="flex items-center justify-between">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-primary border-neutral-300 rounded focus:ring-primary"
                />
                <span className={cn("ml-2 text-sm", colorClasses.text.neutral)}>记住登录状态</span>
              </label>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-3 px-4 bg-primary-solid hover:bg-primary-dark disabled:bg-primary-400 text-white font-medium rounded-lg transition-colors shadow-lg shadow-primary-600/30"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>

          {/* 企微扫码登录分割线 */}
          <div className="mt-6 flex items-center justify-center space-x-4">
            <span className="h-px w-full bg-neutral-200 dark:bg-neutral-700"></span>
            <span className={cn("text-sm whitespace-nowrap", colorClasses.text.neutralMuted)}>或</span>
            <span className="h-px w-full bg-neutral-200 dark:bg-neutral-700"></span>
          </div>

          {/* 企微扫码登录按钮 */}
          <div className="mt-6">
            <button
              type="button"
              onClick={handleWeComLogin}
              disabled={isWeComLoading}
              className={cn("w-full flex items-center justify-center py-3 px-4 bg-white dark:bg-neutral-700 border rounded-lg font-medium transition-colors shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-600 disabled:bg-neutral-100 dark:disabled:bg-neutral-800", colorClasses.border.neutral, colorClasses.text.neutral)}
            >
              {isWeComLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-400 border-t-transparent mr-2" />
                  跳转中...
                </>
              ) : (
                <>
                  <QrCode size={20} className={cn("mr-2", colorClasses.text.success)} />
                  企微扫码登录
                </>
              )}
            </button>
          </div>

          {/* 帮助信息 */}
          <div className={cn("mt-6 pt-6 border-t", colorClasses.border.neutral)}>
            <p className={cn("text-sm text-center", colorClasses.text.neutralMuted)}>
              如需帮助，请联系系统管理员
            </p>
          </div>
        </div>

        {/* 用户角色说明 */}
        <div className={cn("mt-6 p-4 bg-white/80 dark:bg-neutral-800/80 rounded-xl border", colorClasses.border.neutral)}>
          <h3 className={cn("text-sm font-medium mb-3 flex items-center", colorClasses.text.neutral)}>
            <Building size={16} className={cn("mr-2", colorClasses.text.neutralMuted)} />
            用户角色说明
          </h3>
          <div className={cn("space-y-2 text-sm", colorClasses.text.neutral)}>
            <div className="flex items-start gap-2">
              <span className={cn("px-2 py-0.5 rounded text-xs font-medium", colorClasses.bg.purple, colorClasses.text.purple)}>管理员</span>
              <span>可查看所有机构数据</span>
            </div>
            <div className="flex items-start gap-2">
              <span className={cn("px-2 py-0.5 rounded text-xs font-medium", colorClasses.bg.primarySolid, colorClasses.text.primary)}>机构用户</span>
              <span>仅可查看本机构及分公司整体数据</span>
            </div>
          </div>
        </div>

        {/* 版权信息 */}
        <p className={cn("text-center text-xs mt-6", colorClasses.text.neutralMuted)}>
          &copy; 2026 车险业绩分析系统 · 内网专用
        </p>
      </div>
    </div>
  );
};
