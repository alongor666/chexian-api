import React, { useState, createContext, useContext, useEffect, useMemo, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarNavigation } from './SidebarNavigation';
import { TopNavigation } from './TopNavigation';
import { Watermark } from './Watermark';

// CopilotDrawer 携带 AI 相关重依赖且默认关闭，lazy 加载以剥离出首屏 bundle。
const CopilotDrawer = lazy(() =>
  import('../../features/copilot').then((m) => ({ default: m.CopilotDrawer })),
);

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

export const DESKTOP_SIDEBAR_WIDTH = 96;

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: true,
  toggle: () => { },
  mobileOpen: false,
  setMobileOpen: () => { },
  isMobile: false,
  sidebarWidth: DESKTOP_SIDEBAR_WIDTH,
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();

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

  // Context value 用 useMemo 稳定引用，避免 SidebarLayout 每次重渲染都生成新对象
  // 导致 useSidebar() 的所有消费者（SidebarNavigation/TopNavigation 等）级联重渲染。
  const sidebarContextValue = useMemo<SidebarContextValue>(
    () => ({
      collapsed: true,
      toggle: () => { },
      mobileOpen,
      setMobileOpen,
      isMobile,
      sidebarWidth: DESKTOP_SIDEBAR_WIDTH,
      setSidebarWidth: () => { },
      isDragging: false,
      setIsDragging: () => { },
    }),
    [mobileOpen, isMobile],
  );

  return (
    <SidebarContext.Provider value={sidebarContextValue}>
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
            className="flex-1 overflow-hidden transition-all duration-300"
            style={{ marginLeft: isMobile ? '0px' : `${DESKTOP_SIDEBAR_WIDTH}px` }}
          >
            <div className="h-full flex flex-col">
              <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-neutral-900 overflow-y-auto relative" id="main-scroll-container">
                <Outlet />
                <Watermark />
              </div>
            </div>
          </main>
        </div>
        <Suspense fallback={null}>
          <CopilotDrawer />
        </Suspense>
      </div>
    </SidebarContext.Provider>
  );
};
