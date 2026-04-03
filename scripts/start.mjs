#!/usr/bin/env node
/**
 * 跨平台自适应启动脚本
 *
 * 功能：
 * - 自动检测运行时（bun > node）
 * - 自动处理 Windows/macOS/Linux 差异
 * - 支持前端、后端、全栈启动模式
 *
 * 用法：
 *   node scripts/start.mjs           # 启动前端
 *   node scripts/start.mjs --dev     # 启动前端开发服务器
 *   node scripts/start.mjs --server  # 启动后端服务器
 *   node scripts/start.mjs --all     # 同时启动前后端
 *   node scripts/start.mjs --help    # 显示帮助
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const SERVER_DIR = join(ROOT_DIR, 'server');

// 平台检测
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// 颜色输出（跨平台兼容）
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  console.log();
  log(`${'='.repeat(50)}`, 'cyan');
  log(`  ${message}`, 'bright');
  log(`${'='.repeat(50)}`, 'cyan');
  console.log();
}

/**
 * 检测命令是否可用
 */
function commandExists(command) {
  try {
    const checkCmd = isWindows ? 'where' : 'which';
    execSync(`${checkCmd} ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取命令版本
 */
function getVersion(command) {
  try {
    const result = execSync(`${command} --version`, { encoding: 'utf8' });
    return result.trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

/**
 * 检测可用的运行时
 * 优先级：bun > node
 */
function detectRuntime() {
  const runtimes = [];

  if (commandExists('bun')) {
    runtimes.push({ name: 'bun', version: getVersion('bun'), priority: 1 });
  }

  if (commandExists('node')) {
    runtimes.push({ name: 'node', version: getVersion('node'), priority: 2 });
  }

  return runtimes.sort((a, b) => a.priority - b.priority);
}

/**
 * 检测包管理器
 * 优先级：bun > pnpm > yarn > npm
 */
function detectPackageManager() {
  const managers = [];

  if (commandExists('bun')) {
    managers.push({ name: 'bun', install: 'bun install', priority: 1 });
  }
  if (commandExists('pnpm')) {
    managers.push({ name: 'pnpm', install: 'pnpm install', priority: 2 });
  }
  if (commandExists('yarn')) {
    managers.push({ name: 'yarn', install: 'yarn', priority: 3 });
  }
  if (commandExists('npm')) {
    managers.push({ name: 'npm', install: 'npm install', priority: 4 });
  }

  return managers.sort((a, b) => a.priority - b.priority);
}

/**
 * 跨平台 spawn 封装
 */
function runCommand(command, args, options = {}) {
  const mergedEnv = { ...process.env, ...options.env };
  if (!mergedEnv.NODE_ENV) {
    mergedEnv.NODE_ENV = 'development';
  }

  const spawnOptions = {
    stdio: 'inherit',
    shell: isWindows,
    cwd: options.cwd || ROOT_DIR,
    env: mergedEnv,
  };

  // Windows 下需要使用 .cmd 后缀
  let cmd = command;
  if (isWindows && !command.includes('.')) {
    // 检查是否需要 .cmd 后缀
    const cmdPath = `${command}.cmd`;
    if (commandExists(cmdPath)) {
      cmd = cmdPath;
    }
  }

  return spawn(cmd, args, spawnOptions);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 查询端口监听进程 PID
 */
function getListeningPids(port) {
  if (isWindows) {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const lines = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.includes('LISTENING') && line.includes(`:${port}`));

      const pids = lines
        .map(line => line.split(/\s+/).pop())
        .filter(Boolean)
        .map(pid => Number(pid))
        .filter(pid => Number.isInteger(pid) && pid > 0);

      return Array.from(new Set(pids));
    } catch {
      return [];
    }
  }

  if (!commandExists('lsof')) {
    return [];
  }

  try {
    const output = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    if (!output) {
      return [];
    }

    return output
      .split('\n')
      .map(line => Number(line.trim()))
      .filter(pid => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 终止占用端口的旧进程（先 SIGTERM，必要时 SIGKILL）
 */
async function terminatePortProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }

  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return !isProcessAlive(pid);
  }

  await sleep(1200);

  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return !isProcessAlive(pid);
  }

  await sleep(500);
  return !isProcessAlive(pid);
}

/**
 * 自动清理开发端口占用
 */
async function cleanupOccupiedPorts(ports) {
  const uniquePorts = Array.from(new Set(ports)).filter(port => Number.isInteger(port) && port > 0);
  let cleanedAny = false;

  for (const port of uniquePorts) {
    const pids = getListeningPids(port);
    if (pids.length === 0) {
      continue;
    }

    log(`检测到端口 ${port} 被占用，准备清理旧进程: ${pids.join(', ')}`, 'yellow');

    for (const pid of pids) {
      const terminated = await terminatePortProcess(pid);
      const stillListening = getListeningPids(port).includes(pid);
      const ok = terminated || !stillListening;

      if (ok) {
        cleanedAny = true;
        log(`已释放端口 ${port} 的进程 PID=${pid}`, 'green');
      } else {
        log(`无法终止 PID=${pid}（端口 ${port}）`, 'red');
      }
    }
  }

  if (cleanedAny) {
    log('旧端口清理完成，继续启动流程。', 'green');
  }
}

/**
 * 检查端口是否可用
 */
function isPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
          return;
        }
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      });

    tester.listen(port, host);
  });
}

/**
 * 获取端口占用进程提示（Unix）
 */
function getPortOwnerHint(port) {
  if (isWindows || !commandExists('lsof')) {
    return null;
  }

  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    const lines = output.split('\n').slice(1);
    if (lines.length === 0) {
      return null;
    }
    return lines.map(line => line.trim().replace(/\s+/g, ' ')).join('\n');
  } catch {
    return null;
  }
}

/**
 * 确保后端端口可用
 */
async function ensureBackendPortAvailable(port = 3000) {
  const available = await isPortAvailable(port);
  if (available) {
    return true;
  }

  log(`错误: 后端端口 ${port} 已被占用，无法启动新的后端实例。`, 'red');

  const ownerHint = getPortOwnerHint(port);
  if (ownerHint) {
    log('当前占用进程：', 'yellow');
    console.log(ownerHint);
  }

  log('请先释放端口后重试：', 'yellow');
  if (isWindows) {
    log(`  netstat -ano | findstr :${port}`, 'blue');
    log('  taskkill /PID <PID> /F', 'blue');
  } else {
    log(`  lsof -nP -iTCP:${port} -sTCP:LISTEN`, 'blue');
    log('  kill <PID>', 'blue');
  }

  log('若要复用已运行的后端，仅启动前端即可：`bun run dev`', 'blue');
  return false;
}

/**
 * 启动前端开发服务器
 */
function startFrontend(runtime) {
  log(`启动前端开发服务器 (${runtime.name})...`, 'green');

  const scriptName = runtime.name === 'bun' ? 'bun' : 'npx';
  const args = runtime.name === 'bun' ? ['run', 'dev'] : ['vite'];

  return runCommand(scriptName, args, { cwd: ROOT_DIR });
}

/**
 * 启动后端服务器
 */
function startBackend(runtime) {
  log(`启动后端服务器 (${runtime.name})...`, 'green');

  // 检查 server 目录是否存在
  if (!existsSync(SERVER_DIR)) {
    log('错误: server 目录不存在', 'red');
    process.exit(1);
  }

  // 检查是否需要安装依赖
  const nodeModulesPath = join(SERVER_DIR, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    log('检测到后端依赖未安装，正在安装...', 'yellow');
    const pm = detectPackageManager()[0];
    try {
      execSync(pm.install, { cwd: SERVER_DIR, stdio: 'inherit' });
    } catch (e) {
      log(`依赖安装失败: ${e.message}`, 'red');
      process.exit(1);
    }
  }

  const scriptName = runtime.name === 'bun' ? 'bun' : 'npx';
  const args = runtime.name === 'bun' ? ['run', 'dev'] : ['tsx', 'watch', 'src/app.ts'];

  return runCommand(scriptName, args, { cwd: SERVER_DIR });
}

/**
 * 同时启动前后端
 */
function startAll(runtime) {
  log('同时启动前端和后端...', 'green');

  const processes = [];
  let frontendStarted = false;
  let isShuttingDown = false;

  const cleanup = (exitCode = 0) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    log('\n正在关闭服务...', 'yellow');
    processes.forEach(p => {
      if (p && !p.killed) {
        p.kill();
      }
    });
    process.exit(exitCode);
  };

  // 启动后端
  const backend = startBackend(runtime);
  processes.push(backend);

  // 延迟启动前端，给后端一点启动时间
  const frontendTimer = setTimeout(() => {
    frontendStarted = true;
    const frontend = startFrontend(runtime);
    processes.push(frontend);
  }, 1000);

  backend.on('exit', (code) => {
    const exitCode = code ?? 1;
    if (!frontendStarted) {
      clearTimeout(frontendTimer);
      if (exitCode !== 0) {
        log(`后端启动失败（退出码 ${exitCode}），已取消前端启动。`, 'red');
        cleanup(exitCode);
      }
      return;
    }

    if (exitCode !== 0) {
      log(`后端进程异常退出（退出码 ${exitCode}），正在关闭前端。`, 'red');
      cleanup(exitCode);
    }
  });

  // 处理进程退出
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  return processes;
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
跨平台自适应启动脚本

用法：
  node scripts/start.mjs [选项]

选项：
  --dev, -d      启动前端开发服务器 (默认)
  --server, -s   启动后端服务器
  --all, -a      同时启动前后端
  --info, -i     显示环境信息
  --help, -h     显示帮助

示例：
  node scripts/start.mjs           # 启动前端
  node scripts/start.mjs --all     # 启动全栈
  node scripts/start.mjs --server  # 仅启动后端
`);
}

/**
 * 显示环境信息
 */
function showInfo() {
  logHeader('环境信息');

  log(`平台: ${process.platform} (${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'})`, 'blue');
  log(`架构: ${process.arch}`, 'blue');
  log(`Node.js: ${process.version}`, 'blue');

  console.log();
  log('可用运行时:', 'bright');
  const runtimes = detectRuntime();
  runtimes.forEach((rt, i) => {
    const marker = i === 0 ? '(推荐)' : '';
    log(`  ${rt.name}: ${rt.version} ${marker}`, 'green');
  });

  console.log();
  log('可用包管理器:', 'bright');
  const pms = detectPackageManager();
  pms.forEach((pm, i) => {
    const marker = i === 0 ? '(推荐)' : '';
    log(`  ${pm.name} ${marker}`, 'green');
  });

  console.log();
  log('目录结构:', 'bright');
  log(`  根目录: ${ROOT_DIR}`, 'blue');
  log(`  后端目录: ${SERVER_DIR} ${existsSync(SERVER_DIR) ? '✓' : '✗'}`, 'blue');
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  const options = {
    dev: args.includes('--dev') || args.includes('-d'),
    server: args.includes('--server') || args.includes('-s'),
    all: args.includes('--all') || args.includes('-a'),
    info: args.includes('--info') || args.includes('-i'),
    help: args.includes('--help') || args.includes('-h'),
  };

  // 显示帮助
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // 显示环境信息
  if (options.info) {
    showInfo();
    process.exit(0);
  }

  // 检测运行时
  const runtimes = detectRuntime();
  if (runtimes.length === 0) {
    log('错误: 未检测到可用的运行时 (bun 或 node)', 'red');
    log('请安装 Node.js (https://nodejs.org) 或 Bun (https://bun.sh)', 'yellow');
    process.exit(1);
  }

  const runtime = runtimes[0];

  logHeader(`车险业绩分析系统 - 启动器`);
  log(`运行时: ${runtime.name} ${runtime.version}`, 'blue');
  log(`平台: ${process.platform}`, 'blue');
  console.log();

  if (options.all) {
    await cleanupOccupiedPorts([3000, 5173, 5174, 5175, 5176]);
  } else if (options.server) {
    await cleanupOccupiedPorts([3000]);
  }

  if (options.all || options.server) {
    const canStartBackend = await ensureBackendPortAvailable(3000);
    if (!canStartBackend) {
      process.exit(1);
    }
  }

  // 执行启动
  if (options.all) {
    startAll(runtime);
  } else if (options.server) {
    startBackend(runtime);
  } else {
    // 默认启动前端
    startFrontend(runtime);
  }
}

main().catch((error) => {
  log(`启动失败: ${error?.message || error}`, 'red');
  process.exit(1);
});
