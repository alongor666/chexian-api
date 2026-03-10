#!/usr/bin/env node
/**
 * 跨平台 VPS 数据同步脚本
 * 支持 Windows / macOS / Linux
 * 
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # 同步最新数据
 *   node scripts/sync-vps.mjs --export           # 预聚合模式（推荐）
 *   node scripts/sync-vps.mjs 文件路径            # 指定文件
 *   node scripts/sync-vps.mjs --no-restart       # 同步但不重启
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import ssh2 from 'ssh2';

const { Client } = ssh2;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// 配置
const SSH_ALIAS = 'chexian-vps-deploy';
const SSH_KEY_PATH = 'C:\\Users\\xuechenglong\\.ssh\\chexian_deploy';  // 使用 ed25519 密钥
const VPS_DATA_DIR = '/var/www/chexian/server/data';
const LOCAL_DATA_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
const VPS_EXPORT_DIR = join(ROOT_DIR, '数据管理/warehouse/vps-export');

// 颜色
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

/**
 * 解析 SSH 配置文件，获取主机信息
 */
function parseSSHConfig(alias) {
  const configPaths = [
    join(process.env.USERPROFILE || process.env.HOME, '.ssh', 'config'),
    join(process.env.USERPROFILE || process.env.HOME, '.ssh', 'config')
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;

    const content = readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    
    let inHost = false;
    const hostConfig = {};

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      if (line.toLowerCase().startsWith('host ')) {
        const hosts = line.substring(5).trim().split(/\s+/);
        inHost = hosts.includes(alias);
        continue;
      }

      if (inHost) {
        const [key, ...valueParts] = line.split(/\s+/);
        const value = valueParts.join(' ');
        
        switch (key.toLowerCase()) {
          case 'hostname':
            hostConfig.host = value;
            break;
          case 'user':
            hostConfig.username = value;
            break;
          case 'identityfile':
            hostConfig.privateKeyPath = value.replace(/^~\//, 
              join(process.env.USERPROFILE || process.env.HOME, ''));
            break;
          case 'port':
            hostConfig.port = parseInt(value);
            break;
        }
      }
    }

    if (hostConfig.host) {
      hostConfig.port = hostConfig.port || 22;
      return hostConfig;
    }
  }

  return null;
}

/**
 * 执行本地命令
 */
function runLocal(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT_DIR,
      stdio: options.silent ? 'pipe' : 'inherit',
      shell: true,
      ...options
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr}`));
      }
    });
  });
}

/**
 * SSH 连接
 */
function sshConnect(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    const sshConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 30000,
      // 强制指定兼容的算法
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'diffie-hellman-group-exchange-sha256'
      ],
      cipher: [
        'aes128-ctr',
        'aes192-ctr', 
        'aes256-ctr',
        'aes128-gcm',
        'aes256-gcm'
      ],
      hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512'
      ]
    };

    // 读取私钥
    if (config.privateKeyPath && existsSync(config.privateKeyPath)) {
      sshConfig.privateKey = readFileSync(config.privateKeyPath);
    } else {
      reject(new Error(`SSH 私钥不存在: ${config.privateKeyPath}`));
      return;
    }

    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => {
      log('red', `  SSH 错误详情: ${err.level} - ${err.message}`);
      reject(err);
    });

    log('blue', `  连接参数: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
    conn.connect(sshConfig);
  });
}

/**
 * 执行远程命令
 */
function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('close', () => resolve({ stdout, stderr }));
      stream.on('data', (data) => { stdout += data; });
      stream.stderr.on('data', (data) => { stderr += data; });
    });
  });
}

/**
 * SFTP 上传文件
 */
function sftpUpload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);

      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

/**
 * 健康检查
 */
async function healthCheck(conn, maxAttempts = 8) {
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    
    try {
      const { stdout } = await sshExec(conn, 'curl -s http://localhost:3000/health');
      if (stdout.includes('success')) {
        return true;
      }
    } catch (e) {
      // ignore
    }
    
    log('yellow', `  等待服务启动... (${i}/${maxAttempts})`);
  }
  return false;
}

/**
 * 获取最新 Parquet 文件
 */
