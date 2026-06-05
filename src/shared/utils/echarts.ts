import * as echarts from 'echarts/core';
import { BarChart, LineChart, MapChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 注：SVGRenderer 仅 PerformanceTrendChart 一处使用，已移至该组件内按需
// echarts.use([SVGRenderer]) 注册，避免全量 SVG 渲染器进入共享 bundle。
echarts.use([
  BarChart,
  LineChart,
  MapChart,
  PieChart,
  ScatterChart,
  AxisPointerComponent,
  DataZoomComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EChartsCore = typeof echarts;
export { echarts };
