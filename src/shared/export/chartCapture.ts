/**
 * 图表截图工具
 *
 * 使用 html2canvas 捕获图表元素并转换为图片数据URL
 */

import type { ChartData, ChartCaptureOptions } from './types';
import { createExportIgnoreElements } from './ignoreElements';

import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ChartCapture');

/**
 * html2canvas（≈200KB gzip）仅在导出图表截图时才需要，动态 import 以剥离首屏 bundle。
 */
let html2canvasPromise: Promise<typeof import('html2canvas')['default']> | null = null;
function loadHtml2Canvas(): Promise<typeof import('html2canvas')['default']> {
  if (!html2canvasPromise) {
    html2canvasPromise = import('html2canvas').then((m) => m.default);
  }
  return html2canvasPromise;
}

/**
 * 默认截图选项
 */
const DEFAULT_CAPTURE_OPTIONS: ChartCaptureOptions = {
  format: 'png',
  quality: 0.95,
  backgroundColor: '#ffffff',
  scale: 2, // 2x 清晰度
  ignoreElements: createExportIgnoreElements(),
};

/**
 * 捕获单个图表截图
 *
 * @param element - 图表DOM元素
 * @param options - 截图选项
 * @returns 图片数据URL
 */
export async function captureChart(
  element: HTMLElement,
  options?: ChartCaptureOptions
): Promise<string> {
  const opts = { ...DEFAULT_CAPTURE_OPTIONS, ...options };

  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(element, {
      backgroundColor: opts.backgroundColor,
      scale: opts.scale,
      useCORS: true, // 支持跨域图片
      allowTaint: false,
      logging: false, // 禁用日志
      ignoreElements: opts.ignoreElements,
    });

    // 转换为数据URL
    const imageDataURL = canvas.toDataURL(
      `image/${opts.format}`,
      opts.quality
    );

    return imageDataURL;
  } catch (error) {
    logger.error('Failed to capture chart:', error);
    throw new Error(`Chart capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 批量捕获图表截图
 *
 * @param charts - 图表数据数组
 * @param options - 截图选项
 * @param onProgress - 进度回调
 * @returns 包含截图数据的图表数组
 */
export async function captureCharts(
  charts: ChartData[],
  options?: ChartCaptureOptions,
  onProgress?: (current: number, total: number, chartTitle: string) => void
): Promise<ChartData[]> {
  const results: ChartData[] = [];

  for (let i = 0; i < charts.length; i++) {
    const chart = charts[i];

    if (onProgress) {
      onProgress(i + 1, charts.length, chart.title);
    }

    try {
      let imageDataURL: string;

      // 如果已有截图数据，直接使用
      if (chart.imageDataURL) {
        imageDataURL = chart.imageDataURL;
      }
      // 如果提供了元素，进行截图
      else if (chart.element) {
        imageDataURL = await captureChart(chart.element, options);
      }
      // 如果通过ID查找元素
      else {
        const element = document.getElementById(chart.id);
        if (!element) {
          logger.warn(`Chart element not found: ${chart.id}`);
          continue;
        }
        imageDataURL = await captureChart(element, options);
      }

      results.push({
        ...chart,
        imageDataURL,
      });
    } catch (error) {
      logger.error(`Failed to capture chart ${chart.id}:`, error);
      // 跳过失败的图表，继续处理其他图表
      results.push(chart);
    }
  }

  return results;
}

/**
 * 从ECharts实例获取数据URL
 *
 * 使用ECharts内置的getDataURL方法（更快、更可靠）
 *
 * @param echartsInstance - ECharts实例
 * @param options - 截图选项
 * @returns 图片数据URL
 */
export function captureEChartsInstance(
  echartsInstance: any,
  options?: ChartCaptureOptions
): string {
  const opts = { ...DEFAULT_CAPTURE_OPTIONS, ...options };

  try {
    const dataURL = echartsInstance.getDataURL({
      type: opts.format,
      pixelRatio: opts.scale,
      backgroundColor: opts.backgroundColor,
    });

    return dataURL;
  } catch (error) {
    logger.error('Failed to capture ECharts instance:', error);
    throw new Error(`ECharts capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 等待图表渲染完成
 *
 * 在截图前等待图表动画完成
 *
 * @param delay - 延迟时间（毫秒）
 */
export function waitForChartRender(delay: number = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 压缩图片数据URL
 *
 * 通过降低质量来减小文件大小
 *
 * @param dataURL - 原始数据URL
 * @param quality - 压缩质量（0.1-1.0）
 * @returns 压缩后的数据URL
 */
export function compressImageDataURL(
  dataURL: string,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);

      // 转换为JPEG格式以获得更好的压缩比
      const compressedDataURL = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataURL);
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = dataURL;
  });
}

/**
 * 从数据URL提取图片尺寸
 *
 * @param dataURL - 图片数据URL
 * @returns Promise<{width: number, height: number}>
 */
export function getImageDimensions(
  dataURL: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height,
      });
    };
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    img.src = dataURL;
  });
}
