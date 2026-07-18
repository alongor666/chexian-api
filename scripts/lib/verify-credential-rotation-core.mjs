/**
 * 凭据轮换核验 · 纯分类核（无 IO，可测）
 *
 * 与 CLI（scripts/ops/verify-credential-rotation.mjs）分离的理由（与 align-user-routes-core.mjs 同款约定）：
 * CLI 侧要 `await import()` dist 编译产物取花名册，而 vitest 的 rollup 解析器无法解析该动态 import
 * （实测 `Expected ident` 解析失败）。把纯逻辑留在本文件、由单测直接 import，CLI 只做 IO 编排，
 * 测试便无需解析 CLI 文件。
 */
import crypto from 'crypto';

/**
 * 被移除的 20 个旧真实哈希的 sha256 指纹（不落原哈希，避免脚本再把弱口令哈希带进仓库）。
 * 生成方式：git show <preset 移除前>:preset-users.ts → 抽非 tombstone 哈希 → sha256。
 */
export const OLD_HASH_FINGERPRINTS = new Set([
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
 * 纯分类核：给定花名册 / 自助名单 / USER_PASSWORDS / store 自设状态，返回每账号凭据来源。
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
