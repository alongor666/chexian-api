/**
 * 全自动日常发布 watcher 的「窗口 × 当日状态」决策纯函数
 *
 * 背景：launchd 每 N 分钟拉起一次 scripts/auto-release-daily.mjs，本模块决定这一次
 * tick 该做什么——探测上游 / 静默跳过 / 标记当天错过 / 停止重试。把状态机从副作用
 * 编排里抽出来，行为全部可 vitest 锁定。
 *
 * 状态文件（数据管理/logs/auto-release-state.json）语义（2026-07-18 起为「批次 × 天」）：
 *   {
 *     beijingDay,  // 最后写入批次的北京日（仅 --status 展示用，判定以各批 slice 内 beijingDay 为准）
 *     batches: {
 *       early: { beijingDay, status, attempts, consecutiveMissedDays, note, updatedAt },
 *       late:  { beijingDay, status, attempts, consecutiveMissedDays, note, updatedAt },
 *     },
 *     updatedAt,
 *   }
 *   每个批次 slice 就是 nextState() 的返回形状；批次间完全独立（互不重置、互不覆盖）。
 *   决策纯函数（decideTickAction / nextState / computeConsecutiveMissedDays）不感知批次，
 *   由 selectBatchState / mergeBatchState 把「某批 slice」当独立 scope 喂进去 / 收回来。
 *   旧扁平 schema（{beijingDay,status,attempts,consecutiveMissedDays}，2026-07-18 前）向后兼容：
 *   selectBatchState 把它当「早批的延续」读一次，晚批从零起（仅影响升级当天，无数据损失）。
 *
 *   单批 slice 的 status 语义：
 *   - released：该批当天已成功发布 → 后续 tick 该批全部跳过（幂等护栏）
 *   - failed：release:daily 跑过但失败；attempts < maxAttempts 时窗口内可重试
 *   - missed：窗口结束仍未就绪/未成功，已告警 → 当天该批不再动作，等人工
 *   - 跨天（slice.beijingDay ≠ 今天）视为无状态，从头开始（attempts 归零）
 *   - consecutiveMissedDays：released 前连续多少个自然日未成功发布（不含今天）。
 *     released 当天归零；跨天时若上一天未 released 则按实际相差的自然日数累加
 *     （非固定 +1，覆盖 Mac 睡眠/关机跨越多天未触发的场景）。用于 mark-missed 告警
 *     升级（见 computeConsecutiveMissedDays）——单日故障只告警一次，但一旦拖过
 *     第二天，说明人没看到/没修，告警必须更响，不能仍是同等力度的一条消息。
 *
 * 时间一律北京时区（上游出表节奏以北京为准；本机时钟时区不可信，调用方负责换算）。
 *
 * 无副作用、不读文件系统 / env / 时钟，可被 vitest 直接 import。
 */

import { EARLY_BATCH } from './release-batches.mjs';

/**
 * 默认发布窗口（北京时间）：单批时代的历史默认（早批 07:40 / 晚批 12:00 起窗见
 * release-batches.mjs 各批 window；本常量仅在无批次上下文时兜底/供旧引用不破）。
 * end 原为 14:00（2026-07-12 前）。实证复盘 `数据管理/logs/auto-release.log`（07-08~07-12）
 * 发现窗口内仅 2 次自动重试往往在 11:40 前就耗尽——之后即使根因（治理闸拦截 / VPS SSH
 * 瞬时抖动）当天被人工修复，也要等到人手动 `--once` 补跑才追上，导致报告与数据一起滞后
 * 1~3 天（首页报告卡「数据未更新」正是这个滞后的可见症状）。延长到 20:00，让自愈式重试
 * 有更长窗口去自动追上修复，而不必等人工介入。
 */
export const DEFAULT_WINDOW = Object.freeze({ start: '10:35', end: '20:00' });

