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
      node_args: '--max-old-space-size=2048', // 2GB 内存限制

      // 环境变量（默认 = 生产环境，pm2 restart 不带 --env 时使用此块）
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        VPS_MODE: 'true',
        CORS_ORIGIN: 'https://chexian.cretvalu.com',
        DUCKDB_MAX_MEMORY: '1536MB',
        DUCKDB_THREADS: '2',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        VPS_MODE: 'true',
        CORS_ORIGIN: 'https://chexian.cretvalu.com',
        DUCKDB_MAX_MEMORY: '1536MB',
        DUCKDB_THREADS: '2',
      },

      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/chexian/api-error.log',
      out_file: '/var/log/chexian/api-out.log',
      merge_logs: true,
      log_type: 'json',

      // 自动重启配置
      max_memory_restart: '2048M', // 启动加载 Parquet+索引峰值约 1.5G，稳态约 800M
      restart_delay: 5000, // 重启间隔 5 秒（给 OS 回收内存）
      max_restarts: 5, // 最多重启 5 次（减少 OOM 循环）
      min_uptime: '30s', // 最小运行时间（启动加载需 30-40s）

      // 监控配置
      watch: false, // 生产环境不监听文件变化
      ignore_watch: ['node_modules', 'logs', 'data'],

      // 优雅关闭
      kill_timeout: 5000, // 5 秒后强制关闭
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
