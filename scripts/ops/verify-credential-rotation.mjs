#!/usr/bin/env node
/**
 * 凭据轮换上线前置核验（只读 preflight · 安全审查 H1）
 *
 * 背景：preset-users.ts 存量真实哈希改为 fail-safe tombstone 后，任何「当前仅靠源码真实哈希登录、
 * 既无 USER_PASSWORDS key 又未自设密码」的账号会在部署后无法登录。且旧弱口令哈希仍在 Git 历史里，
 * 若生产 USER_PASSWORDS 继续注入同一旧哈希，风险未真正消除。本脚本在部署前核验：每个 active 且
 * 非自助设密账号，凭据来源必须是「已自设」或「env 已轮换（非旧弱口令哈希）」，否则闸红、非零退出。
 *
 * 只读、绝不输出哈希/明文。读取的是应用同一套事实源：
 *   - <server-dir>/.env 的 USER_PASSWORDS 与 STATE_STORE_BACKEND；
 *   - 权威状态存储（backend=json → user_store.json；backend=sqlite → 尝试读 access_users，
 *     读不到则 fail-closed 非零退出，绝不静默当通过）。
 *   - 账号花名册与自助设密名单 → 解析 preset-users.ts（与 governance 脚本同源）。
 *
 * 用法（在生产目录 / deployer 身份下执行）：
 *   node scripts/ops/verify-credential-rotation.mjs --server-dir /var/www/chexian/server \
 *     --preset server/src/config/preset-users.ts
 * 退出码：0=全部已自设/已轮换；1=有 missing/stale-not-rotated 或任何读取解析错误。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

/**
 * 被移除的 20 个旧真实哈希的 sha256 指纹（不落原哈希，避免脚本再把弱口令哈希带进仓库）。
 * 生成方式见 PR 描述：git show HEAD:preset-users.ts → 抽非 tombstone 哈希 → sha256。
 */
const OLD_HASH_FINGERPRINTS = new Set([
  '95ce336882d12b6fbd8de6cd0773e65d787be02d5e96b3d9593ae2b0d886f06a',
  'f70cc2bbe2086608233f68d2f412b56fb28847619ff18fdace625c9aa57cb17b',
  'bb2b11390535269e0cfdae8d9d591d2c93d0f8a71c81a45691eb249fa9ab8e53',
  '18c976dfc6eb54f1b81c607e349a9bb4fc774edb5cc99b814aa8ec63ec346f87',
  '719feac3a29533da94415dcab72d93f9a4674bf3f9566acbb2ca9af36d795d38',
  'bd568b0260ca6c2861daaffbb3eead6f124e2bbcfa5cf3c9fcf7cb51b3397185',
  'fda6e97233a3f4abf344abcfa0dc3504945daeff5c334efb6f74e098853be057',
  'e6c03b0d9f0f1f4a286350894b673fa7395854bd59daff96b7c32114a13583b1',
  '453bf796b0fd77932576975faa9e2fd8a78c7eb013cea8b8a09843e1a3f29cd2',
  '923a48d0b20686d8b4e3bb52457e18ad3fceefa27f38e13b77bf4583c29a0d63',
  '0badf80be28b9925b9463dd73691ca266796c78cf37d45e07d96c60dda8742d6',
  'f599298d2845b8a8ad242d685938970c3d487ea5981403f7348f349d9d633cf7',
  'f646c01dc90abaeb92d4612cccf833bec9d0adceafdd127a28e7d2db7f72c22e',
  '2a9587ebd18374621b73659e95b5873f350c7e30a2911235f69c3eaebf636fee',
  'def29a1c1d4d51fc33b2f35dea1bb00b44af9e92ccba40975b0d56e568fc1fe3',
  '8773853ba7235db4f751132a0130c8958bdbdc41bf9a32e403ddb9bcf56ad086',
  '3547a70b1cd8a9d4fa9f4c3b5587c1e6ec86748c22ad4496ebad2e2f192da6f7',
  '94ac13cb25a41e2f0932c74e7130236bb9290c0078a15aa96bc90f4bbe86d18d',
  'ebb1745682065f9c5ac58d42484aba0757234b1d88407bdb59a369943d3236b4',
  '8a508b7e367c8bcb879ebd3d04c9a4d5ba9b14665e01f4eb56e144499366b34a',
]);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * 纯分类核（可测）：给定花名册 / 自助名单 / USER_PASSWORDS / store 自设状态，返回每账号来源。
 * @returns {{ username: string, source: 'self-set'|'env'|'stale-not-rotated'|'missing' }[]}
 */
export function classifyCredentials({
  roster,
  selfService,
  userPasswords,
  selfSetUsernames,
  oldFingerprints = OLD_HASH_FINGERPRINTS,
}) {
  const selfSvc = new Set(selfService.map((u) => u.toLowerCase()));
  const selfSet = new Set([...selfSetUsernames].map((u) => u.toLowerCase()));
  const upKeys = new Map(Object.entries(userPasswords).map(([k, v]) => [k.toLowerCase(), v]));

  const results = [];
  for (const acct of roster) {
    if (acct.active === false) continue;
    const name = acct.username.toLowerCase();
    if (selfSvc.has(name)) continue; // 自助设密账号不吃 env，本闸不评（其登录靠自设/激活令牌）
    if (selfSet.has(name)) {
      results.push({ username: acct.username, source: 'self-set' });
      continue;
    }
    if (upKeys.has(name)) {
      const val = upKeys.get(name);
      const stale = typeof val === 'string' && oldFingerprints.has(sha256(val));
      results.push({ username: acct.username, source: stale ? 'stale-not-rotated' : 'env' });
      continue;
    }
    results.push({ username: acct.username, source: 'missing' });
  }
  return results;
}

