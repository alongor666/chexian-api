#!/usr/bin/env node
/**
 * 智能启动脚本 - 自动检测平台并运行 ETL
 * 
 * Windows:  使用 Node.js/Bun 运行 daily.mjs
 * macOS/Linux: 使用 bash 运行 daily.sh（支持 VPS 同步）
 * 
 * 用法:
 *   node etl.mjs          # 完整 ETL 流程
 *   node etl.mjs --help   # 显示帮助
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { platform } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWindows = platform() === 'win32';
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function main() {
  const scriptDir = __dirname;
  
  log('blue', '═'.repeat(60));
  log('blue', '  车险数据 ETL 智能启动');
  log('blue', '═'.repeat(60));
  console.log('');
  
  // 检查必要的数据文件（动态匹配，不依赖硬编码文件名）
  const dirFiles = readdirSync(scriptDir);
  const hasSource = dirFiles.some(f => f.startsWith('续保类型匹配') && f.endsWith('.xlsx'));
  const hasDaily = dirFiles.some(f => f.startsWith('车险2526年清单更新至') && f.endsWith('.xlsx'));

  if (!hasSource || !hasDaily) {
    if (!hasSource) log('yellow', '提示: 未找到续保源文件（续保类型匹配*.xlsx）');
    if (!hasDaily) log('yellow', '提示: 未找到每日清单文件（车险2526年清单更新至*.xlsx）');
    console.log('');
    log('yellow', 'ETL 将自动搜索匹配的文件名模式');
  }
  
  console.log('');
  log('green', `检测到平台: ${isWindows ? 'Windows' : 'macOS/Linux'}`);
  
  if (isWindows) {
    // Windows: 使用 Node.js 运行 daily.mjs
    log('blue', '使用 Node.js 运行跨平台脚本 (daily.mjs)');
    console.log('');
    
    const dailyScript = join(scriptDir, 'daily.mjs');
    if (!existsSync(dailyScript)) {
      console.error('错误: 未找到 daily.mjs');
      process.exit(1);
    }
    
    // 使用 node 运行
    const result = spawn('node', [dailyScript, ...process.argv.slice(2)], {
      stdio: 'inherit',
      cwd: scriptDir
    });
    
    result.on('close', code => process.exit(code));
    
  } else {
    // macOS/Linux: 使用 bash 运行 daily.sh
    log('blue', '使用 Bash 运行原生脚本 (daily.sh)');
    console.log('');
    
    const dailySh = join(scriptDir, 'daily.sh');
    if (!existsSync(dailySh)) {
      console.error('错误: 未找到 daily.sh');
      process.exit(1);
    }
    
    execSync(`bash "${dailySh}"`, { 
      stdio: 'inherit',
      cwd: scriptDir
    });
  }
}

main();
