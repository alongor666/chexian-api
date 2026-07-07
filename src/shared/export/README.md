# 导出模块（shared/export）

**当前职责**：只承载导出的**共享基础设施**，不再包含 PDF 生成引擎。

| 文件 | 职责 |
|------|------|
| `ExportContext.tsx` | 导出状态 Context（`ExportProvider`，挂载于 `src/app/App.tsx`；导出进行中标记供页面隐藏交互元素） |
| `ignoreElements.ts` | 截图豁免规则（`createExportIgnoreElements`，标记不进入截图的 DOM 元素） |

## PDF 导出活链路

PDF 报告生成的唯一实现在 **`src/services/PdfExportService.ts`**（html2canvas 长页面分页切片 + jsPDF），入口为保费分析看板页 `src/features/pages/PremiumDashboardPage.tsx` 的「导出PDF报告」。

> 历史上本目录曾有一套独立 PDF 引擎（`pdfExporter.ts` / `chartCapture.ts` / `types.ts` / `index.ts`），与 `PdfExportService` 构成双实现；已于 2026-07-07 前端极简架构清理中删除（零引用验证），详见 `开发文档/架构设计/前端极简架构规划_2026-07-07.md`。

CSV/Excel 导出见 `src/shared/utils/export.ts`。
