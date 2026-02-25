# /src/services/

前端服务层（轻量）。当前仅保留与页面直接相关的服务。

## 当前保留

- `PdfExportService.ts`
  - 用途：导出看板为 PDF
  - 使用方：`src/features/dashboard/PremiumDashboard.tsx`

## 历史说明

- 旧图表服务（`src/services/charts/*`）已进入 API-only 清理流程，不再作为主链路依赖。
- 数据加载与查询统一走 `src/shared/api/client.ts` + 后端 `/api/*`。
