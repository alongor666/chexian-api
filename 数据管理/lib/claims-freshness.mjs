/**
 * claims 报案截止日新鲜度判定 — 纯函数，可单测
 *
 * 背景：理赔金额是动态的（已决金额 settled_amount / 未决金额 pending_amount 随理赔进展
 * 持续变化）。若喂"旧快照 / 窄窗增量"而非含历史的全量源，旧赔案金额停在首次抓取值
 * → 已报告赔款偏低 → 满期赔付率系统性偏低（2026-06-08 满期赔付率对账事故根因）。
 *
 * 本模块把"报案截止日落后当日多少 → 是否告警"抽成无副作用纯函数：daily.mjs 顶层执行
 * main() 无法被 import，判定逻辑必须抽到 lib/ 才能被 vitest 直接 import 测试
 * （与 lib/shard-classify.mjs 同一模式）。
 *
 * 见 .claude/rules/data-pipeline.md「claims_detail 存量更新铁律」。
 */

/**
 * 报案截止日落后当日 ≥ 此天数 → 告警。
 * claims 为"日全量"源（T+1 节奏），正常落后 1-2 天；≥3 天疑似喂了旧快照 / 漏刷新全量。
 */
export const CLAIMS_REPORT_LAG_WARN_DAYS = 3;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → UTC 毫秒（严格校验，非法 / 溢出返回 null） */
function parseISODateUTC(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // 拒绝溢出归一化（如 2026-02-31 被 Date 折算到 3 月）
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

/**
 * 本地当日 'YYYY-MM-DD'（可注入 Date 便于测试）。
 * 用本地时区字段（非 toISOString 的 UTC），避免运行机器时区导致的 ±1 天偏差。
 */
export function localTodayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * maxReportDate('YYYY-MM-DD') 落后 today('YYYY-MM-DD') 的天数。
 * 任一非法日期返回 null（调用方据此判定"读不到日期"，不等同于"落后 0 天"）。
 * 负值表示数据日期晚于当日（理论上不该出现，原样返回供调用方观察）。
 */
export function claimsReportLagDays(maxReportDate, today) {
  const a = parseISODateUTC(maxReportDate);
  const b = parseISODateUTC(today);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * lag 天数 ≥ 阈值 → 需告警。
 * lag 为 null（读不到日期）时返回 false：由调用方另行提示"无法读取"，不混入告警语义。
 */
export function shouldWarnClaimsFreshness(lagDays, threshold = CLAIMS_REPORT_LAG_WARN_DAYS) {
  return typeof lagDays === 'number' && lagDays >= threshold;
}
