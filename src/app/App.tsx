import { lazy, Suspense, ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SidebarLayout, DataGuard, ErrorBoundary } from '../components/layout';
import { DataProvider } from '../shared/contexts/DataContext';
import { FilterProvider } from '../shared/contexts/FilterContext';
import { PermissionProvider } from '../shared/contexts/PermissionContext';
import { ThemeProvider } from '../shared/theme';
import { DataImportPage } from '../features/home/DataImportPage';
import { LoginPage, AuthGuard } from '../features/auth';

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
              <Route index element={<DataImportPage />} />

              {/* 数据分析页面 - 需要数据守卫，使用 LazyRoute 包装 */}
              <Route
                path="dashboard"
                element={
                  <DataGuard>
                    <LazyRoute><PremiumDashboard /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="premium-report"
                element={
                  <DataGuard>
                    <LazyRoute><PremiumReportPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="marketing-report"
                element={
                  <DataGuard>
                    <LazyRoute><MarketingReportPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="truck"
                element={
                  <DataGuard>
                    <LazyRoute><TruckPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="renewal"
                element={
                  <DataGuard>
                    <LazyRoute><RenewalPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="cross-sell"
                element={
                  <DataGuard>
                    <LazyRoute><CrossSellPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="growth"
                element={
                  <DataGuard>
                    <LazyRoute><GrowthPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="cost"
                element={
                  <DataGuard>
                    <LazyRoute><CostPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="comparison"
                element={
                  <DataGuard>
                    <LazyRoute><ComparisonPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="coefficient"
                element={
                  <DataGuard>
                    <LazyRoute><CoefficientPage /></LazyRoute>
                  </DataGuard>
                }
              />
              <Route
                path="sql-query"
                element={
                  <DataGuard>
                    <LazyRoute><SqlQueryPage /></LazyRoute>
                  </DataGuard>
                }
              />

              {/* 报表模板 - 不需要数据守卫 */}
              <Route
                path="templates"
                element={
                  <LazyRoute>
                    <ReportTemplatesPanel onSelectTemplate={() => {}} />
                  </LazyRoute>
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
