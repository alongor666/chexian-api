#!/usr/bin/env node
/**
 * 密码重置脚本
 *
 * 为所有三级机构用户生成随机强密码，自动更新：
 * - server/.env 中的 USER_PASSWORDS
 * - server/data/user_store.json 中的 passwordHash
 *
 * 用法：node scripts/reset-passwords.mjs
 *
 * 密码仅在终端输出一次，不写入任何可被 git 跟踪的文件。
 */

import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// bcrypt 在 server/node_modules 中
const require = createRequire(path.resolve(PROJECT_ROOT, 'server', 'package.json'));
const bcrypt = require('bcrypt');

// ============================================
// 配置
// ============================================

const ORG_USERS = [
  { username: 'leshan', org: '乐山' },
  { username: 'tianfu', org: '天府' },
  { username: 'yibin', org: '宜宾' },
  { username: 'deyang', org: '德阳' },
  { username: 'xindu', org: '新都' },
  { username: 'wuhou', org: '武侯' },
  { username: 'luzhou', org: '泸州' },
  { username: 'zigong', org: '自贡' },
  { username: 'ziyang', org: '资阳' },
  { username: 'dazhou', org: '达州' },
  { username: 'qingyang', org: '青羊' },
  { username: 'gaoxin', org: '高新' },
];

// admin 密码保持不变
const ADMIN_PASSWORD = 'CxAdmin@2026!';

// 密码字符集（排除易混淆字符 0O1lI）
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '@#$%&*';
const ALL_CHARS = UPPER + LOWER + DIGITS + SPECIAL;

// ============================================
// 密码生成
// ============================================

function generatePassword(length = 12) {
  // 保证至少包含每类字符各 1 个
  const required = [
    UPPER[crypto.randomInt(UPPER.length)],
    LOWER[crypto.randomInt(LOWER.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
    SPECIAL[crypto.randomInt(SPECIAL.length)],
  ];

  // 填充剩余字符
  const remaining = Array.from({ length: length - required.length }, () =>
    ALL_CHARS[crypto.randomInt(ALL_CHARS.length)]
  );

  // 混洗
  const chars = [...required, ...remaining];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

// ============================================
// 文件更新
// ============================================

function updateEnvFile(passwordMap) {
  const envPath = path.resolve(PROJECT_ROOT, 'server', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[ERROR] ${envPath} 不存在`);
    process.exit(1);
  }

  let content = fs.readFileSync(envPath, 'utf-8');

  const jsonValue = JSON.stringify(passwordMap);
  const newLine = `USER_PASSWORDS=${jsonValue}`;

  if (content.includes('USER_PASSWORDS=')) {
    content = content.replace(/^USER_PASSWORDS=.*$/m, newLine);
  } else {
    content = content.trimEnd() + '\n\n# 账号密码覆盖 (JSON 格式)\n' + newLine + '\n';
  }

  fs.writeFileSync(envPath, content, 'utf-8');
  console.log(`[OK] server/.env USER_PASSWORDS 已更新 (${Object.keys(passwordMap).length} 个用户)`);
}

function updateUserStore(passwordMap) {
  const storePath = path.resolve(PROJECT_ROOT, 'server', 'data', 'user_store.json');
  if (!fs.existsSync(storePath)) {
    console.warn(`[WARN] ${storePath} 不存在，跳过`);
    return;
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  let updated = 0;

  for (const user of store.users) {
    if (passwordMap[user.username]) {
      user.passwordHash = passwordMap[user.username];
      updated++;
    }
  }

  store.exportedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
  console.log(`[OK] user_store.json 已更新 (${updated} 个用户)`);
}

// ============================================
// 主流程
// ============================================

async function main() {
  console.log('');
  console.log('==========================================');
  console.log('  密码重置工具');
  console.log('==========================================');
  console.log('');

  // 1. 生成密码和哈希
  const results = [];
  const hashMap = {};

  // admin 保持不变
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  hashMap['admin'] = adminHash;

  for (const { username, org } of ORG_USERS) {
    const password = generatePassword(12);
    const hash = await bcrypt.hash(password, 10);
    results.push({ username, password, org });
    hashMap[username] = hash;
  }

  // 2. 更新文件
  updateEnvFile(hashMap);
  updateUserStore(hashMap);

  // 3. 输出密码表（仅终端，不写文件）
  console.log('');
  console.log('==========================================');
  console.log('  密码已重置 — 请立即保存并分发');
  console.log('==========================================');
  console.log('');
  console.log('用户名          密码              机构');
  console.log('─────────────────────────────────────────');

  for (const { username, password, org } of results) {
    console.log(
      `${username.padEnd(16)}${password.padEnd(18)}${org}`
    );
  }

  console.log('');
  console.log('admin           (密码不变)        系统管理员');
  console.log('');
  console.log('⚠️  此密码仅显示一次，请截图或复制后安全保存');
  console.log('⚠️  已自动更新 server/.env 和 user_store.json');
  console.log('⚠️  重启服务器后生效: kill $(lsof -ti:3000); cd server && npx tsx src/app.ts &');
  console.log('==========================================');
  console.log('');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
