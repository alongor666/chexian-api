import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { Lock, User, Eye, EyeOff, AlertCircle, Shield, Building, QrCode } from 'lucide-react';
import { apiClient } from '../../shared/api/client';

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
  const { loginWithPassword, isAuthenticated } = usePermission();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isWeComLoading, setIsWeComLoading] = useState(false);

  // 获取重定向目标
  const rawFrom = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';
  const from = rawFrom === '/login' ? '/' : rawFrom;

  // 如果已登录，直接跳转
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // 处理企微登录回调
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wecomToken = params.get('wecom_token');
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
      // @ts-ignore loginWithWecomToken is added in next step
      usePermission().loginWithWecomToken?.(wecomToken).then((success: boolean) => {
        if (!success) setError('企微令牌无效或已过期');
      });
      // 清除 URL 中的 token
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleWeComLogin = useCallback(async () => {
    setIsWeComLoading(true);
    setError('');
    try {
      const config = await apiClient.getWeComConfig();
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
        navigate(from, { replace: true });
      } else {
        setError('用户名或密码错误');
      }
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  }, [username, password, rememberMe, loginWithPassword, navigate, from]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-bg via-white to-neutral-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4 shadow-lg shadow-primary/20">
            <Shield size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">车险业绩分析系统</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-2">内网用户登录</p>
        </div>

        {/* 登录表单卡片 */}
        <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl border border-neutral-100 dark:border-neutral-800 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 错误提示 */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-danger-bg dark:bg-red-900/20 border border-danger-200 dark:border-red-800/50 rounded-lg text-danger dark:text-danger-light text-sm font-medium">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 用户名输入 */}
            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User size={18} className="text-neutral-400 dark:text-neutral-500" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary text-neutral-900 dark:text-white transition-all shadow-sm"
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* 密码输入 */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className="text-neutral-400 dark:text-neutral-500" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-12 py-3 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-primary focus:border-primary text-neutral-900 dark:text-white transition-all shadow-sm"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* 记住登录 */}
            <div className="flex items-center justify-between">
              <label className="flex items-center cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-primary border-neutral-300 dark:border-neutral-600 rounded focus:ring-primary focus:ring-offset-0 cursor-pointer"
                />
                <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">记住登录状态</span>
              </label>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-3 px-4 bg-primary hover:bg-primary-light disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-md shadow-primary/20 focus:ring-2 focus:ring-offset-2 focus:ring-primary focus:outline-none"
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
          <div className="mt-8 flex items-center justify-center space-x-4">
            <span className="h-px w-full bg-neutral-200 dark:bg-neutral-800"></span>
            <span className="text-sm text-neutral-400 dark:text-neutral-500 whitespace-nowrap">或</span>
            <span className="h-px w-full bg-neutral-200 dark:bg-neutral-800"></span>
          </div>

          {/* 企微扫码登录按钮 */}
          <div className="mt-6">
            <button
              type="button"
              onClick={handleWeComLogin}
              disabled={isWeComLoading}
              className="w-full flex items-center justify-center py-3 px-4 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50 text-neutral-700 dark:text-neutral-300 font-medium rounded-xl transition-all shadow-sm focus:ring-2 focus:ring-offset-2 focus:ring-neutral-200 focus:outline-none"
            >
              {isWeComLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-400 border-t-transparent mr-2" />
                  跳转中...
                </>
              ) : (
                <>
                  <QrCode size={20} className="mr-2 text-green-600" />
                  企微扫码登录
                </>
              )}
            </button>
          </div>

          {/* 帮助信息 */}
          <div className="mt-8 pt-6 border-t border-neutral-100 dark:border-neutral-800">
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center hover:text-primary transition-colors cursor-pointer">
              如需帮助，请联系系统管理员
            </p>
          </div>
        </div>

        {/* 用户角色说明 */}
        <div className="mt-6 p-5 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3 flex items-center tracking-tight">
            <Building size={16} className="mr-2 text-neutral-500 dark:text-neutral-400" />
            用户角色说明
          </h3>
          <div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400 font-medium">
            <div className="flex items-start gap-2">
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">管理员</span>
              <span>可查看所有机构数据</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">机构用户</span>
              <span>仅可查看本机构及分公司整体数据</span>
            </div>
          </div>
        </div>

        {/* 版权信息 */}
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500 mt-8 font-medium">
          &copy; 2026 车险业绩分析系统 · 内网专用
        </p>
      </div>
    </div>
  );
};
