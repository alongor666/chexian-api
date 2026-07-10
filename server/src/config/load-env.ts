/**
 * env 文件加载（必须是 app.ts 的第一条 import，先于任何读取 process.env 的模块执行）。
 *
 * 优先级（dotenv 不覆盖已设变量）：进程注入（PM2/CI）> cwd .env > 仓库根 .env.local > 仓库根 .env。
 * 本地 dev（tsx watch，cwd=server/）此前只找 server/.env，根目录 .env.local 的本地配置从未生效——
 * 显式补根目录两级；生产 VPS 无根 .env.local，此处为 no-op，PM2 ecosystem 注入不受影响。
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

dotenv.config();
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });
