/**
 * 立方体灰度哨兵 — 判定纯函数 lib（从 cube-grayscale-sentinel.mjs 抽离）
 *
 * 拆 lib 动机（PR #644 review 建议）：原 sentinel.mjs 的 buildAnomalies/maxSeverity/
 * renderSummary 是纯函数但与 IO（fetch/writeFileSync）+ args 解析混在同一文件，
 * 测试只能 inline 复现契约，导致"测试副本 vs 脚本本体"漂移风险。
 * 抽 lib 后：测试 import 真函数，脚本本体改动测试自动反映。
 *
 * 判定规则（确定性可复现）：
 *   ① shadow.*.mismatch > 0       → CRITICAL  立方体算错，立刻暂停切流
 *   ② shadow.*.error > 0          → WARN      立方体执行异常（构建失败 / 连接池耗尽 / 内存）
 *   ③ cubes.cost.exact=false      → INFO      跨格保单（ETL 数据质量信号）
 *   ④ cubes.cost.lastError != null → **CRITICAL**  cost 立方体构建失败影响 KPI 大盘 +
 *                                                 cost 分析（P95 大头域），不可推进切流
 *   ④' cubes.{trend,salesman}.lastError → WARN     其他立方体降级只影响特定路由
 *   ⑤ cubes.*.builtVersion 落后    → WARN      立方体未追上当前 dataVersion
 *
 * 退出码语义保留：CRITICAL → exit 1 阻断 cron；其他 → exit 0 透出但不算"红"。
 */

export const SEVERITY = { CRITICAL: 3, WARN: 2, INFO: 1 };

/**
 * cost 立方体的 lastError 升 CRITICAL 是因为：
 *   - KPI 路由（生产 P95 大头）通过 CubeCostDay 加速，cost 失败 = KPI 加速失效
 *   - cost 分析路由直接依赖 cost 立方体
 *   - 影子对账 cubeShadow.{kpi,cost} 在 cost 失败时 match=0（无样本静默通过陷阱）
 *
 * trend/salesman 立方体的 lastError 保持 WARN：
 *   - trend 立方体失败影响 trend + growth 路由，可降级原路径
 *   - salesman 立方体失败仅影响 salesman-ranking
 */
function severityForCubeBuildError(cubeName) {
  return cubeName === 'cost' ? 'CRITICAL' : 'WARN';
}

export function buildAnomalies({ healthBody, dataVersion }) {
  const anomalies = [];
  const checks = [];
  const cubes = healthBody?.cubes ?? {};
  const shadow = healthBody?.cubeShadow ?? {};

  // 规则 ① mismatch > 0 → CRITICAL
  const mismatches = Object.entries(shadow)
    .map(([route, s]) => ({ route, n: Number(s?.mismatch ?? 0) }))
    .filter((x) => x.n > 0);
  checks.push({
    id: 'shadow_no_mismatch',
    ok: mismatches.length === 0,
    detail: mismatches.length === 0
      ? '所有路由影子对账 mismatch=0'
      : `${mismatches.length} 条路由出现差异：${mismatches.map((m) => `${m.route}=${m.n}`).join(', ')}`,
  });
  for (const m of mismatches) {
    anomalies.push({
      severity: 'CRITICAL',
      kind: 'shadow_mismatch',
      route: m.route,
      message: `路由 ${m.route} 影子对账出现 ${m.n} 次差异 — 立方体结果与原路径不等，应立刻暂停灰度切流并排查（口径漂移 / 新字段值未识别 / 立方体逻辑 bug）`,
    });
  }

  // 规则 ② error > 0 → WARN
  const errors = Object.entries(shadow)
    .map(([route, s]) => ({ route, n: Number(s?.error ?? 0) }))
    .filter((x) => x.n > 0);
  checks.push({
    id: 'shadow_no_error',
    ok: errors.length === 0,
    detail: errors.length === 0
      ? '所有路由影子对账 error=0'
      : errors.map((e) => `${e.route}=${e.n}`).join(', '),
  });
  for (const e of errors) {
    anomalies.push({
      severity: 'WARN',
      kind: 'shadow_error',
      route: e.route,
      message: `路由 ${e.route} 影子查询执行异常 ${e.n} 次 — 多见于立方体构建失败或连接池耗尽，查 PM2 日志 [CubeShadow]`,
    });
  }

  // 规则 ③ cost cube 探针降级 → INFO（业务数据质量信号）
  const costExact = cubes?.cost?.exact;
  if (costExact === false) {
    anomalies.push({
      severity: 'INFO',
      kind: 'cost_cube_degraded',
      route: 'cost',
      message: '成本立方体探针发现跨格保单（同一保单的批改行机构/起保日不一致）— 本数据版本 cost 路由保持原路径，**这是数据质量信号**：ETL 上游应复盘批改是否改了机构/起保日字段',
    });
  }
  checks.push({
    id: 'cost_cube_exact',
    ok: costExact !== false,
    detail: costExact === false ? '探针发现跨格保单（exact=false）' : '探针通过（exact=true 或尚未构建）',
  });

  // 规则 ④ cube_build_error 与规则 ⑤ cube_stale（同一规则块两个子条目）
  // 进程冷启动初期 builtVersion 可能为 null（lastBuildMs 也为 null），属正常；
  // 已尝试构建过但失败时 lastError 有内容，单独标记
  const lagged = [];
  for (const [name, state] of Object.entries(cubes)) {
    if (!state) continue;
    if (state.lastError) {
      const sev = severityForCubeBuildError(name);
      anomalies.push({
        severity: sev,
        kind: 'cube_build_error',
        route: name,
        message: sev === 'CRITICAL'
          ? `立方体 ${name} 最近一次构建失败（影响 KPI 大盘 + cost 分析）：${state.lastError}`
          : `立方体 ${name} 最近一次构建失败：${state.lastError}`,
      });
    }
    if (dataVersion && state.builtVersion && state.builtVersion !== dataVersion) {
      lagged.push({ name, built: state.builtVersion, want: dataVersion });
    }
  }
  checks.push({
    id: 'cubes_fresh',
    ok: lagged.length === 0,
    detail: lagged.length === 0
      ? '立方体已追上当前数据版本（或尚未构建）'
      : lagged.map((l) => `${l.name}: built=${l.built} want=${l.want}`).join('; '),
  });
  for (const l of lagged) {
    anomalies.push({
      severity: 'WARN',
      kind: 'cube_stale',
      route: l.name,
      message: `立方体 ${l.name} builtVersion=${l.built} 落后当前 dataVersion=${l.want} — 通常 ETL 后预热请求会自动追上，若长期落后排查 cache-warmer 是否覆盖该路由族`,
    });
  }

  return { anomalies, checks };
}

