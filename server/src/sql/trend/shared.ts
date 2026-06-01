/**
 * 保费趋势分析 SQL 生成器 — 共享类型与常量
 *
 * 从 trend.ts 提取的类型定义与共享常量，供各子模块使用。
 */

import type { DateCriteria } from '../../types/data.js';
import type { ViewPerspective } from '../../types/index.js';
import { generatePerspectiveWhere } from '../perspective-adapter.js';

// 时间视图类型
export type TimeView = 'daily' | 'weekly' | 'monthly';

// B301: 优质业务定义收归单一事实源，re-export 以兼容既有从 './shared.js' 的 import
export { QUALITY_BUSINESS_CONDITION } from '../shared/business-conditions.js';

// Re-export shared dependencies for submodule use
export { generatePerspectiveWhere };
export type { DateCriteria, ViewPerspective };
