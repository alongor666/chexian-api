/**
 * 全自动日常发布 watcher 的「窗口 × 当日状态」决策纯函数
 *
 * 背景：launchd 每 N 分钟拉起一次 scripts/auto-release-daily.mjs，本模块决定这一次
 * tick 该做什么——探测上游 / 静默跳过 / 标记当天错过 / 停止重试。把状态机从副作用
 * 编排里抽出来，行为全部可 vitest 锁定。
 *
 * 状态文件（数据管理/logs/auto-release-state.json）语义：
 *   { beijingDay, status: 'released'|'failed'|'missed', attempts, ... }
 *   - released：当天已成功发布 → 后续 tick 全部跳过（幂等护栏）
 *   - failed：release:daily 跑过但失败；attempts < maxAttempts 时窗口内可重试
 *   - missed：窗口结束仍未就绪/未成功，已告警 → 当天不再动作，等人工
 *   - 跨天（state.beijingDay ≠ 今天）视为无状态，从头开始
 *
 * 时间一律北京时区（上游出表节奏以北京为准；本机时钟时区不可信，调用方负责换算）。
 *
 * 无副作用、不读文件系统 / env / 时钟，可被 vitest 直接 import。
 */

/** 默认发布窗口（北京时间）：上游约 09:30 出 01/03/04/05、10:30 出 02，故 10:35 起窗。 */
export const DEFAULT_WINDOW = Object.freeze({ start: '10:35', end: '14:00' });

/** release:daily 失败后的当天最大尝试次数（超过即告警停手，等人工）。 */
export const DEFAULT_MAX_ATTEMPTS = 2;

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
 * 组装下一份状态文件内容（纯函数；调用方负责落盘）。
 * @param {'released'|'failed'|'missed'} status
 * @param {object} opts
 * @param {string} opts.todayBeijing
 * @param {{beijingDay?:string,attempts?:number}|null} opts.prevState
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
    note,
    updatedAt: nowISO,
  };
}
