/**
 * 立方体灰度 5 路由白名单 + 主 cube 配置 — 单一事实源（SSOT）。
 *
 * 新增 cube 路由只改本文件，下游自动跟上：
 *   - scripts/check-governance.mjs `checkCubeInvariants` 读 SHADOW_KEYS / MAIN_CUBES / CUBE_STATE_NAMES
 *   - scripts/cube-burnin/lib/shadow-judge.mjs 读 SHADOW_KEYS
 *   - scripts/cube-burnin/lib/route-runner.mjs 读 CUBE_ROUTES
 *
 * 字段语义：
 *   key         — 路由短名，本地用于 burn-in CLI 日志
 *   path        — HTTP path（必须与 server/src/routes/query/*.ts 注册一致）
 *   shadowKey   — 影子对账 stats key（必须与 routes/query/*.ts 的 runShadowCompare 第一参数一致）
 *   sql         — 主 cube 专属：{ file: server/src/sql/cube/ 下文件名, exports: 三件套导出函数名 }
 *   stateName   — 主 cube 专属：server/src/services/duckdb-cube.ts 中的 state 变量名
 *   reusesCubeOf — 非主 cube（growth 复用 trend、kpi 复用 cost），无独立 SQL/state
 *   retired     — 已退役路由（owner 拍板，值=依据）：保留在 CUBE_ROUTES 里让 governance
 *                 「影子路由覆盖」双向对账与 server 端接线继续成立（代码未拆），但灰度
 *                 闸门（burn-in 判定 / cube-promote 晋级）只看 ACTIVE_* 集合——否则退役
 *                 路由永远 match=0 / 立方体永不构建，切流晋级被结构性卡死（f1c991 实证）
 *
 * 历史：PR #651（governance）+ PR #652（burn-in）合并后抽出，同一白名单三处独立定义改为单源。
 * 2026-07-05 奥卡姆批次三：原 check-governance.mjs 内三张手工同步表（CUBE_REQUIRED_EXPORTS /
 * CUBE_STATE_NAMES / CUBE_FILE_NAME，注释自认"三处保持隐式同步"）下沉为本表字段——治理脚本
 * 不再自己违反它在「5路由清单SSOT」闸强制的单源原则。
 */
export const CUBE_ROUTES = Object.freeze([
  {
    key: 'trend',
    path: '/api/query/trend',
    shadowKey: 'trend',
    sql: {
      file: 'trend-cube.ts',
      exports: ['isTrendCubeServable', 'generatePremiumTrendCubeQuery', 'buildTrendCubeSql'],
    },
    stateName: 'trendCubeState',
  },
  { key: 'growth', path: '/api/query/growth', shadowKey: 'growth', reusesCubeOf: 'trend' },
  {
    key: 'cost',
    path: '/api/query/cost',
    shadowKey: 'cost',
    sql: {
      file: 'cost-cube.ts',
      exports: ['isCostCubeServable', 'generateCostCubeQuery', 'buildCostCubeSql'],
    },
    stateName: 'costCubeState',
    retired: '65f495 owner 拍板退役（2026-06-20 决策A 投产倒挂，2026-07-05 CANCELLED）',
  },
  {
    key: 'kpi', path: '/api/query/kpi', shadowKey: 'kpi', reusesCubeOf: 'cost',
    retired: '随 cost 退役（复用 cost 立方体，65f495）',
  },
  {
    key: 'salesman',
    path: '/api/query/salesman-ranking',
    shadowKey: 'salesman-ranking',
    // 文件名为 salesman-cube.ts，但导出函数命名为 generateSalesmanRankingCubeQuery（历史命名）
    sql: {
      file: 'salesman-cube.ts',
      exports: ['isSalesmanCubeServable', 'generateSalesmanRankingCubeQuery', 'buildSalesmanCubeSql'],
    },
    stateName: 'salesmanCubeState',
  },
]);

export const SHADOW_KEYS = Object.freeze(CUBE_ROUTES.map(r => r.shadowKey));

/** 有独立 SQL 物化的主 cube（growth/kpi 复用 trend/cost，不在此列） */
export const MAIN_CUBES = Object.freeze(CUBE_ROUTES.filter(r => r.sql));

/** duckdb-cube.ts 中的 state 变量名清单（版本绑定闸消费） */
export const CUBE_STATE_NAMES = Object.freeze(MAIN_CUBES.map(r => r.stateName));

// ── 活跃集合（灰度闸门专用，排除 retired）──────────────────────────────
// 消费方：cube-promote-judge（晋级门槛）/ cube-burnin shadow-judge（burn-in 判定）
//         / route-runner（不再对退役路由打流量）。
// governance「影子路由覆盖」双向对账仍用全量 SHADOW_KEYS（server 端 5 路由接线未拆）。

/** 未退役的灰度路由（切流白名单口径：trend / growth / salesman-ranking） */
export const ACTIVE_CUBE_ROUTES = Object.freeze(CUBE_ROUTES.filter(r => !r.retired));

/** 未退役路由的影子对账 key（晋级/判定闸门只看这些） */
export const ACTIVE_SHADOW_KEYS = Object.freeze(ACTIVE_CUBE_ROUTES.map(r => r.shadowKey));

/** 未退役的主 cube（构建健康检查只看这些：trend / salesman） */
export const ACTIVE_MAIN_CUBES = Object.freeze(ACTIVE_CUBE_ROUTES.filter(r => r.sql));