// ─── IO 层 ───────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`[preflight] ❌ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { serverDir: 'server', preset: null, storeFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--server-dir') args.serverDir = argv[++i];
    else if (argv[i] === '--preset') args.preset = argv[++i];
    else if (argv[i] === '--store-file') args.storeFile = argv[++i];
  }
  return args;
}

/** 解析 .env 的单个键（USER_PASSWORDS 的值是 JSON，可能带引号，取首个 = 之后全部） */
function readEnvKey(envText, key) {
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

/** 从 preset-users.ts 源码解析花名册 + 自助名单（与 governance 脚本同源做法） */
function parsePreset(presetText) {
  const listMatch = presetText.match(/SELF_SERVICE_PASSWORD_ONLY_USERS\s*:[^=]*=\s*\[([\s\S]*?)\]/);
  const selfService = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  const roster = [];
  const re = /username:\s*'([^']+)'([\s\S]{0,800}?)(?=\n\s*\w+:\s*\{|\n\s*\};)/g;
  let m;
  while ((m = re.exec(presetText)) !== null) {
    const username = m[1];
    const block = m[2];
    const active = !/active:\s*false/.test(block);
    roster.push({ username, active });
  }
  return { roster, selfService };
}

/** 读权威 store 的「已自设」用户名集合（passwordChangedAt / password_changed_at 非空） */
function readSelfSetUsernames({ serverDir, storeFile, backend }) {
  if (backend === 'sqlite') {
    // fail-closed：不静默当通过。SQLite 权威时须在能读该库的环境跑（VPS），或显式转 json 核验。
    fail(
      'STATE_STORE_BACKEND=sqlite：本 preflight 未内置 SQLite 读取（避免耦合原生依赖）。' +
      '请在能查 access_users 的环境导出「已自设用户名清单」后重跑，或临时以权威 JSON 快照核验。' +
      '绝不在无法读取权威 store 时默认通过。',
    );
  }
  const file = storeFile || path.join(serverDir, 'data', 'user_store.json');
  if (!fs.existsSync(file)) {
    // 无 store 文件 = 启动走 seedFromPreset（全 tombstone，无自设）→ 自设集合为空（非错误）
    return new Set();
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    fail(`user_store.json 解析失败（${file}）：${e.message}`);
  }
  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  const set = new Set();
  for (const u of users) {
    const changed = u.passwordChangedAt ?? u.password_changed_at;
    if (changed) set.add(String(u.username).toLowerCase());
  }
  return set;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverDir = path.resolve(args.serverDir);
  const presetPath = args.preset
    ? path.resolve(args.preset)
    : path.join(serverDir, 'src/config/preset-users.ts');

  const envPath = path.join(serverDir, '.env');
  if (!fs.existsSync(envPath)) fail(`未找到 ${envPath}（需在含 .env 的生产 server 目录下执行）`);
  if (!fs.existsSync(presetPath)) fail(`未找到 preset-users.ts（${presetPath}），无法取花名册`);

  const envText = fs.readFileSync(envPath, 'utf-8');
  const backend = (readEnvKey(envText, 'STATE_STORE_BACKEND') || 'json').toLowerCase();
  const rawUP = readEnvKey(envText, 'USER_PASSWORDS');
  let userPasswords = {};
  if (rawUP) {
    try {
      const p = JSON.parse(rawUP);
      if (p && typeof p === 'object') userPasswords = p;
    } catch (e) {
      fail(`.env 的 USER_PASSWORDS 不是合法 JSON：${e.message}`);
    }
  }

  const { roster, selfService } = parsePreset(fs.readFileSync(presetPath, 'utf-8'));
  if (roster.length === 0) fail('preset-users.ts 未解析到任何账号（花名册正则失效？）');

  const selfSetUsernames = readSelfSetUsernames({ serverDir, storeFile: args.storeFile, backend });
  const results = classifyCredentials({ roster, selfService, userPasswords, selfSetUsernames });

  const counts = { 'self-set': 0, env: 0, 'stale-not-rotated': 0, missing: 0 };
  for (const r of results) counts[r.source]++;

  console.log(`[preflight] 存储 backend=${backend}，评估 ${results.length} 个 active 非自助账号：`);
  console.log(
    `[preflight]   已自设 self-set=${counts['self-set']}  env已轮换=${counts.env}  ` +
    `未轮换 stale=${counts['stale-not-rotated']}  缺失 missing=${counts.missing}`,
  );
  const bad = results.filter((r) => r.source === 'missing' || r.source === 'stale-not-rotated');
  if (bad.length > 0) {
    console.error('[preflight] ❌ 以下账号未就绪（部署 tombstone 后将无法登录或仍用旧弱口令）：');
    for (const r of bad) console.error(`[preflight]   - ${r.username}: ${r.source}`);
    console.error('[preflight] 修复：为其在 USER_PASSWORDS 注入新生成的强随机临时哈希（勿复用旧哈希），或确认已自设密码。');
    process.exit(1);
  }
  console.log('[preflight] ✅ 全部账号已自设或已轮换，可安全部署 tombstone 化。');
  process.exit(0);
}

// 仅在被直接执行时跑 main（被 import 作测试时不执行）。
// 用 fileURLToPath 而非 new URL().pathname —— 后者对中文路径做 percent-encode，
// 与 argv[1]（已解码）比较恒不等，导致 main 静默不跑（见 memory chinese-path-import-meta-url-cli-guard）。
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
