/**
 * 认证上下文
 * Authentication Context
 *
 * 管理用户登录状态和 JWT Token
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { apiClient } from '../api/client';

interface User {
  username: string;
  displayName: string;
  role: string;
}

interface AuthContextValue {
  /** 当前用户 */
  user: User | null;
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 登录 */
  login: (username: string, password: string) => Promise<void>;
  /** 登出 */
  logout: () => void;
  /** 错误信息 */
  error: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
  error: null,
});

/**
 * 认证 Hook
 */
export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * 认证 Provider
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初始化：检查本地存储的 Token
  useEffect(() => {
    const initAuth = async () => {
      const token = apiClient.getToken();
      if (token) {
        try {
          // 解析 JWT 获取用户信息
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUser({
            username: payload.username,
            displayName: payload.username === 'admin' ? '系统管理员' : payload.username,
            role: payload.role,
          });
        } catch {
          // Token 无效，清除
          apiClient.clearToken();
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiClient.login(username, password);
      setUser(result.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    apiClient.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
