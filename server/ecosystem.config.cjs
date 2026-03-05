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

      // 环境变量
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // VPS 运行模式：实时查询
        VPS_MODE: 'true',
        // DuckDB 内存限制（实时查询）
        DUCKDB_MAX_MEMORY: '400MB',
        DUCKDB_THREADS: '2',
      },

      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/chexian/api-error.log',
      out_file: '/var/log/chexian/api-out.log',
      merge_logs: true,
      log_type: 'json',

      // 自动重启配置
      max_memory_restart: '600M', // 实时查询模式下建议 < 600MB
      restart_delay: 3000, // 重启间隔 3 秒
      max_restarts: 10, // 最多重启 10 次
      min_uptime: '10s', // 最小运行时间

      // 监控配置
      watch: false, // 生产环境不监听文件变化
      ignore_watch: ['node_modules', 'logs', 'data'],

      // 优雅关闭
      kill_timeout: 5000, // 5 秒后强制关闭
      wait_ready: true, // 等待 ready 信号
      listen_timeout: 10000, // 10 秒启动超时
    },
  ],

  // 部署配置（可选，用于远程部署）
  deploy: {
    production: {
      user: 'root',
      host: ['YOUR_SERVER_IP'], // 替换为实际服务器 IP
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_REPO.git', // 替换为实际仓库
      path: '/var/www/chexian',
      'pre-deploy-local': '',
      'post-deploy':
        'cd server && npm install && npm run build && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': '',
    },
  },
};
