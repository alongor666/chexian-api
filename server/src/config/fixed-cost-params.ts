/**
 * 固定成本参数 — 附加税费率（TS 侧单一引用点，B274）
 *
 * 唯一事实源（SSOT）：`数据管理/config/fixed-cost-params.json` 的
 *   `surcharge_rate[有效期最新].rate`（附加税费 = 结算费 + 印花税 + 教育费附加 + 保险保障基金，全险类适用）。
 * Python 侧由 `数据管理/pipelines/fixed_cost_config.py` 在离线诊断时运行时读取该 json。
 *
 * 为什么此处是常量镜像，而非运行时读文件：
 *   生产环境 pm2 运行 tsc 编译后的 `server/dist/app.js`（cwd = /var/www/chexian/server），
 *   `数据管理/` 目录不部署到 VPS（sync-vps 只推 parquet 到 server/data/）。运行时读
 *   `数据管理/config/fixed-cost-params.json` 会在生产 ENOENT 崩溃。
 *   故此处以常量镜像 json 值，由 `__tests__/fixed-cost-params.test.ts` 读 json 断言零漂移
 *   （CI/本地全仓 checkout 下 json 存在，值一旦不一致即红灯）——等价于「json 是 SSOT，
 *   TS 常量是其构建期投影」，与字段注册表 codegen 同一治理理念。
 *
 * B274（owner 2026-07-04 拍板）：税率动态、暂定 1.5%。修改税率时须同步改
 *   json（SSOT）+ 本常量 + `metric-registry/categories/cost.ts` 的 fixed_cost_amount tooltip/changelog。
 */

/** `surcharge_rate` 历史数组的单条条目（与 json 结构对齐）。 */
export interface SurchargeRateEntry {
  effective_date: string;
  rate: number;
  note?: string;
}

/**
 * 从 `surcharge_rate` 历史数组中选取 `effective_date <= asOf` 的最新条目费率。
 * 纯函数（不读文件），忠实镜像 Python `fixed_cost_config._pick_latest` 的选取语义，供漂移测试复用。
 * @returns 命中费率；无有效条目时返回 null。
 */
export function pickLatestSurchargeRate(
  entries: readonly SurchargeRateEntry[],
  asOf: string,
): number | null {
  const valid = entries.filter((e) => (e.effective_date ?? '9999') <= asOf);
  if (valid.length === 0) return null;
  const latest = valid.reduce((a, b) => (b.effective_date > a.effective_date ? b : a));
  return latest.rate;
}

/**
 * 附加税费率 = 1.5%（与 SSOT json `surcharge_rate` 对齐，漂移由单测强制）。
 * SQL 生成器（如 earned-premium-detail.ts 的月度费用查询）引用本常量，禁止再散写字面量。
 */
export const SURCHARGE_RATE = 0.015;
