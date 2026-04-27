import React, { useState, createContext, useContext, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarNavigation } from './SidebarNavigation';
import { TopNavigation } from './TopNavigation';
import { Watermark } from './Watermark';
import { CopilotDrawer } from '../../features/copilot';

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  isMobile: boolean;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => { },
  mobileOpen: false,
  setMobileOpen: () => { },
  isMobile: false,
  sidebarWidth: 240,
  setSidebarWidth: () => { },
  isDragging: false,
  setIsDragging: () => { },
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed');
      return saved !== null ? saved === 'true' : false;
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const location = useLocation();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-width');
      return saved ? parseInt(saved, 10) : 240;
    } catch {
      return 240;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-width', sidebarWidth.toString());
    } catch { }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed', collapsed.toString());
    } catch { }
  }, [collapsed]);

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
    <SidebarContext.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen, isMobile, sidebarWidth, setSidebarWidth, isDragging, setIsDragging }}>
      <div className="h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-900 flex flex-col">
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
            className={`flex-1 overflow-hidden ${!isDragging ? 'transition-all duration-300' : ''}`}
            style={{ marginLeft: isMobile ? '0px' : collapsed ? '64px' : `${sidebarWidth}px` }}
          >
            <div className="h-full flex flex-col">
              <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-neutral-900 overflow-y-auto relative" id="main-scroll-container">
                <Outlet />
                <Watermark />
              </div>
            </div>
          </main>
        </div>
        <CopilotDrawer />
      </div>
    </SidebarContext.Provider>
  );
};
