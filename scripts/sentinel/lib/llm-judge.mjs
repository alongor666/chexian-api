/**
 * ETL 异常哨兵 — LLM 归因封装
 *
 * 职责边界（codex 评审 E2）：LLM **只对统计层已触发的异常项做归因 + 分级**，
 * **不裁决是否告警**——告警触发完全由 stats.mjs 的确定性判定决定，保证可复现。
 *
 * 输入：已触发异常项 + 其数值上下文（含 timeProgress 已过天数比例，规避把成熟度
 *       问题当业务异常）。输出：每项 {severity, one_line_cause}。
 *
 * 提供方默认 Anthropic（复用已存在的 ANTHROPIC_API_KEY secret）；可切智谱。
 * raw fetch，不引 SDK。temperature=0。LLM 不可用时降级为规则化兜底文案，不阻断告警。
 */

const SYSTEM_PROMPT = `你是车险数据监控分析师。下面是 ETL 后统计层已判定为异常的指标（是否异常已由统计法确定，你不要推翻）。
请只做两件事：1) 给每项一个严重度 severity（low/medium/high）；2) 给一句话归因 one_line_cause（中文，≤40字，指出最可能业务成因方向，不要编造未提供的事实）。
重要业务常识：满期赔付率近期偏低/抖动常因赔款报告滞后(IBNR)，而非真实改善；timeProgress 是当期已过天数比例，越小越不成熟。若某项的波动更像数据成熟度artifact而非业务异常，在 one_line_cause 里点明。
严格输出 JSON：{"items":[{"metric":"<id>","severity":"low|medium|high","one_line_cause":"..."}]}，不要任何额外文字。`;

function fallbackJudge(triggered) {
  return triggered.map((t) => ({
    metric: t.metric,
    severity: Math.abs(t.z ?? 0) > 3.5 ? 'high' : 'medium',
    one_line_cause: `统计触发：${(t.reasons || []).join('；') || '偏离基线'}（LLM 不可用，规则兜底）`,
  }));
}

async function callAnthropic({ model, temperature, maxTokens }, apiKey, userPayload) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = (json.content || []).map((c) => c.text || '').join('');
  return text;
}

function parseLlmJson(text) {
  // 容错：抽出第一个 {...} JSON 块
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM 未返回 JSON');
  return JSON.parse(match[0]);
}

/**
 * @param {Array} triggered stats.evaluateMetricSeries 返回的已触发项数组
 * @param {object} ctx { timeProgress, cutoffDate }
 * @param {object} llmCfg config.llm
 * @returns {Promise<Array<{metric, severity, one_line_cause}>>}
 */
export async function judgeAnomalies(triggered, ctx, llmCfg) {
  if (!triggered || triggered.length === 0) return [];
  if (!llmCfg?.enabled) return fallbackJudge(triggered);

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ZHIPU_API_KEY;
  if (!apiKey) return fallbackJudge(triggered);

  const userPayload = {
    cutoffDate: ctx.cutoffDate ?? null,
    timeProgress: ctx.timeProgress ?? null,
    anomalies: triggered.map((t) => ({
      metric: t.metric,
      name: t.name,
      latestPeriod: t.latestMaturePeriod,
      latestValue: t.latestMatureValue,
      baselineMean: t.baselineMean,
      baselineStd: t.baselineStd,
      z: t.z,
      momPct: t.mom,
      yoyDeviationPct: t.yoyDeviation ?? null,
      reasons: t.reasons,
    })),
  };

  try {
    const text = await callAnthropic(
      { model: llmCfg.model, temperature: llmCfg.temperature ?? 0, maxTokens: llmCfg.maxTokens ?? 1024 },
      apiKey,
      userPayload
    );
    const parsed = parseLlmJson(text);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // 用 LLM 结果覆盖，缺失项用兜底补齐
    const byMetric = new Map(items.map((i) => [i.metric, i]));
    return triggered.map((t) => {
      const hit = byMetric.get(t.metric);
      if (hit && hit.severity && hit.one_line_cause) {
        return { metric: t.metric, severity: hit.severity, one_line_cause: hit.one_line_cause };
      }
      return fallbackJudge([t])[0];
    });
  } catch (err) {
    console.warn(`[sentinel] LLM 归因失败，降级规则兜底：${err.message}`);
    return fallbackJudge(triggered);
  }
}
