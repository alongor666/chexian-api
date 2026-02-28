import { lazy, Suspense, ReactNode, FC } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SidebarLayout, DataGuard, ErrorBoundary } from '../components/layout';
import { DataProvider } from '../shared/contexts/DataContext';
import { FilterProvider } from '../shared/contexts/FilterContext';
import { PermissionProvider, usePermission } from '../shared/contexts/PermissionContext';
import { ThemeProvider } from '../shared/theme';
import { DataImportPage } from '../features/home/DataImportPage';
import { LoginPage, AuthGuard, RouteAccessGuard } from '../features/auth';
import { canAccessFeeAnalysis, canAccessCost } from '../shared/config/organizations';

/**
 * 费用分析路由级守卫，仅对超级用户（SUPER_USERS）开放。
 * 注：此组件始终在 AuthGuard 内渲染，AuthGuard 已处理 isLoading，
 * 因此 userPermission 求值时会话已完全恢复，不存在误重定向风险。
 */
const FeeAnalysisGuard: FC<{ children: ReactNode }> = ({ children }) => {
  const { userPermission } = usePermission();
  if (!canAccessFeeAnalysis(userPermission?.username)) {
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
  if (!canAccessCost(userPermission?.username)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

// Lazy load page components for better performance
const PremiumDashboardPage = lazy(() =>
  import('../features/pages/PremiumDashboardPage').then((m) => ({ default: m.PremiumDashboardPage }))
);


// 独立页面组件（包含筛选器）
const TruckPage = lazy(() =>
  import('../features/pages/TruckPage').then((m) => ({ default: m.TruckPage }))
);
const RenewalPage = lazy(() =>
  import('../features/pages/RenewalPage').then((m) => ({ default: m.RenewalPage }))
);
const CrossSellPage = lazy(() =>
  import('../features/pages/CrossSellPage').then((m) => ({ default: m.CrossSellPage }))
);
const PerformanceAnalysisPage = lazy(() =>
  import('../features/pages/PerformanceAnalysisPage').then((m) => ({ default: m.PerformanceAnalysisPage }))
);
const GrowthPage = lazy(() =>
  import('../features/pages/GrowthPage').then((m) => ({ default: m.GrowthPage }))
);
const CostPage = lazy(() =>
  import('../features/pages/CostPage').then((m) => ({ default: m.CostPage }))
);
const ComprehensiveAnalysisPage = lazy(() =>
  import('../features/pages/ComprehensiveAnalysisPage').then((m) => ({ default: m.ComprehensiveAnalysisPage }))
);
const FeeAnalysisPage = lazy(() =>
  import('../features/pages/FeeAnalysisPage').then((m) => ({ default: m.FeeAnalysisPage }))
);
const ComparisonPage = lazy(() =>
  import('../features/pages/ComparisonPage').then((m) => ({ default: m.ComparisonPage }))
);
const CoefficientPage = lazy(() =>
  import('../features/pages/CoefficientPage').then((m) => ({ default: m.CoefficientPage }))
);
const MarketingReportPage = lazy(() =>
  import('../features/pages/MarketingReportPage').then((m) => ({ default: m.MarketingReportPage }))
);
const PremiumReportPage = lazy(() =>
  import('../features/pages/PremiumReportPage').then((m) => ({ default: m.PremiumReportPage }))
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

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p className="text-gray-500">加载中...</p>
    </div>
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
                  {/* 首页 - 不需要数据守卫 */}
                  <Route
                    index
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
                  <Route
                    path="premium-report"
                    element={
                      <RouteAccessGuard routePath="/premium-report">
                        <DataGuard>
                          <LazyRoute><PremiumReportPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  <Route
                    path="marketing-report"
                    element={
                      <RouteAccessGuard routePath="/marketing-report">
                        <DataGuard>
                          <LazyRoute><MarketingReportPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  <Route
                    path="truck"
                    element={
                      <RouteAccessGuard routePath="/truck">
                        <DataGuard>
                          <LazyRoute><TruckPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  <Route
                    path="renewal"
                    element={
                      <RouteAccessGuard routePath="/renewal">
                        <DataGuard>
                          <LazyRoute><RenewalPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
                  {/* 权限管理 - BRANCH_ADMIN 专属，页面内部已有 isBranchAdmin 守卫，不套 RouteAccessGuard */}
                  <Route
                    path="admin/access-control"
                    element={
                      <LazyRoute>
                        <AccessControlPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="cross-sell"
                    element={
                      <RouteAccessGuard routePath="/cross-sell">
                        <DataGuard>
                          <LazyRoute><CrossSellPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
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
                  <Route
                    path="comprehensive-analysis"
                    element={
                      <RouteAccessGuard routePath="/cost">
                        <CostGuard>
                          <DataGuard>
                            <LazyRoute><ComprehensiveAnalysisPage /></LazyRoute>
                          </DataGuard>
                        </CostGuard>
                      </RouteAccessGuard>
                    }
                  />
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
                  <Route
                    path="comparison"
                    element={
                      <RouteAccessGuard routePath="/comparison">
                        <DataGuard>
                          <LazyRoute><ComparisonPage /></LazyRoute>
                        </DataGuard>
                      </RouteAccessGuard>
                    }
                  />
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
  );
}

export default App;
