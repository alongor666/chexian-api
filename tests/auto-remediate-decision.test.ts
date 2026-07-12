/**
 * 发布停更「自动接手」决策纯函数单测（BACKLOG 2026-07-12-claude-966ae7 · 审计 FIND-001）
 * 锁死分级自主（Tier1 自处置 / Tier2 待确认）+ 每日幂等 + 失败分类。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TIER1,
  DEFAULT_MIN_RELEASE_ATTEMPTS,
  classifyReleaseFailure,
  decideRemediation,
  nextRemediateState,
} from '../数据管理/lib/auto-remediate-decision.mjs';
// @ts-expect-error — 纯 JS 模块，无类型声明
import { DEFAULT_MAX_ATTEMPTS } from '../数据管理/lib/auto-release-decision.mjs';

const TODAY = '2026-07-12';

describe('🔴 并发闸常量防漂移（2026-07-12 code-reviewer 发现：两个常量靠注释手动同步，无自动检查）', () => {
  it('DEFAULT_MIN_RELEASE_ATTEMPTS 必须等于 auto-release-decision 的 DEFAULT_MAX_ATTEMPTS', () => {
    // 这两个常量分属两个模块、故意不互相 import（避免运行时耦合，见 auto-remediate-decision.mjs
    // 注释），只靠人工同步维护——本测试把"忘记同步"从静默 bug 转成 CI 红灯：任一方改了
    // 重试上限而忘记同步另一方，此测试立即失败，而不是等并发跑 release:daily 撞车才发现。
    expect(DEFAULT_MIN_RELEASE_ATTEMPTS).toBe(DEFAULT_MAX_ATTEMPTS);
  });
});

describe('decideRemediation', () => {
  it('今日发布未失败（released/无状态）→ skip', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'released' }, remediateState: null, todayBeijing: TODAY }).action).toBe('skip');
    expect(decideRemediation({ releaseState: null, remediateState: null, todayBeijing: TODAY }).action).toBe('skip');
  });

  it('发布状态是昨天的失败 → skip（不接手历史）', () => {
    expect(decideRemediation({ releaseState: { beijingDay: '2026-07-11', status: 'failed' }, remediateState: null, todayBeijing: TODAY }).action).toBe('skip');
  });

  it('今日 failed 且未接手过 → tier1-retry（轻风险自处置）', () => {
    const d = decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MIN_RELEASE_ATTEMPTS }, remediateState: null, todayBeijing: TODAY });
    expect(d.action).toBe('tier1-retry');
  });

  it('今日 missed 同样触发接手', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'missed' }, remediateState: null, todayBeijing: TODAY }).action).toBe('tier1-retry');
  });

  it('Tier1 已用尽（tier1Attempts>=max）→ tier2-diagnose（重风险待确认）', () => {
    const d = decideRemediation({
      releaseState: { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MIN_RELEASE_ATTEMPTS },
      remediateState: { beijingDay: TODAY, status: 'tier1-failed', tier1Attempts: DEFAULT_MAX_TIER1 },
      todayBeijing: TODAY,
    });
    expect(d.action).toBe('tier2-diagnose');
  });

  it('并发闸：failed 但 attempts<DEFAULT_MIN_RELEASE_ATTEMPTS（auto-release 仍在重试）→ skip（防并发跑 release:daily）', () => {
    const d = decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MIN_RELEASE_ATTEMPTS - 1 }, remediateState: null, todayBeijing: TODAY });
    expect(d.action).toBe('skip');
    expect(d.reason).toMatch(/仍在重试|防并发/);
  });

  it('并发闸：failed 且 attempts>=DEFAULT_MIN_RELEASE_ATTEMPTS（auto-release 已停手）→ tier1-retry', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MIN_RELEASE_ATTEMPTS }, remediateState: null, todayBeijing: TODAY }).action).toBe('tier1-retry');
  });

  it('并发闸：missed 天然已停手，attempts 缺省也接手', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'missed' }, remediateState: null, todayBeijing: TODAY }).action).toBe('tier1-retry');
  });

  it('已 recovered → skip（幂等，不重复接手）', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed' }, remediateState: { beijingDay: TODAY, status: 'recovered', tier1Attempts: 1 }, todayBeijing: TODAY }).action).toBe('skip');
  });

  it('已 tier2-awaiting → skip（等人工确认，不再自动动作）', () => {
    expect(decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed' }, remediateState: { beijingDay: TODAY, status: 'tier2-awaiting', tier1Attempts: 1 }, todayBeijing: TODAY }).action).toBe('skip');
  });

  it('昨天的接手状态在今天视为无（重新从 Tier1 起）', () => {
    const d = decideRemediation({ releaseState: { beijingDay: TODAY, status: 'failed', attempts: DEFAULT_MIN_RELEASE_ATTEMPTS }, remediateState: { beijingDay: '2026-07-11', status: 'tier2-awaiting', tier1Attempts: 3 }, todayBeijing: TODAY });
    expect(d.action).toBe('tier1-retry');
  });
});

describe('nextRemediateState', () => {
  it('recovered / tier1-failed 各消耗一次 Tier1 尝试', () => {
    expect(nextRemediateState('tier1-failed', { todayBeijing: TODAY, prevState: null }).tier1Attempts).toBe(1);
    expect(nextRemediateState('recovered', { todayBeijing: TODAY, prevState: { beijingDay: TODAY, tier1Attempts: 0 } }).tier1Attempts).toBe(1);
  });

  it('tier2-awaiting 不再加 Tier1 尝试（Tier1 用尽后的终态）', () => {
    expect(nextRemediateState('tier2-awaiting', { todayBeijing: TODAY, prevState: { beijingDay: TODAY, tier1Attempts: 1 } }).tier1Attempts).toBe(1);
  });

  it('跨天重置尝试计数', () => {
    expect(nextRemediateState('tier1-failed', { todayBeijing: TODAY, prevState: { beijingDay: '2026-07-11', tier1Attempts: 5 } }).tier1Attempts).toBe(1);
  });
});

describe('classifyReleaseFailure', () => {
  it('governance USER_PASSWORDS 阻断 → governance-user-passwords（提示勿自动改密钥）', () => {
    const r = classifyReleaseFailure('[✗] 自助设密账号禁入USER_PASSWORDS：server/.env 含自助设密账号 yaoqian');
    expect(r.category).toBe('governance-user-passwords');
    expect(r.hint).toMatch(/人工剔除/);
  });

  it('网络抖动 → network', () => {
    expect(classifyReleaseFailure('rsync: connection unexpectedly closed ETIMEDOUT').category).toBe('network');
  });

  it('上游未就绪 → upstream-not-ready', () => {
    expect(classifyReleaseFailure('pull-bi-exports：manifest mtime 不是北京今天，新鲜度校验中止').category).toBe('upstream-not-ready');
  });

  it('无法识别 → unknown', () => {
    expect(classifyReleaseFailure('some totally unrelated output').category).toBe('unknown');
  });
});
