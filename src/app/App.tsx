import { lazy, Suspense, ReactNode, FC } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { SidebarLayout, DataGuard, ErrorBoundary } from '../components/layout';
import { DataProvider } from '../shared/contexts/DataContext';
import { FilterProvider } from '../shared/contexts/FilterContext';
import { PermissionProvider, usePermission } from '../shared/contexts/PermissionContext';
import { ThemeProvider } from '../shared/theme';
import { DataImportPage } from '../features/home/DataImportPage';
import { LoginPage, AuthGuard, RouteAccessGuard } from '../features/auth';
import { canAccessFeeAnalysis, canAccessCost } from '../shared/config/organizations';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 分钟内数据视为 fresh，不重新请求
      gcTime: 30 * 60 * 1000,         // 30 分钟后垃圾回收
      refetchOnWindowFocus: false,     // 车险数据非实时，关闭窗口聚焦刷新
      retry: 1,                        // 失败重试 1 次
    },
  },
});

export { queryClient };

/**
 * 费用分析路由级守卫，仅对超级用户（SUPER_USERS）开放。
 * 注：此组件始终在 AuthGuard 内渲染，AuthGuard 已处理 isLoading，
 * 因此 userPermission 求值时会话已完全恢复，不存在误重定向风险。
 */
const FeeAnalysisGuard: FC<{ children: ReactNode }> = ({ children }) => {
  const { userPermission } = usePermission();
  if (!canAccessFeeAnalysis(userPermission?.username, userPermission?.specialFeatures)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

/**
 * 成本分析路由级守卫，仅对 COST_ALLOWED_USERS 白名单开放。
 * 同 FeeAnalysisGuard，依赖 AuthGuard 的 isLoading 保护，无需额外处理。
 */
const CostGuard: FC<{ children: ReactNode }> = ({ children }) => {
  const { userPermission } = usePermission();
  if (!canAccessCost(userPermission?.username, userPermission?.specialFeatures)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

// Lazy load page components for better performance
const PremiumDashboardPage = lazy(() =>
  import('../features/pages/PremiumDashboardPage').then((m) => ({ default: m.PremiumDashboardPage }))
);


// 独立页面组件（包含筛选器）
const PerformanceAnalysisPage = lazy(() =>
  import('../features/pages/PerformanceAnalysisPage').then((m) => ({ default: m.PerformanceAnalysisPage }))
);
const GrowthPage = lazy(() =>
  import('../features/pages/GrowthPage').then((m) => ({ default: m.GrowthPage }))
);
const CostPage = lazy(() =>
  import('../features/pages/CostPage').then((m) => ({ default: m.CostPage }))
);
const FeeAnalysisPage = lazy(() =>
  import('../features/pages/FeeAnalysisPage').then((m) => ({ default: m.FeeAnalysisPage }))
);
const CoefficientPage = lazy(() =>
  import('../features/pages/CoefficientPage').then((m) => ({ default: m.CoefficientPage }))
);
const ReportsPage = lazy(() =>
  import('../features/pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const SpecialtyPage = lazy(() =>
  import('../features/pages/SpecialtyPage').then((m) => ({ default: m.SpecialtyPage }))
);
const ReportTemplatesPanel = lazy(() =>
  import('../features/report/components/ReportTemplatesPanel').then((m) => ({ default: m.ReportTemplatesPanel }))
);
const MotoCostPage = lazy(() =>
  import('../features/moto-cost').then((m) => ({ default: m.MotoCostPage }))
);
const AccessControlPage = lazy(() =>
  import('../features/admin/AccessControlPage').then((m) => ({ default: m.AccessControlPage }))
);

// Loading fallback — content-aware skeleton screen
const PageLoader = () => (
  <div className="p-6 space-y-6 animate-pulse">
    <div className="h-10 bg-neutral-100 dark:bg-neutral-800 rounded-lg w-full" />
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-28 bg-neutral-100 dark:bg-neutral-800 rounded-xl" />
      ))}
    </div>
    <div className="h-64 bg-neutral-100 dark:bg-neutral-800 rounded-xl" />
    <div className="h-48 bg-neutral-100 dark:bg-neutral-800 rounded-xl" />
  </div>
);

// Lazy route wrapper with ErrorBoundary + Suspense
const LazyRoute: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HashRouter>
          <DataProvider>
            <PermissionProvider>
              <FilterProvider>
              <Routes>
                {/* 登录页面 - 不需要认证 */}
                <Route path="/login" element={<LoginPage />} />

                {/* 主应用 - 需要认证 */}
                <Route path="/" element={
                  <AuthGuard>
                    <SidebarLayout />
                  </AuthGuard>
                }>
                  {/* 首页 → 仪表盘 */}
                  <Route index element={<Navigate to="dashboard" replace />} />

                  {/* 数据导入页（原首页） */}
                  <Route
                    path="data-import"
                    element={
                      <RouteAccessGuard routePath="/">
                        <DataImportPage />
                      </RouteAccessGuard>
                    }
                  />

                  {/* 数据分析页面 - 需要数据守卫，使用 LazyRoute 包装 */}
                  <Route
                    path="dashboard"
                    element={
                      <RouteAccessGuard routePath="/dashboard">
                        <DataGuard>
                          <LazyRoute>
                            <PremiumDashboardPage />
                          </LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  <Route
                    path="performance-analysis"
                    element={
                      <RouteAccessGuard routePath="/performance-analysis">
                        <DataGuard>
                          <LazyRoute><PerformanceAnalysisPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  {/* premium-report, marketing-report, truck, renewal 已合并，见上方重定向 */}
                  {/* 权限管理 - BRANCH_ADMIN 专属，页面内部已有 isBranchAdmin 守卫，不套 RouteAccessGuard */}
                  <Route
                    path="admin/access-control"
                    element={
                      <LazyRoute>
                        <AccessControlPage />
                      </LazyRoute>
                    }
                  />
                  {/* cross-sell 已合并到 /specialty，见上方重定向 */}
                  <Route
                    path="growth"
                    element={
                      <RouteAccessGuard routePath="/growth">
                        <DataGuard>
                          <LazyRoute><GrowthPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  <Route
                    path="cost"
                    element={
                      <RouteAccessGuard routePath="/cost">
                        <CostGuard>
                          <DataGuard>
                            <LazyRoute><CostPage /></LazyRoute>
                          </DataGuard>
                        </CostGuard>
                      </RouteAccessGuard>
                    }
                  />
                  {/* comprehensive-analysis 已合并到 /cost，见上方重定向 */}
                  <Route
                    path="fee-analysis"
                    element={
                      <RouteAccessGuard routePath="/fee-analysis">
                        <FeeAnalysisGuard>
                          <DataGuard>
                            <LazyRoute><FeeAnalysisPage /></LazyRoute>
                          </DataGuard>
                        </FeeAnalysisGuard>
                      </RouteAccessGuard>
                    }
                  />
                  {/* comparison 已合并到 /growth，见上方重定向 */}
                  <Route
                    path="coefficient"
                    element={
                      <RouteAccessGuard routePath="/coefficient">
                        <DataGuard>
                          <LazyRoute><CoefficientPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />

                  {/* 保费达成（计划达成 + 保费报表）*/}
                  <Route
                    path="reports"
                    element={
                      <RouteAccessGuard routePath="/reports">
                        <DataGuard>
                          <LazyRoute><ReportsPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />

                  {/* 合并页面：专项分析（驾意险 + 续保 + 货车）*/}
                  <Route
                    path="specialty"
                    element={
                      <RouteAccessGuard routePath="/specialty">
                        <DataGuard>
                          <LazyRoute><SpecialtyPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />

                  {/* 旧路由重定向到合并页面 */}
                  <Route path="premium-report" element={<Navigate to="/reports" replace />} />
                  <Route path="marketing-report" element={<Navigate to="/reports" replace />} />
                  <Route path="truck" element={<Navigate to="/specialty?tab=truck" replace />} />
                  <Route path="renewal" element={<Navigate to="/specialty?tab=renewal" replace />} />
                  <Route path="cross-sell" element={<Navigate to="/specialty?tab=cross-sell" replace />} />
                  <Route path="comparison" element={<Navigate to="/growth" replace />} />
                  <Route path="comprehensive-analysis" element={<Navigate to="/cost?view=comprehensive" replace />} />

                  {/* 报表模板 - 不需要数据守卫 */}
                  <Route
                    path="templates"
                    element={
                      <RouteAccessGuard routePath="/templates">
                        <LazyRoute>
                          <ReportTemplatesPanel onSelectTemplate={() => { }} />
                        </LazyRoute>
                      </RouteAccessGuard>
                    }
                  />

                  {/* 摩意模型 - 外部 iframe 嵌入，不需要数据守卫 */}
                  <Route
                    path="moto-cost"
                    element={
                      <RouteAccessGuard routePath="/moto-cost">
                        <LazyRoute><MotoCostPage /></LazyRoute>
                      </RouteAccessGuard>
                    }
                  />


                </Route>

                {/* 向后兼容旧路由 */}
                <Route path="/old-dashboard" element={<Navigate to="/dashboard" replace />} />
              </Routes>
              </FilterProvider>
            </PermissionProvider>
          </DataProvider>
        </HashRouter>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