function getLatestParquet(dir) {
  if (!existsSync(dir)) return null;
  
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.parquet'))
    .map(f => ({
      name: f,
      path: join(dir, f),
      mtime: statSync(join(dir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0] || null;
}

/**
 * 格式化文件大小
 */
function formatSize(path) {
  const bytes = statSync(path).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  let exportMode = false;
  let noRestart = false;
  let targetFile = null;

  for (const arg of args) {
    if (arg === '--export') exportMode = true;
    else if (arg === '--no-restart') noRestart = true;
    else if (!arg.startsWith('-')) targetFile = arg;
  }

  log('blue', '================================================================================');
  log('blue', 'VPS 数据同步工具（跨平台版）');
  log('blue', '================================================================================');

  // 1. 构建 SSH 配置（直接使用 ed25519 密钥，不依赖系统 OpenSSH）
  log('yellow', '▶ 加载 SSH 密钥...');
  
  if (!existsSync(SSH_KEY_PATH)) {
    log('red', `错误：SSH 私钥不存在: ${SSH_KEY_PATH}`);
    process.exit(1);
  }

  const sshConfig = {
    host: '162.14.113.44',
    port: 22,
    username: 'deployer',
    privateKeyPath: SSH_KEY_PATH
  };

  log('green', `✓ SSH 配置: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
  log('green', `✓ 密钥: ${SSH_KEY_PATH}`);

  // 2. 导出模式：运行预聚合
  if (exportMode) {
    log('green', '▶ 步骤 1: 运行预聚合导出...');
    
    const exportScript = join(ROOT_DIR, 'scripts/export-for-vps.mjs');
    if (!existsSync(exportScript)) {
      log('red', `错误：导出脚本不存在: ${exportScript}`);
      process.exit(1);
    }

    try {
      await runLocal('node', [exportScript]);
    } catch (e) {
      log('red', `错误：导出脚本失败: ${e.message}`);
      process.exit(1);
    }

    // 3. 连接 SSH
    log('green', '▶ 步骤 2: 连接 VPS...');
    let conn;
    try {
      conn = await sshConnect(sshConfig);
    } catch (e) {
      log('red', `错误：SSH 连接失败: ${e.message}`);
      process.exit(1);
    }

    log('green', '✓ SSH 连接成功');

    // 4. 确保远程目录存在
    await sshExec(conn, `mkdir -p ${VPS_DATA_DIR}/current ${VPS_DATA_DIR}/archive`);

    // 5. 上传预聚合文件
    log('green', '▶ 步骤 3: 上传预聚合文件...');
    
    const exportFiles = ['aggregated.parquet', 'cross_sell_agg.parquet', 'renewal_agg.parquet'];
    
    for (const file of exportFiles) {
      const localPath = join(VPS_EXPORT_DIR, file);
      if (!existsSync(localPath)) {
        log('yellow', `  跳过 ${file}（文件不存在）`);
        continue;
      }

      const size = formatSize(localPath);
      log('yellow', `  上传 ${file} (${size})...`);
      
      await sftpUpload(conn, localPath, `${VPS_DATA_DIR}/current/${file}`);
      log('green', `  ✓ ${file} 上传完成`);
    }

    // 6. 重启服务
    if (noRestart) {
      log('green', '✓ 上传完成（跳过重启）');
    } else {
      log('green', '▶ 步骤 4: 重启服务...');
      await sshExec(conn, 'sudo /usr/local/bin/deploy-chexian-api restart');

      log('yellow', '  验证中...');
      const healthy = await healthCheck(conn);

      if (healthy) {
        log('green', '✓ 同步完成！VPS 服务运行正常');
      } else {
        log('red', '⚠ 上传完成，但健康检查失败');
        log('yellow', '  查看日志: ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api logs 20"');
      }
    }

    conn.end();
  } else {
    // 标准模式：上传单个文件
    if (!targetFile) {
      const latest = getLatestParquet(LOCAL_DATA_DIR);
      if (!latest) {
        log('red', `错误：未找到 Parquet 文件: ${LOCAL_DATA_DIR}`);
        process.exit(1);
      }
      targetFile = latest.path;
    } else if (!existsSync(targetFile)) {
      // 尝试在 LOCAL_DATA_DIR 中查找
      const tryPath = join(LOCAL_DATA_DIR, targetFile);
      if (existsSync(tryPath)) {
        targetFile = tryPath;
      } else {
        log('red', `错误：文件不存在: ${targetFile}`);
        process.exit(1);
      }
    }

    const fileName = basename(targetFile);
    const size = formatSize(targetFile);
    log('green', `[同步] ${fileName} (${size})`);

    // 3. 连接 SSH
    log('yellow', '▶ 连接 VPS...');
    let conn;
    try {
      conn = await sshConnect(sshConfig);
    } catch (e) {
      log('red', `错误：SSH 连接失败: ${e.message}`);
      process.exit(1);
    }

    log('green', '✓ SSH 连接成功');

    // 4. 确保远程目录存在
    await sshExec(conn, `mkdir -p ${VPS_DATA_DIR}/current ${VPS_DATA_DIR}/archive`);

    // 5. 上传文件
    log('yellow', '  上传中...');
    await sftpUpload(conn, targetFile, `${VPS_DATA_DIR}/current/${fileName}`);
    log('green', '  ✓ 上传完成');

    // 6. 重启服务
    if (noRestart) {
      log('green', '✓ 上传完成（跳过重启）');
    } else {
      log('yellow', '  重启服务...');
      await sshExec(conn, 'sudo /usr/local/bin/deploy-chexian-api restart');

      log('yellow', '  验证中...');
      const healthy = await healthCheck(conn);

      if (healthy) {
        log('green', '✓ 同步完成！VPS 服务运行正常');
      } else {
        log('red', '⚠ 上传完成，但健康检查失败');
        log('yellow', '  查看日志: ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api logs 20"');
      }
    }

    conn.end();
  }
}

main().catch(e => {
  log('red', `错误: ${e.message}`);
  process.exit(1);
});
