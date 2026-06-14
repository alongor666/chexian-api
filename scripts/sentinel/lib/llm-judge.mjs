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

/**
 * 智谱 GLM（兼容 OpenAI chat completions 格式）— 当 Anthropic 失活时作为车险项目主体 LLM 的 fallback。
 * Endpoint 与字段名都不同于 Anthropic，原 callAnthropic 写死 anthropic.com 是 issue #550
 * 「LLM 不可用」的根因（即使配了 ZHIPU_API_KEY 也调不通）。
 */
async function callZhipu({ model, temperature, maxTokens }, apiKey, userPayload) {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Zhipu HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}

function parseLlmJson(text) {
  // 容错：抽出第一个 {...} JSON 块
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM 未返回 JSON');
  return JSON.parse(match[0]);
}

function buildUserPayload(triggered, ctx) {
  return {
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
}

function mergeLlmAndFallback(triggered, items) {
  const byMetric = new Map(items.map((i) => [i.metric, i]));
  return triggered.map((t) => {
    const hit = byMetric.get(t.metric);
    if (hit && hit.severity && hit.one_line_cause) {
      return { metric: t.metric, severity: hit.severity, one_line_cause: hit.one_line_cause };
    }
    return fallbackJudge([t])[0];
  });
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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const zhipuKey = process.env.ZHIPU_API_KEY;
  if (!anthropicKey && !zhipuKey) return fallbackJudge(triggered);

  const userPayload = buildUserPayload(triggered, ctx);
  const temperature = llmCfg.temperature ?? 0;
  const maxTokens = llmCfg.maxTokens ?? 1024;
  // 项目主体已切真 Anthropic（claude-haiku-4-5），优先用；缺失或调用失败则降级智谱（GLM）。
  // 两路都失败才退到规则兜底，确保归因质量 >= 兜底。
  const providers = [];
  if (anthropicKey) providers.push({ name: 'anthropic', call: () => callAnthropic({ model: llmCfg.model, temperature, maxTokens }, anthropicKey, userPayload) });
  if (zhipuKey) providers.push({ name: 'zhipu', call: () => callZhipu({ model: llmCfg.zhipuModel || 'glm-4.7-flash', temperature, maxTokens }, zhipuKey, userPayload) });

  let lastErr = null;
  for (const p of providers) {
    try {
      const text = await p.call();
      const parsed = parseLlmJson(text);
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      return mergeLlmAndFallback(triggered, items);
    } catch (err) {
      lastErr = err;
      console.warn(`[sentinel] LLM(${p.name}) 归因失败：${err.message}`);
    }
  }
  console.warn(`[sentinel] 全部 LLM 提供方失败，降级规则兜底：${lastErr?.message || '未知原因'}`);
  return fallbackJudge(triggered);
}
