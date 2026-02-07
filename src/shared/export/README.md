# 数据导出模块

**版本**: 1.1.0
**更新日期**: 2026-01-29

## 概述

数据导出模块提供 PDF 报告生成功能，支持图表截图、表格导出、KPI汇总等特性。

## 核心功能

### 1. PDF 报告生成

- ✅ 封面页（标题、副标题、Logo、日期）
- ✅ KPI汇总页（网格布局，支持同比/环比）
- ✅ 图表页（自动截图，支持描述）
- ✅ 表格页（自动分页，表头样式）
- ✅ 页码、页脚、水印
- ✅ 多种模板（标准/高管摘要/详细分析）

### 2. 图表截图

- ✅ html2canvas 通用截图
- ✅ ECharts getDataURL 快速截图
- ✅ 批量截图（进度回调）
- ✅ 图片压缩（减小文件大小）
- ✅ 自动等待渲染完成

## 快速开始

### 基础用法

```typescript
import { exportData, type ExportConfig, type ExportContent } from '@/shared/export';

// 准备导出内容
const content: ExportContent = {
  title: '车险业绩分析报告',
  subtitle: '2026年1月',
  kpis: [
    { name: '总保费', value: 7963, unit: '万元', yoyChange: '+12.5%' },
    { name: '保单件数', value: 15234, unit: '件', yoyChange: '+8.3%' },
  ],
  charts: [
    {
      id: 'trend-chart',
      title: '保费趋势分析',
      type: 'line',
      description: '近30天保费走势',
    },
  ],
  tables: [
    {
      title: '业务员排名',
      headers: ['姓名', '保费', '件数'],
      rows: [
        ['张三', 1250, 320],
        ['李四', 1180, 298],
      ],
    },
  ],
};

// 配置导出选项
const config: ExportConfig = {
  format: 'pdf',
  filename: '业绩分析报告',
  orientation: 'portrait',
  template: 'default',
  branding: {
    companyName: '车险业绩分析系统',
    primaryColor: '2980b9',
  },
  options: {
    includeCoverPage: true,
    includePageNumber: true,
    chartQuality: 0.95,
  },
};

// 执行导出
const result = await exportData(config, content, (progress) => {
  console.log(`${progress.step}: ${progress.percentage}%`);
});

if (result.success) {
  console.log(`导出成功: ${result.filename}`);
}
```

### 使用UI组件

```typescript
import { ExportDialog } from '@/widgets/export';

function MyComponent() {
  const [isExportOpen, setIsExportOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsExportOpen(true)}>
        导出报告
      </button>

      <ExportDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        content={content}
        defaultFilename="业绩分析报告"
      />
    </>
  );
}
```

## 图表截图

### 方法1: 通过元素ID

```typescript
import { captureChart } from '@/shared/export';

const imageDataURL = await captureChart(
  document.getElementById('my-chart')!,
  {
    format: 'png',
    quality: 0.95,
    scale: 2, // 2x 清晰度
  }
);
```

### 方法2: 使用ECharts实例

```typescript
import { captureEChartsInstance } from '@/shared/export';

const echartsInstance = chartRef.current.getEchartsInstance();
const imageDataURL = captureEChartsInstance(echartsInstance, {
  format: 'png',
  scale: 2,
});
```

### 批量截图

```typescript
import { captureCharts } from '@/shared/export';

const chartsWithImages = await captureCharts(
  [
    { id: 'chart-1', title: '趋势图', type: 'line' },
    { id: 'chart-2', title: '分布图', type: 'bar' },
  ],
  { quality: 0.95 },
  (current, total, title) => {
    console.log(`进度: ${current}/${total} - ${title}`);
  }
);
```

## 配置选项

### ExportConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `format` | `'pdf'` | - | 导出格式（仅支持 PDF） |
| `filename` | `string` | - | 文件名（不含扩展名） |
| `orientation` | `'portrait' \| 'landscape'` | `'portrait'` | 页面方向 |
| `pageSize` | `'a4' \| 'letter' \| 'a3'` | `'a4'` | 纸张大小 |
| `template` | `'default' \| 'executive' \| 'detailed'` | `'default'` | 报告模板 |
| `branding` | `BrandingConfig` | `{}` | 品牌配置 |
| `options` | `ExportOptions` | `{}` | 高级选项 |

### ExportOptions

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `includeCoverPage` | `boolean` | `true` | 是否包含封面页 |
| `includeTOC` | `boolean` | `false` | 是否包含目录 |
| `includePageNumber` | `boolean` | `true` | 是否包含页码 |
| `includeWatermark` | `boolean` | `false` | 是否包含水印 |
| `watermarkText` | `string` | - | 水印文字 |
| `chartQuality` | `number` | `0.95` | 图表质量（0.1-1.0） |
| `compressImages` | `boolean` | `false` | 是否压缩图片 |

## 性能优化

### 图表截图优化

1. **优先使用 ECharts getDataURL**
   - 比 html2canvas 快 10倍+
   - 质量更高，文件更小

2. **批量截图使用进度回调**
   - 避免阻塞UI线程
   - 提供用户反馈

3. **图片压缩**
   - 根据需要启用压缩减小文件大小

### 大文件优化

1. **限制图表数量**
   - 分批导出多个文件

2. **降低图表质量**
   - `chartQuality: 0.8` 可减小 30% 文件大小
   - 视觉效果影响不大

## 依赖

- `jspdf`: ^4.0.0 - PDF 生成
- `jspdf-autotable`: ^5.0.7 - PDF 表格支持
- `html2canvas`: ^1.4.1 - HTML 转图片

## 常见问题

### Q: 图表截图失败？

**A**: 检查以下事项：
1. 确保图表已完成渲染
2. 使用 `waitForChartRender()` 等待动画完成
3. 检查 CORS 设置（跨域图片）
4. 优先使用 `captureEChartsInstance()`

### Q: PDF 文件过大？

**A**: 优化建议：
1. 降低 `chartQuality` 到 0.8
2. 启用 `compressImages`
3. 减少图表数量

### Q: 导出进度卡住？

**A**: 可能原因：
1. 图表元素未找到（检查 ID）
2. 图表未完成渲染（增加等待时间）
3. 内存不足（减少并发数量）

## 更新日志

### v1.1.0 (2026-01-29)

- ❌ 移除 PowerPoint 导出功能
- ❌ 移除 pptxgenjs 依赖
- ✅ 简化导出模块，仅支持 PDF

### v1.0.0 (2026-01-15)

- ✅ 初始版本
- ✅ PDF 报告生成
- ✅ 图表截图工具
- ✅ 导出UI组件
- ✅ 进度回调支持

## 相关文档

- [shared/INDEX.md](../INDEX.md) - 模块索引
