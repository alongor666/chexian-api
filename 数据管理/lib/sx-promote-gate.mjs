/**
 * SX 自动晋升安全闸 — 纯决策函数（2026-07-09）
 *
 * 背景：`scripts/release/sx-promote.mjs`（validation/SX → current/SX/）此前完全没有接入
 * `release:daily` 自动化链路（`grep -rn "sx-promote" package.json scripts/*.mjs scripts/release/*.mjs`
 * 除脚本自身零引用），必须人工手动带 `--rls-confirmed` 触发。实况：2026-07-09 上游山西数据
 * 已导出到 07-08、本地 ETL 也已把数据转换进 validation/SX/，但因无人手动跑晋升脚本，
 * 生产端 SX 保单数据滞后 2 天且**零告警**——直到人工排查才发现。
 *
 * 本模块把"是否允许本次自动晋升"的判定抽成无副作用纯函数，被
 * `scripts/sync-vps.mjs` 的 `runSxAutoPromote()` 调用（该函数负责副作用：SSH 查询生产
 * `BRANCH_RLS_ENABLED` 运行时取值、按判定结果决定是否 spawn `sx-promote.mjs --apply
 * --auto-verified-rls`）。判定语义刻意 fail-closed：
 *
 *   - 本地无 validation/SX/ 目录（纯 SC 部署 / 未跑分省 ETL）→ 'skip'，不触发任何动作，
 *     零行为变化——不影响纯四川场景。
 *   - 生产 RLS 状态查询到明确 true → 'promote'，允许自动晋升。
 *   - 生产 RLS 状态查询到明确 false（真实查到、非查询失败）→ 'block'，安全配置未就绪，
 *     拒绝晋升——不是"数据问题"，重试也没用，需要人工介入服务端配置。
 *   - 生产 RLS 状态查询失败（网络异常/端点不可用/响应格式异常，rlsEnabled === null）→ 'block'，
 *     安全默认拒绝——不能因为"查不到"就放行晋升，那等于把这道安全闸变成摆设。
 *     调用方应让整条 sync-vps.mjs 非零退出（响亮失败），而非静默跳过继续用陈旧 SX 数据。
 *     区别于 evaluateFreshness()（数据新鲜度闸，查询失败时 'skip' 降级放行）——本闸是安全闸，
 *     语义不同：数据新鲜度差是"这次同步质量可能打折"，RLS 未核实是"这次晋升可能让新数据
 *     在没有省份隔离保护时对外可见"，两者代价不对等，故默认方向相反。
 *
 * 无副作用、不读文件系统 / 网络，可被 vitest 直接 import。
 */

/**
 * @param {{ validationSxExists: boolean, rlsEnabled: boolean | null }} input
 *   rlsEnabled: true=已核实开启 / false=已核实关闭 / null=查询失败或未查询（安全默认同 false 处理，但 reason 区分）
 * @returns {{ verdict: 'skip' | 'promote' | 'block', reason: string }}
 */
export function evaluateSxAutoPromoteReadiness({ validationSxExists, rlsEnabled }) {
  if (!validationSxExists) {
    return {
      verdict: 'skip',
      reason: '本地无 数据管理/warehouse/validation/SX/ 目录（非 SX 部署或本次未跑分省 ETL），跳过自动晋升',
    };
  }
  if (rlsEnabled === true) {
    return {
      verdict: 'promote',
      reason: 'VPS 生产 BRANCH_RLS_ENABLED=true 已实时核实（GET /internal/data-fingerprint），允许自动晋升',
    };
  }
  if (rlsEnabled === false) {
    return {
      verdict: 'block',
      reason: 'VPS 生产 BRANCH_RLS_ENABLED=false（已实时核实，非查询失败）——RLS 未开启前拒绝自动晋升 SX 数据，'
        + '防止新数据在无省份行级隔离保护时对外可见。需人工核实服务端配置后手动运行 '
        + 'node scripts/release/sx-promote.mjs --apply --rls-confirmed',
    };
  }
  return {
    verdict: 'block',
    reason: 'VPS RLS 状态查询失败（端点不可用 / 网络异常 / 响应格式异常）——安全默认拒绝自动晋升，'
      + '不能因查询失败就放行（否则安全闸形同虚设）。请核实 VPS 连通性与 '
      + '/internal/data-fingerprint 端点是否正常，或人工运行 '
      + 'node scripts/release/sx-promote.mjs --apply --rls-confirmed',
  };
}
