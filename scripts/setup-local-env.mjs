import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { chmodSync } from 'fs';

const log = (color, msg) => {
  const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', reset: '\x1b[0m' };
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

const VPS_HOST = "162.14.113.44";
const VPS_USER = "deployer";
const SSH_KEY = join(homedir(), '.ssh/chexian_deploy');
const SSH_CONFIG = join(homedir(), '.ssh/config');
const ALIAS = "chexian-vps-deploy";

console.log("=== 车险平台本地环境初始化 ===");
console.log("");

// 步骤 1：检查私钥
if (!existsSync(SSH_KEY)) {
  log('red', `✗ 私钥不存在: ${SSH_KEY}`);
  console.log("");
  console.log("请将 chexian_deploy 私钥放到 ~/.ssh/chexian_deploy，步骤：");
  console.log("  1. 从密钥保管处或 GitHub Secrets 取出 chexian_deploy（私钥）");
  console.log("  2. cp <私钥路径> ~/.ssh/chexian_deploy");
  console.log("  3. chmod 600 ~/.ssh/chexian_deploy");
  console.log("  4. 重新运行本脚本");
  console.log("");
  console.log("如果是首次配置新 VPS，生成新密钥对：");
  console.log("  ssh-keygen -t ed25519 -C 'chexian-deploy' -f ~/.ssh/chexian_deploy");
  console.log(`  ssh-copy-id -i ~/.ssh/chexian_deploy.pub root@${VPS_HOST}`);
  process.exit(1);
}

try {
  chmodSync(SSH_KEY, 0o600);
} catch (e) {
  // Windows 可能不支持直接 600
}
log('green', `✓ 私钥存在: ${SSH_KEY}`);

// 步骤 2：写入 SSH config（幂等）
try {
  mkdirSync(join(homedir(), '.ssh'), { recursive: true });
} catch (e) {}

let configContent = existsSync(SSH_CONFIG) ? readFileSync(SSH_CONFIG, 'utf8') : '';
if (configContent.includes(`Host ${ALIAS}`)) {
  log('yellow', `⊙ SSH config 已包含 ${ALIAS} 配置，跳过写入`);
} else {
  configContent += `\nHost ${ALIAS}\n    HostName ${VPS_HOST}\n    User ${VPS_USER}\n    IdentityFile ${SSH_KEY}\n    ServerAliveInterval 60\n`;
  writeFileSync(SSH_CONFIG, configContent, { mode: 0o600 });
  log('green', `✓ 已写入 ~/.ssh/config (${ALIAS} 别名)`);
}

// 步骤 3：验证连通性
console.log("");
process.stdout.write("  验证 VPS 连通性... ");
try {
  execSync(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${ALIAS} true`, { stdio: 'ignore' });
  log('green', "ok\n");
  log('green', "=== 初始化完成 ===");
  console.log("现在可以运行：");
  console.log("  node scripts/sync-vps.mjs    # 同步 Parquet 到 VPS");
  console.log("  ssh chexian-vps-deploy       # 连接 VPS");
} catch (e) {
  log('red', "失败\n");
  console.log("连接失败，可能原因：");
  console.log(`  1. 公钥未注册到 VPS：ssh-copy-id -i ${SSH_KEY}.pub ${VPS_USER}@${VPS_HOST}`);
  console.log("  2. VPS 防火墙拦截了本机 IP");
  console.log("  3. VPS 已关机");
  process.exit(1);
}
