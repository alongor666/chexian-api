/**
 * 报告子进程退出分类（PR #1169 评审 F1 修正）。
 *
 * 背景：spawnSync 的退出信息有四种典型形态，此前用
 * `status === null && !error` 判"超时"是错的——实测（Node 26，PR #1169 评审
 * 验证表 + 本机复测一致）：
 *   - 真超时（timeout 选项触发）：status=null, signal=SIGTERM, error.code='ETIMEDOUT'
 *     → 旧判据因 error 非空而**恒漏报**；
 *   - OOM killer / 外部 SIGKILL：status=null, signal=SIGKILL, error=undefined
 *     → 旧判据**误报**为超时，且"放宽超时"的建议对内存不足毫无帮助；
 *   - 启动失败（可执行不存在）：status=null, signal=null, error.code='ENOENT'；
 *   - 正常非零退出：status=N, signal=null, error=undefined。
 * 正确判别键是 error.code 与 signal，不是 error 的有无。
 *
 * 纯函数、无副作用，供 daily.mjs runPeriodTrendReport 与单测共用
 * （daily.mjs 顶层直接执行 main，无法被测试安全 import，故判定逻辑下沉到本文件）。
 */

/**
 * @param {{ status: number|null, signal?: string|null, error?: { code?: string, message?: string }|null }} result
 *   spawnSync 返回对象（只读取 status / signal / error.code）
 * @returns {{ kind: 'ok'|'timeout'|'killed'|'launch-error'|'nonzero', hint: string }}
 *   kind 分类 + 面向排查者的中文提示（ok 时为空串）
 */
export function classifyReportExit(result) {
  if (result.status === 0) return { kind: 'ok', hint: '' };
  if (result.error?.code === 'ETIMEDOUT') {
    return {
      kind: 'timeout',
      hint: '子进程超时被杀（spawnSync timeout），可设 PERIOD_TREND_REPORT_TIMEOUT_MINUTES 放宽',
    };
  }
  if (result.error) {
    return {
      kind: 'launch-error',
      hint: `子进程启动失败（${result.error.code ?? result.error.message ?? '未知错误'}），检查 python3 与脚本路径`,
    };
  }
  if (result.status === null && result.signal === 'SIGKILL') {
    return {
      kind: 'killed',
      hint: '子进程被 SIGKILL 击杀（疑似内存不足被系统 OOM killer 终止）——放宽超时无效，应降低 DuckDB 内存占用（PERIOD_TREND_DUCKDB_* 环境变量）或加 swap',
    };
  }
  if (result.status === null) {
    return {
      kind: 'killed',
      hint: `子进程被信号终止（signal=${result.signal ?? '未知'}）`,
    };
  }
  return { kind: 'nonzero', hint: '' };
}
