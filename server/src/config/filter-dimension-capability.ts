/**
 * 维度 × 数据域能力矩阵 — 后端镜像（筛选器联动治理计划 Phase 3，✅D5 = TS 常量起步）
 *
 * 与前端 src/shared/config/filter-dimension-capability.ts 为同一矩阵的两端镜像，
 * 锚点区内容必须逐字一致（governance「能力矩阵两端一致」检查强制对账；
 * 前后端是独立编译域无法共享 import，故采用镜像 + 文本对账，暂不 codegen——✅D5）。
 *
 * 后端用途：路由/SQL 层在剥离或裁剪「域不支持的参数」时引用本矩阵作为口径声明
 * （现状：cross-sell 的 sanitizeAggQuery 与 renewal-tracker 的前端映射层各自实现
 * 了与本矩阵一致的行为，本文件是其统一的能力事实源；后续新增数据域路由时先来
 * 这里登记能力，再实现剥离/裁剪）。
 *
 * 维护协议与局限声明见前端镜像头注释（评审 🟡6）。
 */

// ── CAPABILITY-MATRIX-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──

/** 数据域标识（与查询后端的 FROM 目标一一对应） */
export type FilterDataDomain =
  | 'policy_fact' // PolicyFact 原始保单事实表（主站大多数页，全维度）
  | 'cross_sell_agg' // CrossSellDailyAgg 物化聚合表（交叉销售页）
  | 'renewal_tracker' // RenewalTrackerFact 续保派生域（续保追踪页）
  | 'claims_detail'; // ClaimsDetail + PolicyFact 半连接（赔案明细页，PR #571 后全维度）

/** 数据域对快捷筛选维度的支持能力 */
export interface QuickFilterCapability {
  /** 交/商险类 toggle。true 条件 = 域有 insurance_type 列，或有等价口径
   *（cross_sell_agg 无该列但 buildCrossSellAggInsuranceClause 用
   *  compulsory/commercial_premium > 0 口径等价支持，见 PR #569） */
  insuranceType: boolean;
  /** 燃料 toggle 形态：
   *  - full：油/气/电 完整三分（需要 fuel_type 列做气/油 LIKE 细分）
   *  - no-gas：全部→电→油（派生 fuel_category 值域仅'油'/'电'，气车被归入'油'，
   *    传'气'会得到错误的空结果——如 renewal_tracker）
   *  - electric-only：全部↔电（仅 is_nev 列可表达，无 fuel_type——如 cross_sell_agg） */
  fuel: 'full' | 'no-gas' | 'electric-only';
  /** 吨位货车 chip：1T货/2-9T货/1-2T货（需要 tonnage_segment 列） */
  tonnageChips: boolean;
  /** 自卸/牵引/普货 chip（需要 vehicle_model 列做 LIKE 匹配） */
  vehicleModelChips: boolean;
}

/** 维度 × 数据域能力矩阵（唯一事实源；QuickFilterBar 按 domain 查表自动隐藏） */
export const FILTER_DIMENSION_CAPABILITY: Record<FilterDataDomain, QuickFilterCapability> = {
  policy_fact: { insuranceType: true, fuel: 'full', tonnageChips: true, vehicleModelChips: true },
  cross_sell_agg: { insuranceType: true, fuel: 'electric-only', tonnageChips: true, vehicleModelChips: false },
  renewal_tracker: { insuranceType: false, fuel: 'no-gas', tonnageChips: false, vehicleModelChips: false },
  claims_detail: { insuranceType: true, fuel: 'full', tonnageChips: true, vehicleModelChips: true },
};

// ── CAPABILITY-MATRIX-END ──
