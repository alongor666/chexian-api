import { lazy, Suspense, ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SidebarLayout, DataGuard, ErrorBoundary } from '../components/layout';
import { PageFilterPanel } from '../components/layout/PageFilterPanel';
import { DataProvider } from '../shared/contexts/DataContext';
import { FilterProvider } from '../shared/contexts/FilterContext';
import { PermissionProvider } from '../shared/contexts/PermissionContext';
import { ThemeProvider } from '../shared/theme';
import { DataImportPage } from '../features/home/DataImportPage';
import { LoginPage, AuthGuard, RouteAccessGuard } from '../features/auth';

// Lazy load page components for better performance
const PremiumDashboard = lazy(() =>
  import('../features/dashboard/PremiumDashboard').then((m) => ({ default: m.PremiumDashboard }))
);
const SqlQueryPage = lazy(() =>
  import('../features/sql-query/SqlQueryPage').then((m) => ({ default: m.SqlQueryPage }))
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
const GrowthPage = lazy(() =>
  import('../features/pages/GrowthPage').then((m) => ({ default: m.GrowthPage }))
);
const CostPage = lazy(() =>
  import('../features/pages/CostPage').then((m) => ({ default: m.CostPage }))
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
                        <PageFilterPanel preset="full" title="保费分析看板">
                          <PremiumDashboard />
                        </PageFilterPanel>
                      </LazyRoute>
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
                    <DataGuard>
                      <LazyRoute><CostPage /></LazyRoute>
                    </DataGuard>
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
              <Route
                path="sql-query"
                element={
                  <RouteAccessGuard routePath="/sql-query">
                    <DataGuard>
                      <LazyRoute><SqlQueryPage /></LazyRoute>
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
                      <ReportTemplatesPanel onSelectTemplate={() => {}} />
                    </LazyRoute>
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
