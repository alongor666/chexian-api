import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { classifyReportExit } from '../数据管理/lib/report-exit.mjs';

// 四种形态均为 Node 26 spawnSync 实测值（PR #1169 评审验证表 + 本机复测一致），
// 防止再用 status/error 有无做错误推断。
describe('classifyReportExit（报告子进程退出分类 · PR #1169 评审 F1）', () => {
  it('真超时：status=null + signal=SIGTERM + error.code=ETIMEDOUT → timeout', () => {
    const r = classifyReportExit({
      status: null,
      signal: 'SIGTERM',
      error: { code: 'ETIMEDOUT' },
    });
    expect(r.kind).toBe('timeout');
    expect(r.hint).toContain('PERIOD_TREND_REPORT_TIMEOUT_MINUTES');
  });

  it('OOM killer / 外部 SIGKILL：status=null + signal=SIGKILL + 无 error → killed（且不建议放宽超时）', () => {
    const r = classifyReportExit({ status: null, signal: 'SIGKILL', error: null });
    expect(r.kind).toBe('killed');
    expect(r.hint).toContain('OOM');
    expect(r.hint).not.toContain('PERIOD_TREND_REPORT_TIMEOUT_MINUTES');
  });

  it('启动失败：status=null + signal=null + error.code=ENOENT → launch-error', () => {
    const r = classifyReportExit({ status: null, signal: null, error: { code: 'ENOENT' } });
    expect(r.kind).toBe('launch-error');
    expect(r.hint).toContain('ENOENT');
  });

  it('正常非零退出：status=3 → nonzero（无附加提示）', () => {
    const r = classifyReportExit({ status: 3, signal: null, error: undefined });
    expect(r.kind).toBe('nonzero');
    expect(r.hint).toBe('');
  });

  it('成功：status=0 → ok', () => {
    expect(classifyReportExit({ status: 0, signal: null }).kind).toBe('ok');
  });

  it('其他信号终止（如 SIGTERM 但无 error，外部 kill）→ killed 且带信号名', () => {
    const r = classifyReportExit({ status: null, signal: 'SIGTERM', error: null });
    expect(r.kind).toBe('killed');
    expect(r.hint).toContain('SIGTERM');
  });
});
