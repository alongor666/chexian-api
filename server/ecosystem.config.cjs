/**
 * PM2 部署配置
 * 用于生产环境进程管理
 *
 * 使用方式：
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart chexian-api
 *   pm2 logs chexian-api
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'chexian-api',
      script: 'dist/app.js',
      cwd: '/var/www/chexian/server',
      instances: 1, // 单实例，DuckDB 不支持多进程共享
      exec_mode: 'fork',
      node_args: '--max-old-space-size=3072', // 3GB Node 堆（route-cache 400MB + 业务数据 + 兜底）

      // 环境变量（默认 = 生产环境，pm2 restart 不带 --env 时使用此块）
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        VPS_MODE: 'true',
        CORS_ORIGIN: 'https://chexian.cretvalu.com',
        DUCKDB_MAX_MEMORY: '1536MB',
        DUCKDB_THREADS: '2',
        // v5 状态持久层 Phase 3 启用：state.db 的 api_tokens / access_users / access_roles 为主权威
        // 启用前必须先 SSH VPS 跑 admin-import-{pat,users}-from-json，并确认 lock 文件已写、
        // SQLite COUNT 与 JSON length 一致（参见 docs/migration/phase3-vps-rollout-runbook.md §1-§2）。
        // Rollback：本块 revert PR；或临时 `STATE_STORE_BACKEND=json pm2 restart chexian-api --update-env`
        // （注意：PM2 `--env <name>` 只选 ecosystem 内的 env_<name> 块，不能用来设单个变量；
        //  要让 PM2 重读 process.env 必须用 shell 前缀赋值 + --update-env。codex P1 PR#391 修正）
        STATE_STORE_BACKEND: 'sqlite',
        STATE_DB_PATH: '/var/www/chexian/server/data/state.db',
        // 综合分析视图开放度（权限治理 Critical-1，镜像前端 .env.production 的
        // VITE_ENABLE_COMPREHENSIVE_ANALYSIS='true'，两处必须同步）：
        // 'true' = 全员开放（生产现状，后端 cost 闸旁路）；改 'false' 全关；
        // 删除本行 = 按用户 specialFeatures 'cost' 强制（届时前端构建变量须同步撤）。
        ENABLE_COMPREHENSIVE_ANALYSIS: 'true',
        // 通用立方体灰度阶段 2 · 部分切流（BACKLOG uid=2026-06-11-claude-90a92c；
        // 用户 2026-07-09 拍板切流，审计报告：开发文档/reviews/2026-07-09-后端查询性能审计.md）：
        // - CUBE_ROUTING_ROUTES 白名单内三路由（自 2026-06-12 影子对账至今 mismatch=0）
        //   对外直返立方体结果——缓存未命中的冷路径从秒级降至毫秒级；不可服务的筛选组合自动回退原路径。
        // - cost / kpi 不在白名单：留在影子期继续验证（探针 OOM 修复后 cost 立方体需先在生产证明
        //   exact=true + 影子零差异，再扩入白名单）。
        // - CUBE_SHADOW_COMPARE 保留 'true'：对未切流路由（cost/kpi）继续影子对账；
        //   对已切流路由自动互斥失效（cube-routing.ts RED LINE），不会双跑。
        // - CUBE_SHADOW_SAMPLE_RATE=0.05：已切流路由按 5% 采样后台对账 legacy（R3 缺口闭环，
        //   BACKLOG bf2c4e）——切流后语义漂移仍有生产 oracle，不伤请求时延。
        // 观测面：GET /health 的 cubes + cubeShadow（计数器已落盘跨 reload 累计）；晋级判定
        // node scripts/release/cube-promote.mjs。
        // 回滚：node scripts/cube-rollback.mjs，或 VPS 上改 CUBE_ROUTING_ENABLED='false' +
        // sudo /usr/local/bin/deploy-chexian-api reload（回到纯影子期，与多分公司 RLS 回滚同套路）。
        CUBE_SHADOW_COMPARE: 'true',
        CUBE_ROUTING_ENABLED: 'true',
        CUBE_ROUTING_ROUTES: 'trend,growth,salesman-ranking',
        CUBE_SHADOW_SAMPLE_RATE: '0.05',
        // cx sql 派生域联邦切流（PR #676 P0 + #677 P0.5，计划 .claude/plans/cx-cli-swift-pudding.md）：
        // 'true' = cx sql 准入从单一 PolicyFact 扩展为已实证权限列的派生视图（RenewalTrackerFact/
        // QuoteConversion/CrossSellFact/NewEnergyClaims direct + BrandDim/PlateRegionMap exempt），
        // 每视图 fail-closed RLS（过滤列缺失即拒绝，绝不丢弃过滤）。PolicyFact 行为逐字节不变。
        // 历史硬前置（已解除·山西 cutover 2026-06-25 开 RLS）：原要求 BRANCH_RLS_ENABLED=false，
        // 因派生视图缺 branch_code 列开 RLS 会 fail-closed；现状与残留 follow-up 见下方 BRANCH_RLS_ENABLED 注释。
        // 本地全栈预验证：续保逐机构与 duckdb 基线零差异 + RLS 隔离 + 边界拒绝 + fail-closed
        // 全绿（见 pr-evolution.md 2026-06-19 两条记分卡）。
        // 回滚：删除本行 revert PR，或 VPS 上改 'false' + sudo /usr/local/bin/deploy-chexian-api reload。
        SQL_FEDERATION_ENABLED: 'true',
        // 多分公司行级安全（山西 cutover · 2026-06-25 开启）：按用户 branchCode 注入 branch_code 过滤。
        // 派生视图 branch_code 列就绪进度：PolicyFact / claims_detail / RepairDim / QuoteConversion /
        // CustomerFlow / CrossSellDailyAgg / RenewalTrackerFact 均已含列（RenewalTrackerFact 自 P3-C #765
        // ETL 派生 + loader selectUnionWithBranchCode COALESCE 兜底 NULL）；renewal 的 typed/cube/agent
        // 路由分省下推（branch_admin 续保隔离）已由 PR #804 收口。残留：生产 renewal_tracker parquet 的
        // branch_code 列/NULL 实测 + SX 续保行回填（数据完整性 follow-up，不影响隔离——SX branch_admin
        // 最坏看空续保页，绝无 SC 泄漏）。
        // 回滚：scripts/rollback-multi-branch.mjs --apply（改回 false + reload）。
        BRANCH_RLS_ENABLED: 'true',
      },

      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/chexian/api-error.log',
      out_file: '/var/log/chexian/api-out.log',
      merge_logs: true,
      log_type: 'json',

      // 自动重启配置
      max_memory_restart: '3500M', // DuckDB ~1.5G + Node 稳态 800M + route-cache 400MB → 4G VPS 留 500MB 安全边际
      restart_delay: 5000, // 重启间隔 5 秒（给 OS 回收内存）
      max_restarts: 5, // 最多重启 5 次（减少 OOM 循环）
      min_uptime: '30s', // 最小运行时间（启动加载需 30-40s）

      // 监控配置
      watch: false, // 生产环境不监听文件变化
      ignore_watch: ['node_modules', 'logs', 'data'],

      // 优雅关闭
      // 必须 > duckdb-infra.ts 的 DRAIN_TIMEOUT_MS(10s) + 缓冲，否则 gracefulShutdown 想排空
      // 在跑的（含慢）查询时会在 drain 完成前被 PM2 SIGKILL 强杀，精心写的优雅关闭形同虚设。
      // 无在途查询时 drain 立即返回，正常 reload 不受此上限影响、仍是秒级。
      kill_timeout: 15000, // 15 秒后强制关闭（覆盖 DuckDB 连接池 10s drain 窗口 + 5s 缓冲）
      wait_ready: true, // 等待 ready 信号（app.ts 数据加载完发 process.send('ready')）
      listen_timeout: 120000, // 120 秒启动超时（Parquet 加载+索引创建约 30-60s）
    },
  ],

  // 部署配置 — 未使用，CI/CD 走 deploy.yml + deploy-chexian-api wrapper
  // 保留仅作参考，实际部署命令:
  //   sudo /usr/local/bin/deploy-chexian-api install
  //   sudo /usr/local/bin/deploy-chexian-api reload
  deploy: {
    production: {
      user: 'root',
      host: ['YOUR_SERVER_IP'],
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_REPO.git',
      path: '/var/www/chexian',
      'pre-deploy-local': '',
      'post-deploy':
        'sudo /usr/local/bin/deploy-chexian-api install && sudo /usr/local/bin/deploy-chexian-api reload',
      'pre-setup': '',
    },
  },
};
