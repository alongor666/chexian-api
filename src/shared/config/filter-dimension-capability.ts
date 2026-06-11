/**
 * 维度 × 数据域能力矩阵（筛选器联动治理计划 Phase 3，✅D5 = TS 常量起步）
 *
 * 解决「点了报错 / 点了没用」的机制层：每个查询数据域支持哪些快捷筛选维度，
 * 由本矩阵唯一声明。QuickFilterBar 按 `domain` prop 查矩阵自动隐藏不可表达的
 * chip / toggle 档位（替代 Phase 0/1 的散装 hide props）。
 *
 * 与后端 server/src/config/filter-dimension-capability.ts 为同一矩阵的两端镜像，
 * 锚点区内容必须逐字一致（governance「能力矩阵两端一致」检查强制对账）。
 *
 * 【维护协议（评审 🟡6）】ETL 列变更 / 物化表 groupByColumns 变更若影响下列任一
 * 列（insurance_type / fuel_type / fuel_category / tonnage_segment / vehicle_model），
 * 必须同步更新本矩阵的前后端两份；CLAUDE.md §2 字段注册表流程已挂钩。
 *
 * 【局限声明（评审 🟡6）】CI 无 DuckDB 原生模块与 parquet（CLAUDE.md §5 CI 测试
 * 分层协议），本矩阵的「域有哪些列」是手工维护的常量——governance 只能防前后端
 * 两份互相漂移，防不了与真实 parquet 列的漂移。真实漂移的防线是 Phase 0/2 的
 * 运行时测试 + 本地集成测试（bun run test:integration）+ 上述维护协议。
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