export function maxSeverity(anomalies) {
  if (anomalies.length === 0) return null;
  let maxKey = null;
  let maxScore = 0;
  for (const a of anomalies) {
    const s = SEVERITY[a.severity] ?? 0;
    if (s > maxScore) { maxScore = s; maxKey = a.severity; }
  }
  return maxKey;
}

export function renderSummary({ ranAt, dataVersion, healthBody, anomalies, checks, apiBase }) {
  const cubes = healthBody?.cubes ?? {};
  const shadow = healthBody?.cubeShadow ?? {};
  const overall = anomalies.length === 0 ? '✅ 健康' : `❌ ${maxSeverity(anomalies)}（${anomalies.length} 条）`;

  let md = `# 立方体灰度哨兵报告\n\n`;
  md += `- **时间**：${ranAt}\n`;
  md += `- **环境**：${apiBase}\n`;
  md += `- **数据版本**：${dataVersion ?? '(未取到)'}\n`;
  md += `- **总体状态**：${overall}\n\n`;

  md += `## 检查项\n\n`;
  md += `| 检查 | 结果 | 说明 |\n|---|---|---|\n`;
  for (const c of checks) {
    md += `| ${c.id} | ${c.ok ? '✅' : '❌'} | ${c.detail} |\n`;
  }
  md += `\n`;

  md += `## 立方体新鲜度\n\n`;
  md += `| 立方体 | builtVersion | building | lastBuildMs | exact | lastError |\n|---|---|---|---|---|---|\n`;
  for (const [name, s] of Object.entries(cubes)) {
    md += `| ${name} | ${s.builtVersion ?? '(null)'} | ${s.building ? '是' : '否'} | ${s.lastBuildMs ?? '-'} | ${s.exact === undefined ? '-' : s.exact} | ${s.lastError ?? '-'} |\n`;
  }
  md += `\n`;

  md += `## 影子对账计数（跨 reload 持久化累计，落盘 server/data/cube-shadow-stats.json；人工清零 = 删文件 + reload）\n\n`;
  if (Object.keys(shadow).length === 0) {
    md += `_暂无路由触发过影子对账。这可能是正常的：影子对账只在请求满足"可服务 + 立方体就绪"时才双跑；进程刚启动 / 流量极低时为空属预期。_\n\n`;
  } else {
    md += `| 路由 | match | mismatch | error |\n|---|---:|---:|---:|\n`;
    for (const [route, s] of Object.entries(shadow)) {
      md += `| ${route} | ${s.match} | ${s.mismatch} | ${s.error} |\n`;
    }
    md += `\n`;
  }

  if (anomalies.length > 0) {
    md += `## 异常清单\n\n`;
    for (const a of anomalies) {
      md += `- **[${a.severity}] ${a.kind}** (${a.route})：${a.message}\n`;
    }
    md += `\n`;
  }

  md += `---\n`;
  md += `_产物：\`verdict.json\` 机器可读 · 本文 \`summary.md\` 人可读 · workflow artifact 保留 30 天 · 异常自动追踪 issue「立方体灰度哨兵追踪」（label \`cube-grayscale-anomaly\`）。设计文档与 BACKLOG uid=2026-06-11-claude-90a92c。_\n`;
  return md;
}
