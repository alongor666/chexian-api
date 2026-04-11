#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, cpSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';

const log = (color, msg) => {
  const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', nc: '\x1b[0m' };
  console.log(`${colors[color] || colors.nc}${msg}${colors.nc}`);
};

const args = process.argv.slice(2);
let action = 'deploy-full';
let until = '';
let basicAuthUser = 'temp-access';
let basicAuthPass = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--action') action = args[++i];
  else if (args[i] === '--until') until = args[++i];
  else if (args[i] === '--basic-auth-user') basicAuthUser = args[++i];
  else if (args[i] === '--basic-auth-pass') basicAuthPass = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') {
    console.log(`用法: node vps-deploy.mjs [--action ACTION] [--until "YYYY-MM-DD HH:MM"]`);
    process.exit(0);
  }
}

if (!['deploy-full', 'emergency-open', 'rollback-access'].includes(action)) {
  log('red', "错误：--action 仅支持 deploy-full | emergency-open | rollback-access");
  process.exit(1);
}

// Ensure root
if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
  log('red', "错误：该脚本需 root 权限执行");
  process.exit(1);
}

const PROJECT_ROOT = "/var/www/chexian";
const DOMAIN = "chexian.cretvalu.com";

if (action === 'deploy-full') {
  console.log("====================================================");
  console.log("  车险数据分析平台 - VPS 自动部署脚本 (Node.js 版)");
  console.log("====================================================\n");

  log('green', "[步骤 0] 环境检查...");
  try { execSync('pm2 --version', {stdio: 'ignore'}); } 
  catch(e) { log('yellow', 'PM2 未安装，正在安装...'); execSync('npm install -g pm2'); }
  log('green', "✓ 环境检查通过\n");

  log('green', "[步骤 1] 创建目录结构...");
  ['frontend', 'server', 'logs', 'server/data'].forEach(d => mkdirSync(join(PROJECT_ROOT, d), {recursive: true}));
  try { chmodSync(join(PROJECT_ROOT, 'server/data'), 0o700); chmodSync(join(PROJECT_ROOT, 'logs'), 0o700); } catch(e){}
  log('green', "✓ 目录创建完成\n");

  log('green', "此 Node.js 版本的 Vps-deploy 主要为了统一管理入口。全量部署指令已执行架构初始化。");
}
