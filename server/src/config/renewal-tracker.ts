/**
 * 续保追踪（renewal_tracker）业务常量
 *
 * 口径定义：
 *   - Universe = SOURCE_YEAR 起保 + RENEWAL_YEAR 到期 + 商业险 + VIN 非空
 *   - 续保匹配 = dual-key (source_policy_no, vehicle_frame_no)
 *   - 报价窗口 = quote_time >= QUOTE_WINDOW_START
 *
 * 任何涉及 Universe 构建和报价匹配的代码（ETL/SQL）必须引用此处常量，
 * 确保 ETL 预计算时的口径与后端查询时完全一致。
 */

export const RENEWAL_TRACKER_CONFIG = {
  /** 报价窗口起点（ETL 对齐 `convert_renewal_tracker.py` 的 --quote-window-start 默认值） */
  QUOTE_WINDOW_START: '2025-12-03',
  /** 源保单起保年度 */
  SOURCE_YEAR: 2025,
  /** 续保到期年度 */
  RENEWAL_YEAR: 2026,
} as const;

export type RenewalTrackerConfig = typeof RENEWAL_TRACKER_CONFIG;
