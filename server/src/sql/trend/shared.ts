/**
 * 保费趋势分析 SQL 生成器 — 共享类型与常量
 *
 * 从 trend.ts 提取的类型定义与共享常量，供各子模块使用。
 */

import { DateCriteria } from '../../types/data.js';
import type { ViewPerspective } from '../../types/index.js';
import { generatePerspectiveWhere } from '../perspective-adapter.js';

// 时间视图类型
export type TimeView = 'daily' | 'weekly' | 'monthly';

/**
 * 优质业务定义条件SQL片段
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为1吨以下或2-9吨
 */
export const QUALITY_BUSINESS_CONDITION = `
  (
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;

// Re-export shared dependencies for submodule use
export { DateCriteria, generatePerspectiveWhere };
export type { ViewPerspective };
