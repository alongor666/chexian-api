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
 *   - 账号花名册与自助设密名单 → 动态 import **dist 编译产物** dist/config/preset-users.js
 *     （运行时同一份，避免解析 src 与实际运行版本漂移；与 align-*-routes.mjs 同一做法）。
 *
 * 用法（在生产目录 / deployer 身份下执行）：
 *   node scripts/ops/verify-credential-rotation.mjs --server-dir /var/www/chexian/server
 *   # 默认读 <server-dir>/dist/config/preset-users.js；--preset 可显式指定其它 dist 产物
 * 退出码：0=全部已自设/已轮换；1=有 missing/stale-not-rotated 或任何读取解析错误。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// 纯分类核在 scripts/lib/（与 align-user-routes-core.mjs 同款约定）：本 CLI 要 `await import()`
// dist 编译产物，而 vitest 的 rollup 解析器无法解析该动态 import，故单测只 import core、不碰本文件。
import { classifyCredentials } from '../lib/verify-credential-rotation-core.mjs';

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

/**
 * 从**编译产物 dist** 读花名册 + 自助名单（单一事实源 = 运行时同一份 preset-users.js）。
 *
 * 不再 regex 解析 src：src 不随部署 bundle 同步，长期会与运行时漂移（工具读到过时花名册，
 * 曾出现 20 vs 37 对不上）。dist 才是实际运行的版本，且部署失败 rollback 会连同 dist 一起还原，
 * 工具与运行时永远一致。与 align-user-routes.mjs / align-role-routes.mjs 同一 dist-import 做法。
 */
async function loadPresetFromDist(presetDistPath) {
  if (!fs.existsSync(presetDistPath)) {
    fail(`未找到编译产物 ${presetDistPath}（生产机 dist 随部署就位；本地先 cd server && bun run build）`);
  }
  const mod = await import(pathToFileURL(presetDistPath).href);
  const presetUsers = mod.PRESET_USERS;
  if (!presetUsers || typeof presetUsers !== 'object') {
    fail(`${presetDistPath} 未导出 PRESET_USERS（dist 版本不匹配或未构建？）`);
  }
  const roster = Object.values(presetUsers).map((u) => ({
    username: u.username,
    active: u.active !== false,
  }));
  const selfService = Array.isArray(mod.SELF_SERVICE_PASSWORD_ONLY_USERS)
    ? [...mod.SELF_SERVICE_PASSWORD_ONLY_USERS]
    : [];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverDir = path.resolve(args.serverDir);
  // 默认读 dist 编译产物（运行时同一份）；--preset 可显式指向其它 dist 的 preset-users.js。
  const presetPath = args.preset
    ? path.resolve(args.preset)
    : path.join(serverDir, 'dist/config/preset-users.js');

  const envPath = path.join(serverDir, '.env');
  if (!fs.existsSync(envPath)) fail(`未找到 ${envPath}（需在含 .env 的生产 server 目录下执行）`);

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

  const { roster, selfService } = await loadPresetFromDist(presetPath);
  if (roster.length === 0) fail('dist preset 未读到任何账号（PRESET_USERS 为空或 dist 版本不匹配？）');

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
if (invokedDirectly) main().catch((e) => fail(e?.message || String(e)));
