/**
 * 「仅限自助设密」账号名单读取 + 过滤（BACKLOG 2026-07-12-claude-3901cd · 生产事故 c0f97a 根治）
 *
 * 名单 SSOT = server/src/config/preset-users.ts 的 SELF_SERVICE_PASSWORD_ONLY_USERS。
 * 这些账号的密码只能由本人经激活令牌 / 飞书首登强制设密链路自设，任何 USER_PASSWORDS
 * env 注入都违反设计（auth.ts resolveEffectiveHash 运行时忽略 + governance
 * 「自助设密账号禁入USER_PASSWORDS」静态闸拦截）。
 *
 * 背景：密码生成器 rotate-passwords.mjs 遍历 user_store.json 全部用户生成 USER_PASSWORDS，
 * 生产 user_store 含这些自助设密账号 → 跑一次轮换即把它们回注 .env → 再次触发 governance
 * 闸阻断 release:daily（2026-07-12 生产事故实况）。governance 闸是发布时事后兜底，本模块把
 * 过滤下沉到生成源头，让「生成即合规」，闸退回为纯防回归。
 *
 * .mjs 无法直接 import .ts 常量，故与 scripts/governance/self-service-password-isolation.mjs
 * 同法正则解析同一 SSOT（单一真相，两处解析同一文件、同一模式）。
 */
import fs from 'fs';
import path from 'path';

/**
 * 从 preset-users.ts 读取自助设密账号名单。
 * @param {string} rootDir 项目根目录绝对路径
 * @returns {string[]} 自助设密账号用户名数组（可能为空）
 * @throws 名单定义缺失时抛错（调用方 fail-fast，绝不静默返回空致过滤失效）
 */
export function readSelfServiceUsers(rootDir) {
  const presetPath = path.join(rootDir, 'server/src/config/preset-users.ts');
  const src = fs.readFileSync(presetPath, 'utf-8');
  const listMatch = src.match(/SELF_SERVICE_PASSWORD_ONLY_USERS\s*:[^=]*=\s*\[([\s\S]*?)\]/);
  if (!listMatch) {
    throw new Error(
      '[self-service-users] preset-users.ts 缺少 SELF_SERVICE_PASSWORD_ONLY_USERS 名单——' +
        '密码生成器无法确认过滤范围，拒绝生成以防自助设密账号被回注 USER_PASSWORDS',
    );
  }
  return [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 从候选用户里剔除自助设密账号（纯函数，保序、不改原数组）。
 * @param {Array<T>} items 候选用户（对象或字符串）
 * @param {string[]} selfServiceList 自助设密账号名单
 * @param {(item: T) => string} [keyFn] 从候选项取用户名，默认取 item.username
 * @returns {Array<T>} 过滤后候选
 * @template T
 */
export function filterOutSelfService(items, selfServiceList, keyFn = (x) => x.username) {
  const deny = new Set(selfServiceList);
  return items.filter((it) => !deny.has(keyFn(it)));
}
