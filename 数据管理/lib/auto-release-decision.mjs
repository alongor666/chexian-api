/**
 * 全自动日常发布 watcher 的「窗口 × 当日状态」决策纯函数
 *
 * 背景：launchd 每 N 分钟拉起一次 scripts/auto-release-daily.mjs，本模块决定这一次
 * tick 该做什么——探测上游 / 静默跳过 / 标记当天错过 / 停止重试。把状态机从副作用
 * 编排里抽出来，行为全部可 vitest 锁定。
 *
 * 状态文件（数据管理/logs/auto-release-state.json）语义：
 *   { beijingDay, status: 'released'|'failed'|'missed', attempts, consecutiveMissedDays, ... }
 *   - released：当天已成功发布 → 后续 tick 全部跳过（幂等护栏）
 *   - failed：release:daily 跑过但失败；attempts < maxAttempts 时窗口内可重试
 *   - missed：窗口结束仍未就绪/未成功，已告警 → 当天不再动作，等人工
 *   - 跨天（state.beijingDay ≠ 今天）视为无状态，从头开始（attempts 归零）
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

/**
 * 默认发布窗口（北京时间）：上游约 09:30 出 01/03/04/05、10:30 出 02，故 10:35 起窗。
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
