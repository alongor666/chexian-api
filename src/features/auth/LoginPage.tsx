import React, { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { Lock, User, Eye, EyeOff, AlertCircle, Shield, Building } from 'lucide-react';

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

  // 获取重定向目标
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // 如果已登录，直接跳转
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }

    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    setIsLoading(true);

    try {
      const success = await loginWithPassword(username.trim(), password, rememberMe);
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Shield size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">车险业绩分析系统</h1>
          <p className="text-gray-500 mt-2">内网用户登录</p>
        </div>

        {/* 登录表单卡片 */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 错误提示 */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 用户名输入 */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User size={18} className="text-gray-400" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            {/* 密码输入 */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className="text-gray-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
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
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-600">记住登录状态</span>
              </label>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-600/30"
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

          {/* 帮助信息 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">
              如需帮助，请联系系统管理员
            </p>
          </div>
        </div>

        {/* 用户角色说明 */}
        <div className="mt-6 p-4 bg-white/80 rounded-xl border border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <Building size={16} className="mr-2 text-gray-500" />
            用户角色说明
          </h3>
          <div className="space-y-2 text-sm text-gray-600">
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
        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; 2026 车险业绩分析系统 · 内网专用
        </p>
      </div>
    </div>
  );
};
