/**
 * ETL 异常哨兵 — 规则归因器
 *
 * 历史：本文件原本含 callAnthropic / callZhipu 两路 LLM 调用，用于给统计触发项加
 * severity + 一句话归因。2026-06-14 治理：把 LLM 归因从 CI 路径剥离，CI 仅做"统计
 * 触发 + 确定性规则归因"，业务深度归因走本地 skill `/chexian-sentinel-attribution`
 * （Claude Code Max 套餐，比外部 API key 可控且深度更高）。
 *
 * 保留文件名（避免改 etl-anomaly-sentinel.mjs 的 import 路径）；不再读 ANTHROPIC_API_KEY
 * / ZHIPU_API_KEY 环境变量，不再读 config.llm 段。
 */

/**
 * 规则归因：从统计层 reasons 派生一句话归因 + Z-score 阈值定 severity。
 * @param {Array} triggered stats.evaluateMetricSeries 返回的已触发项数组
 * @returns {Array<{metric, severity, one_line_cause}>}
 */
function ruleJudge(triggered) {
  return triggered.map((t) => ({
    metric: t.metric,
    severity: Math.abs(t.z ?? 0) > 3.5 ? 'high' : 'medium',
    one_line_cause: `统计触发：${(t.reasons || []).join('；') || '偏离基线'}（业务归因走本地 /chexian-sentinel-attribution）`,
  }));
}

/**
 * @param {Array} triggered stats.evaluateMetricSeries 返回的已触发项数组
 * @param {object} _ctx 兼容签名，当前未使用（保留以备本地 skill 二次扩展时复用）
 * @param {object} _llmCfg 兼容签名，当前未使用
 * @returns {Promise<Array<{metric, severity, one_line_cause}>>}
 */
export async function judgeAnomalies(triggered, _ctx, _llmCfg) {
  if (!triggered || triggered.length === 0) return [];
  return ruleJudge(triggered);
}
