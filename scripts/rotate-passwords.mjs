#!/usr/bin/env node
/**
 * 全量密码轮换脚本(只改 USER_PASSWORDS override,不碰 user_store.json)
 *
 * 为 user_store.json 中除 --keep 外的所有用户生成新随机密码,
 * 只更新 server/.env 的 USER_PASSWORDS 行。明文仅在终端打印一次,不落盘、不进 git。
 *
 * 设计要点:
 *  - 只替换 .env 的 USER_PASSWORDS 单行,user_store.json 完全不动(branchCode/role/active 全保留,RLS 零风险)
 *  - --keep 列表中的用户不进 override,自动沿用 user_store.json 里的旧密码哈希
 *  - 实跑前自动备份 .env → .env.bak-<ISO>(--no-backup 跳过)
 *
 * 用法:
 *   node scripts/rotate-passwords.mjs --dry-run --keep xuechenglong              # 只看将重置谁,不改文件
 *   node scripts/rotate-passwords.mjs --keep xuechenglong                        # 实跑,保留 xuechenglong
 *   node scripts/rotate-passwords.mjs --keep a,b --root /var/www/chexian         # 多个排除 + 指定项目根(生产 /tmp 跑用)
 */
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { filterOutSelfService, readSelfServiceUsers } from './lib/self-service-users.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noBackup = argv.includes('--no-backup');

const rootIdx = argv.indexOf('--root');
const PROJECT_ROOT = rootIdx >= 0 && argv[rootIdx + 1]
  ? path.resolve(argv[rootIdx + 1])
  : path.resolve(__dirname, '..');

const keepIdx = argv.indexOf('--keep');
const keepRaw = keepIdx >= 0 && argv[keepIdx + 1] ? argv[keepIdx + 1] : '';
const keep = new Set(keepRaw.split(',').map(s => s.trim()).filter(Boolean));

// ---------- bcrypt(从 server/node_modules 引,与 reset-passwords.mjs 同路)----------
const require = createRequire(path.resolve(PROJECT_ROOT, 'server', 'package.json'));
const bcrypt = require('bcrypt');

// ---------- 密码生成(字符集排除易混淆 0O1lI,保证含每类各 1)----------
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '@#$%&*';
const ALL = UPPER + LOWER + DIGITS + SPECIAL;
const PWD_LEN = 12;

function generatePassword() {
  const required = [
    UPPER[crypto.randomInt(UPPER.length)],
    LOWER[crypto.randomInt(LOWER.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
    SPECIAL[crypto.randomInt(SPECIAL.length)],
  ];
  const rest = Array.from({ length: PWD_LEN - required.length }, () => ALL[crypto.randomInt(ALL.length)]);
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ---------- 路径 ----------
const storePath = path.resolve(PROJECT_ROOT, 'server', 'data', 'user_store.json');
const envPath = path.resolve(PROJECT_ROOT, 'server', '.env');

if (!fs.existsSync(storePath)) { console.error(`[FATAL] user_store.json 不存在: ${storePath}`); process.exit(1); }
if (!fs.existsSync(envPath)) { console.error(`[FATAL] server/.env 不存在: ${envPath}`); process.exit(1); }

// ---------- 读用户清单 ----------
const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
const allUsers = (store.users || []).map(u => ({
  username: u.username,
  branchCode: u.branchCode || '?',
  role: u.role || '?',
}));

// 自助设密账号永不进 USER_PASSWORDS override：这些账号密码只能本人自设，env 注入会被
// auth.ts 运行时忽略、并触发 governance「自助设密账号禁入USER_PASSWORDS」闸阻断发布。
// 生产 user_store 含这些账号，故轮换必须在源头剔除（BACKLOG 2026-07-12-claude-3901cd）。
const selfService = readSelfServiceUsers(PROJECT_ROOT);
const rotatable = allUsers.filter(u => !keep.has(u.username));
const targets = filterOutSelfService(rotatable, selfService);
const excludedSelfService = rotatable.length - targets.length;

console.log('');
console.log('==========================================');
console.log(`  全量密码轮换  ${dryRun ? '[DRY-RUN · 不写文件]' : '[实跑]'}`);
console.log('==========================================');
console.log(`  项目根:       ${PROJECT_ROOT}`);
console.log(`  user_store:   ${allUsers.length} 个用户`);
console.log(`  --keep 保留:  ${keep.size ? [...keep].join(', ') : '无'} (${keep.size})`);
console.log(`  自助设密剔除: ${excludedSelfService} 个（永不进 USER_PASSWORDS，密码只能本人自设）`);
console.log(`  将重置:       ${targets.length} 个`);
console.log('');

if (dryRun) {
  console.log('将重置的用户(不改任何文件,不生成密码):');
  console.log('用户名                省份   角色');
  console.log('─────────────────────────────────────');
  for (const u of targets) console.log(`${u.username.padEnd(22)}${u.branchCode}\t${u.role}`);
  console.log('');
  console.log('确认无误后,去掉 --dry-run 实跑(明文将在此终端打印一次)。');
  console.log('==========================================');
  process.exit(0);
}

// ---------- 实跑 ----------
const results = [];
const hashMap = {};
for (const u of targets) {
  const password = generatePassword();
  const hash = bcrypt.hashSync(password, 10);
  results.push({ ...u, password });
  hashMap[u.username] = hash;
}

// 备份 .env
if (!noBackup) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${envPath}.bak-${ts}`;
  fs.copyFileSync(envPath, bak);
  console.log(`[OK] 已备份 .env → ${path.basename(bak)}`);
}

// 替换 USER_PASSWORDS 行(只动这一行)
let content = fs.readFileSync(envPath, 'utf-8');
const newLine = `USER_PASSWORDS=${JSON.stringify(hashMap)}`;
if (/^USER_PASSWORDS=/m.test(content)) {
  content = content.replace(/^USER_PASSWORDS=.*$/m, newLine);
} else {
  content = content.trimEnd() + '\n\n# 账号密码覆盖 (JSON)\n' + newLine + '\n';
}
fs.writeFileSync(envPath, content, 'utf-8');
console.log(`[OK] server/.env 的 USER_PASSWORDS 已更新 (${Object.keys(hashMap).length} 个用户)`);
console.log('[NOTE] user_store.json 未触碰(branchCode/role/active 全保留)');

// 打印明文表(仅终端,不写文件)
console.log('');
console.log('==========================================');
console.log('  新密码 — 立即保存,仅显示此一次');
console.log('==========================================');
console.log('用户名                密码                省份   角色');
console.log('─────────────────────────────────────────────────────');
for (const r of results) {
  console.log(`${r.username.padEnd(22)}${r.password.padEnd(20)}${r.branchCode}\t${r.role}`);
}
console.log('');
console.log('⚠️  明文不落盘;重启服务后生效:');
console.log('    sudo /usr/local/bin/deploy-chexian-api reload');
console.log('==========================================');
console.log('');
