#!/usr/bin/env node
/**
 * cx — chexian-api 只读 CLI
 *
 * 鉴权：PAT（Personal Access Token）
 * 权限：完全继承 PAT 关联用户（allowedRoutes / dataScope / organization）
 * 限制：强制只读，仅 GET /api/query/* 与 /api/data/* 部分端点
 */
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { routesCommand } from './commands/routes.js';
import { queryCommand, parseExtraParams } from './commands/query.js';

const program = new Command();

program
  .name('cx')
  .description('chexian-api 只读 CLI (PAT auth)')
  .version('0.1.0');

program
  .command('login')
  .description('保存 PAT 到 ~/.chexian/config.json')
  .option('-t, --token <pat>', '直接传入 PAT（也支持 stdin/交互式）')
  .option('-b, --base-url <url>', '后端 baseUrl，覆盖默认 https://chexian.cretvalu.com')
  .action(loginCommand);

program
  .command('logout')
  .description('清除本地保存的 PAT（不会吊销服务端 token）')
  .action(logoutCommand);

program
  .command('whoami')
  .description('显示当前 PAT 对应的用户与角色')
  .action(whoamiCommand);

program
  .command('routes')
  .description('列出所有可用 query 路由')
  .option('--refresh', '强制刷新 route-catalog 缓存')
  .option('--tag <tag>', '按 tag 过滤（如 kpi / trend / cross-sell）')
  .action(routesCommand);

program
  .command('query <key>')
  .description('调用查询路由：cx query KPI [--year=2026] [--org_level_3=分公司A] [--format=json]')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .option('-f, --format <fmt>', '输出格式 table|json|csv', 'table')
  .action((key, options, cmd) => {
    const extras = parseExtraParams(cmd.args.slice(1));
    queryCommand(key, { format: options.format, params: extras });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
