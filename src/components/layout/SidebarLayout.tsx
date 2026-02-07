import React, { useState, createContext, useContext, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarNavigation } from './SidebarNavigation';
import { TopNavigation } from './TopNavigation';

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  isMobile: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  isMobile: false,
});

export const useSidebar = () => useContext(SidebarContext);

/**
 * 侧边栏布局容器
 *
 * 结构：
 * ┌────────────────────────────────────────────────────┐
 * │  顶部导航栏 (TopNavigation)                        │
 * ├──────┬─────────────────────────────────────────────┤
 * │      │                                              │
 * │ 侧边栏 │              主内容区                        │
 * │ 导航  │             (Outlet)                        │
 * │      │                                              │
 * └──────┴─────────────────────────────────────────────┘
 */
export const SidebarLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();

  const toggle = () => setCollapsed((prev) => !prev);

  // 检测屏幕尺寸
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 路由切换时关闭移动端侧边栏
  useEffect(() => {
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [location.pathname, isMobile]);

  // 移动端打开时禁止body滚动
  useEffect(() => {
    if (mobileOpen && isMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen, isMobile]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen, isMobile }}>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* 顶部导航栏 */}
        <TopNavigation />

        {/* 主体区域：侧边栏 + 内容，pt-14 为固定顶部导航栏留出空间 */}
        <div className="flex flex-1 overflow-hidden pt-14">
          {/* 移动端遮罩层 */}
          {isMobile && mobileOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-30 md:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* 侧边栏导航 */}
          <SidebarNavigation />

          {/* 主内容区 - 移动端全宽，桌面端有侧边栏边距 */}
          <main
            className={`flex-1 overflow-auto transition-all duration-300 ${
              isMobile ? 'ml-0' : collapsed ? 'ml-16' : 'ml-60'
            }`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
};