/**
 * release:daily 失败后的当天最大尝试次数（超过即告警停手，等人工）。
 * 原为 2（2026-07-12 前），同上实证：2 次重试在 20~30 分钟内即耗尽，窗口内剩余数小时
 * 完全浪费。提到 6 次，配合更宽的窗口，让瞬时故障（SSH 抖动等）有更多机会自愈；若 6 次
 * 仍全部失败，大概率是持续性问题（如代码 bug），继续重试无意义，交由 mark-missed 的
 * 升级告警（见 computeConsecutiveMissedDays）通知人工介入。
 */
export const DEFAULT_MAX_ATTEMPTS = 6;

/** HH:MM 字符串合法性（宽松：仅格式，不校验 24h 语义边界之外的值）。 */
export function isValidHHMM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * 决定本次 tick 的动作。
 *
 * @param {object} opts
 * @param {{beijingDay?:string,status?:string,attempts?:number}|null} opts.state 上次状态（无文件传 null）
 * @param {string} opts.todayBeijing 北京今天 YYYY-MM-DD
 * @param {string} opts.nowHHMM 北京当前时刻 HH:MM
 * @param {{start:string,end:string}} [opts.window=DEFAULT_WINDOW]
 * @param {number} [opts.maxAttempts=DEFAULT_MAX_ATTEMPTS]
 * @param {boolean} [opts.once=false] 手动 --once：跳过窗口与「已 missed」限制，但仍尊重
 *   released 幂等（当天已发布不重复发）与 maxAttempts（防手抖连发）。
 * @returns {{action:'probe'|'skip'|'mark-missed', reason:string}}
 *   - probe：探测上游，就绪则触发发布
 *   - skip：本 tick 什么都不做
 *   - mark-missed：窗口已过且当天未成功 → 调用方写 missed 状态并发一次告警
 */
export function decideTickAction({
  state,
  todayBeijing,
  nowHHMM,
  window = DEFAULT_WINDOW,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  once = false,
}) {
  const sameDay = state?.beijingDay === todayBeijing;
  const attempts = sameDay ? (state?.attempts ?? 0) : 0;

  if (sameDay && state.status === 'released') {
    return { action: 'skip', reason: `今天（${todayBeijing}）已成功发布，幂等跳过` };
  }
  if (attempts >= maxAttempts) {
    return { action: 'skip', reason: `今天已尝试 ${attempts} 次（上限 ${maxAttempts}），停手等人工排查` };
  }
  if (once) {
    return { action: 'probe', reason: '--once 手动触发（跳过窗口判断）' };
  }
  if (sameDay && state.status === 'missed') {
    return { action: 'skip', reason: '今天已标记 missed（窗口内未就绪，已告警），不再自动尝试' };
  }
  if (nowHHMM < window.start) {
    return { action: 'skip', reason: `北京时间 ${nowHHMM} 未到窗口起点 ${window.start}` };
  }
  if (nowHHMM >= window.end) {
    return { action: 'mark-missed', reason: `窗口（${window.start}~${window.end}）已过仍未成功发布，标记 missed 并告警` };
  }
  return { action: 'probe', reason: `窗口内（${window.start}~${window.end}），探测上游` };
}

/**
 * 两个 YYYY-MM-DD 字符串之间相差的自然日数（均按 UTC 午夜解析，只用于算日期差，
 * 与实际时区无关——两端都是「北京日」字符串，差值不受时区影响）。
 * @param {string} fromYMD
 * @param {string} toYMD
 * @returns {number}
 */
