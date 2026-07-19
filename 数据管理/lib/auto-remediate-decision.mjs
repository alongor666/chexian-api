/**
 * 发布停更「自动接手」决策纯函数（BACKLOG 2026-07-12-claude-966ae7 · 审计 FIND-001）
 *
 * 背景：数据巡检（VPS）负责发现停更 + 告警；本模块所属的 Mac 侧 auto-remediate-stale.mjs
 * 负责「自动接手」——把 FIND-001 从「只告警」升级为「分级自主处置」。release:daily 依赖
 * Mac 的 ETL 管道，只能在 Mac 跑，故接手方在 Mac。
 *
 * 分级自主（用户 2026-07-12 决策）：
 *   Tier 1（轻风险自处置）：重跑一次 release:daily。瞬时性失败（网络/时序/已修复的阻断）
 *     一跑即好，属安全动作，自动执行。
 *   Tier 2（重风险待确认）：Tier 1 仍失败 → 诊断失败类别，把原因 + 建议命令回帖群，标记
 *     待人工/AI 确认，**绝不自动改配置/密钥/生产数据**（保住高风险动作的人工闸）。
 *
 * 幂等（防死循环）：每北京日只接手一次——Tier 1 用尽 → Tier 2 一次 → 待确认后不再自动动作。
 *
 * 双批发布（2026-07-18）：auto-release-state.json 升级为「批次 × 天」schema
 *（batches.early/late，见 auto-release-decision.mjs）。本模块改为按批聚合判定——任一批当天
 * failed（已达重试上限）/ missed 即接手，且只重跑「未完成的批次」（不再无脑重跑全量）。
 * 旧扁平 schema 向后兼容：视为单批（全量）重跑。
 *
 * 无副作用、不读文件/时钟/env，可被 vitest 直接 import（调用方负责落盘与执行）。
 */
import { RELEASE_BATCHES } from './release-batches.mjs';
import { selectBatchState } from './auto-release-decision.mjs';

/** Tier 1 每日自动重跑上限（默认 1：瞬时失败一跑即好，多跑无益且放大风险）。 */
export const DEFAULT_MAX_TIER1 = 1;

/**
 * 接手前要求 auto-release 已「放弃」的最小失败尝试数（须与 auto-release-decision 的
 * DEFAULT_MAX_ATTEMPTS 保持一致——本模块不 import 该常量以避免跨模块运行时耦合，
 * 但两边任一方调整重试上限时必须同步改这里，否则并发闸会失效）。**并发闸**：只在
 * auto-release 达重试上限停手后才接手，否则会与其重试窗口内的 release:daily 并发跑
 * （ETL/rsync/reload 撞车）。missed 态天然已停手（窗口已过），不受此数约束。
 * 2026-07-12：auto-release-decision.DEFAULT_MAX_ATTEMPTS 由 2 调宽到 6（见该文件注释），
 * 此处同步调整，否则本模块会在 auto-release 仍有重试余量时提前接手、造成并发跑。
 */
export const DEFAULT_MIN_RELEASE_ATTEMPTS = 6;

/** 触发接手的发布状态集（今日发布处于这些状态才接手）。 */
const REMEDIABLE_RELEASE_STATUSES = ['failed', 'missed'];

/**
 * 决定本次 tick 该做什么。
 *
 * @param {object} opts
 * @param {object|null} opts.releaseState auto-release-state.json 内容（无文件传 null）。
 *   支持新「批次×天」schema（batches.early/late）与旧扁平 schema（status/attempts）。
 * @param {{beijingDay?:string,status?:string,tier1Attempts?:number}|null} opts.remediateState
 *   auto-remediate-state.json 内容（无文件传 null）。
 * @param {string} opts.todayBeijing 北京今天 YYYY-MM-DD。
 * @param {number} [opts.maxTier1=DEFAULT_MAX_TIER1]
 * @param {number} [opts.minReleaseAttempts=DEFAULT_MIN_RELEASE_ATTEMPTS] 并发闸阈值
 * @returns {{action:'skip'|'tier1-retry'|'tier2-diagnose', reason:string, batches:(string[]|null)}}
 *   - action：skip / tier1-retry（轻风险重跑）/ tier2-diagnose（重风险诊断待确认）
 *   - batches：待接手的批次 id 列表（早批在前，保序）；`null` = 旧扁平 schema，重跑全量 release:daily
 */