function daysBetweenYMD(fromYMD, toYMD) {
  const from = Date.parse(`${fromYMD}T00:00:00Z`);
  const to = Date.parse(`${toYMD}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

/**
 * 计算「releases 之前连续多少个自然日未成功发布」（不含今天）。
 *
 * - status === 'released' → 今天成功了，归零。
 * - 同一天内的多次状态变化（failed→failed→missed）不重复计数，只在跨天时才累加。
 * - 跨天且上一天状态不是 'released' → 说明上一天也没成功，按实际相差的自然日数累加
 *   （而非固定 +1）——Mac 睡眠/关机跨越多天不触发时（见文件头 "⚠️ Mac 睡眠时 launchd
 *   不触发"），prevState.beijingDay 与 todayBeijing 之间可能隔了不止一天，若仍固定 +1
 *   会低估滞后天数，恰好在"该功能存在的意义"这种长时间无人值守场景里失真；
 *   上一天是 'released' → 说明是全新的一天开始出问题，从 0 起算。
 *
 * @param {'released'|'failed'|'missed'} status 本次写入的状态
 * @param {object} opts
 * @param {string} opts.todayBeijing
 * @param {{beijingDay?:string,status?:string,consecutiveMissedDays?:number}|null} opts.prevState
 * @returns {number}
 */
export function computeConsecutiveMissedDays(status, { todayBeijing, prevState }) {
  if (status === 'released') return 0;
  if (!prevState) return 0; // 首次运行，无历史可言，不能算作"之前有一天没发布"
  const sameDay = prevState.beijingDay === todayBeijing;
  if (sameDay) return prevState.consecutiveMissedDays ?? 0;
  const prevWasSuccess = prevState.status === 'released';
  if (prevWasSuccess) return 0;
  const gap = Math.max(1, daysBetweenYMD(prevState.beijingDay ?? todayBeijing, todayBeijing));
  return (prevState.consecutiveMissedDays ?? 0) + gap;
}

/**
 * 组装下一份状态文件内容（纯函数；调用方负责落盘）。
 * @param {'released'|'failed'|'missed'} status
 * @param {object} opts
 * @param {string} opts.todayBeijing
 * @param {{beijingDay?:string,attempts?:number,status?:string,consecutiveMissedDays?:number}|null} opts.prevState
 * @param {string} [opts.note]
 * @param {string} [opts.nowISO] 时间戳由调用方注入（保持纯函数可测）
 */
export function nextState(status, { todayBeijing, prevState, note = '', nowISO = '' }) {
  const sameDay = prevState?.beijingDay === todayBeijing;
  const prevAttempts = sameDay ? (prevState?.attempts ?? 0) : 0;
  return {
    beijingDay: todayBeijing,
    status,
    // released / failed 都消耗一次尝试；missed 是窗口超时的终态标记，不计尝试
    attempts: status === 'missed' ? prevAttempts : prevAttempts + 1,
    consecutiveMissedDays: computeConsecutiveMissedDays(status, { todayBeijing, prevState }),
    note,
    updatedAt: nowISO,
  };
}

// ── 批次状态读写（2026-07-18 双批发布：状态文件从「全天一个 status」升级为「每批一个 slice」）──
//
// 决策纯函数不感知批次；这里把「某批 slice」当独立 scope 在完整状态文件里读进 / 写回。
// 批次间完全独立（互不重置、互不覆盖），故 selectBatchState 直接返回该批 slice（含其自身
// beijingDay），跨天 / 幂等 / 重试上限判定全部交给决策纯函数按该 slice 的 beijingDay 处理。

/**
 * 从完整状态文件取某批次的「决策用切片」（喂给 decideTickAction / nextState 的 prevState）。
 * @param {object|null} fullState 状态文件解析结果（无文件传 null）
 * @param {string} batchId
 * @returns {{beijingDay:string,status?:string,attempts?:number,consecutiveMissedDays?:number}|null}
 *   该批从未跑过（本 schema 缺该批 slice）→ null（决策按「无状态」从头开始）。
 */
export function selectBatchState(fullState, batchId) {
  if (!fullState || typeof fullState !== 'object') return null;
  const slice = fullState.batches && typeof fullState.batches === 'object'
    ? fullState.batches[batchId] : undefined;
  if (slice && typeof slice === 'object' && slice.beijingDay) return slice;
  // 旧扁平 schema 兼容（2026-07-18 前）：无 batches 字段但有顶层 status → 当作早批的延续读一次，
  // 晚批读不到（返回 null）从零起。仅影响升级当天的 consecutiveMissedDays 归并，无数据损失。
  if (!fullState.batches && fullState.beijingDay && fullState.status && batchId === EARLY_BATCH.id) {
    return {
      beijingDay: fullState.beijingDay,
      status: fullState.status,
      attempts: fullState.attempts ?? 0,
      consecutiveMissedDays: fullState.consecutiveMissedDays ?? 0,
    };
  }
  return null;
}

/**
 * 把某批次的新 slice（nextState 返回值）合并进完整状态文件（纯函数；调用方负责落盘）。
 * 只更新该批 slice，其余批次 slice 原样保留（跨天也不清除——各批按自身 slice.beijingDay
 * 独立判跨天，避免「早批先写导致晚批昨日 slice 被丢、连续错过天数归并失真」）。
 * 从旧扁平 schema 首次写入时自动升级为 batches 结构。
 * @param {object|null} fullState
 * @param {string} batchId
 * @param {{beijingDay:string,status:string,attempts:number,consecutiveMissedDays:number,note?:string,updatedAt?:string}} newSlice
 * @returns {object} 新的完整状态文件内容
 */
export function mergeBatchState(fullState, batchId, newSlice) {
  const prevBatches = (fullState && typeof fullState.batches === 'object' && fullState.batches)
    ? { ...fullState.batches } : {};
  // 🔴 旧扁平 schema 迁移：首次写入若旧文件是扁平态（无 batches 但有 status），先把它物化成
  // early slice 再合并目标批——与 selectBatchState 的 legacy 读取对称。否则「旧态=released +
  // 本次先写 late」会丢掉旧的 early 幂等记录，下个 tick 把早批当没跑过而重复发布（P1-3）。
  if (fullState && !fullState.batches && fullState.beijingDay && fullState.status
      && !prevBatches[EARLY_BATCH.id]) {
    prevBatches[EARLY_BATCH.id] = {
      beijingDay: fullState.beijingDay,
      status: fullState.status,
      attempts: fullState.attempts ?? 0,
      consecutiveMissedDays: fullState.consecutiveMissedDays ?? 0,
      note: fullState.note ?? '',
      updatedAt: fullState.updatedAt ?? '',
    };
  }
  return {
    beijingDay: newSlice.beijingDay, // 顶层仅展示用：最后写入批次的北京日
    batches: {
      ...prevBatches,
      [batchId]: {
        beijingDay: newSlice.beijingDay,
        status: newSlice.status,
        attempts: newSlice.attempts,
        consecutiveMissedDays: newSlice.consecutiveMissedDays,
        note: newSlice.note ?? '',
        updatedAt: newSlice.updatedAt ?? '',
      },
    },
    updatedAt: newSlice.updatedAt ?? '',
  };
}

/**
 * 返回某批次「今天尚未满足」的前置依赖批次 id（依赖满足 = 该前置批当天 status==='released'）。
 * 用于晚批 fail-closed：早批当天未成功就不发晚批（防混新鲜度：晚批 renewal_tracker /
 * new_energy_claims 依赖早批产出的 policy）。纯函数，watcher / sync-and-reload 共用。
 * @param {{dependsOn?:readonly string[]}} batch 批次配置（release-batches.mjs）
 * @param {object|null} fullState 状态文件解析结果
 * @param {string} todayBeijing 北京今天 YYYY-MM-DD
 * @returns {string[]} 未满足的前置批 id（空数组 = 依赖全部满足）
 */
export function unmetDependencies(batch, fullState, todayBeijing) {
  const deps = batch?.dependsOn ?? [];
  const unmet = [];
  for (const depId of deps) {
    const slice = selectBatchState(fullState, depId);
    if (!slice || slice.beijingDay !== todayBeijing || slice.status !== 'released') unmet.push(depId);
  }
  return unmet;
}