export function decideRemediation({
  releaseState,
  remediateState,
  todayBeijing,
  maxTier1 = DEFAULT_MAX_TIER1,
  minReleaseAttempts = DEFAULT_MIN_RELEASE_ATTEMPTS,
}) {
  // 判定哪些批次今日需接手。并发闸：failed 须达重试上限（auto-release 已停手）才接手，防与其
  // 重试窗内并发跑 release；missed 态天然已停手（窗口已过），不受尝试数约束。
  const needsRemediation = (status, attempts) =>
    REMEDIABLE_RELEASE_STATUSES.includes(status)
    && !(status === 'failed' && (attempts ?? 0) < minReleaseAttempts);

  // 旧扁平 schema（无 batches 但有 status）：视为单批全量重跑（batches=null）。
  const isLegacyFlat = releaseState && !releaseState.batches && releaseState.status;
  let batches; // null=legacy full；string[]=新 schema 待接手批次
  if (isLegacyFlat) {
    const sameDay = releaseState.beijingDay === todayBeijing;
    if (!sameDay || !needsRemediation(releaseState.status, releaseState.attempts)) {
      const why = !sameDay ? '发布状态非今天'
        : releaseState.status === 'released' ? '今日已 released'
        : releaseState.status === 'failed' ? `auto-release 仍在重试（attempts=${releaseState.attempts ?? 0}<${minReleaseAttempts}）`
        : '非 failed/missed';
      return { action: 'skip', reason: `无需接手（旧扁平态）：${why}`, batches: [] };
    }
    batches = null;
  } else {
    batches = [];
    for (const batch of RELEASE_BATCHES) {
      const slice = selectBatchState(releaseState, batch.id);
      if (!slice || slice.beijingDay !== todayBeijing) continue;
      if (!needsRemediation(slice.status, slice.attempts)) continue;
      batches.push(batch.id);
    }
    if (batches.length === 0) {
      return { action: 'skip', reason: '今日各批均非 failed/missed，或 failed 批仍在 auto-release 重试窗内（防并发）', batches: [] };
    }
  }

  const remedSameDay = remediateState?.beijingDay === todayBeijing;
  const tier1Attempts = remedSameDay ? (remediateState?.tier1Attempts ?? 0) : 0;
  const remedStatus = remedSameDay ? remediateState?.status : null;

  if (remedStatus === 'recovered') {
    return { action: 'skip', reason: '今日已自动接手成功（数据恢复），幂等跳过', batches: [] };
  }
  if (remedStatus === 'tier2-awaiting') {
    return { action: 'skip', reason: '已诊断并回帖群等人工确认（Tier 2），不再自动尝试', batches: [] };
  }
  const label = batches === null ? '全量' : batches.join('+');
  if (tier1Attempts < maxTier1) {
    return {
      action: 'tier1-retry',
      reason: `轻风险自处置：重跑发布（${label}，第 ${tier1Attempts + 1}/${maxTier1} 次）`,
      batches,
    };
  }
  return { action: 'tier2-diagnose', reason: `Tier 1 重跑 ${tier1Attempts} 次仍失败（${label}），转重风险诊断 + 回帖群待确认`, batches };
}

/**
 * 组装接手后的下一份状态（纯函数；调用方落盘）。
 * @param {'recovered'|'tier1-failed'|'tier2-awaiting'} status
 * @param {object} opts
 * @param {string} opts.todayBeijing
 * @param {{beijingDay?:string,tier1Attempts?:number}|null} opts.prevState
 * @param {string} [opts.note]
 * @param {string} [opts.nowISO] 由调用方注入（保持纯函数可测）
 */
export function nextRemediateState(status, { todayBeijing, prevState, note = '', nowISO = '' }) {
  const sameDay = prevState?.beijingDay === todayBeijing;
  const prevTier1 = sameDay ? (prevState?.tier1Attempts ?? 0) : 0;
  // tier1-failed / recovered 都消耗一次 Tier 1 尝试；tier2-awaiting 不再加（是 Tier 1 用尽后的终态）
  const tier1Attempts = status === 'tier2-awaiting' ? prevTier1 : prevTier1 + 1;
  return { beijingDay: todayBeijing, status, tier1Attempts, note, updatedAt: nowISO };
}

/**
 * 从 release:daily 失败输出粗分类失败类别，供 Tier 2 回帖给出针对性建议（启发式，非精确）。
 * @param {string} log release:daily 的合并输出
 * @returns {{category:string, hint:string}}
 */
export function classifyReleaseFailure(log) {
  const s = String(log || '');
  if (/自助设密账号禁入USER_PASSWORDS|USER_PASSWORDS 含自助设密/.test(s)) {
    return {
      category: 'governance-user-passwords',
      hint: '主仓 server/.env 的 USER_PASSWORDS 残留自助设密账号，需人工剔除后重发（勿自动改密钥）。',
    };
  }
  if (/governance|治理校验|check-governance/i.test(s) && /(❌|失败|exit=1|not ok)/i.test(s)) {
    return { category: 'governance-other', hint: '治理闸未过，需人工看 governance 报错项后处置。' };
  }
  if (/manifest|上游|mtime|新鲜度|sizeMB|pull-bi-exports/i.test(s)) {
    return { category: 'upstream-not-ready', hint: '上游 BI 导出未就绪/不新鲜，通常等上游出表后自愈，无需改动。' };
  }
  if (/rsync|ssh|ETIMEDOUT|ECONNRESET|Connection|timed out|network/i.test(s)) {
    return { category: 'network', hint: '网络/SSH 抖动，多为瞬时；可稍后再重跑一次 release:daily。' };
  }
  if (/ETL|transform\.py|parquet|daily\.mjs/i.test(s) && /(Error|Traceback|❌|failed)/i.test(s)) {
    return { category: 'etl', hint: 'ETL 转换报错，需人工看 transform/daily 日志定位源数据或字段问题。' };
  }
  return { category: 'unknown', hint: '未识别失败类别，需人工看 release:daily 完整日志定位。' };
}
