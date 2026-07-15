/**
 * launchd 用 node 绝对路径解析 —— 稳定别名优先（2026-07-15）
 *
 * 事故背景：`resolveNodeBin()` 原样返回 `process.execPath`。macOS + Homebrew 下 node 的
 * execPath 已是解过软链的 Cellar 实路径（实测 `/opt/homebrew/Cellar/node/26.3.1/bin/node`），
 * 于是 `bun run auto-release:install` 写进 plist 的 Program 被钉死在**某个具体版本**上
 * （2026-07-15 实测：auto-release-daily 与 auto-remediate-stale 两个 plist 均钉 26.3.1，
 * 而 Cellar 里还躺着 25.9.0_2 / 26.0.0 —— 升级确实在发生）。Homebrew 升级 node 后旧版本
 * 目录被 prune，launchd 从此 exec 失败：**没有任何日志输出**（进程根本没起来），只有
 * launchctl 报 spawn 失败——正是 memory `launchd-ex-config-78-macl-log-file` 那类「静默
 * 死亡」，已经害过一次漏发布。
 *
 * 修法：优先钉稳定软链 `/opt/homebrew/bin/node`（Homebrew 升级只改软链指向，路径本身不变，
 * 也正是本项目 scheduled-task runbook 对一次性 plist 的既有处方）。
 *
 * 判据是 **realpath 相等**，不是"文件存在即用"：后者会在 nvm / 多版本机器上把 launchd 悄悄
 * 换成另一个大版本的 node。realpath 相等意味着「同一个二进制，只是经稳定软链抵达」——既然
 * 它就是当前正在跑的这个 node，可用性无需另外 spawn 一次去证。找不到等价稳定别名就保持原
 * 路径（行为不回退，不是 fail）；连 node 都找不到才 fail-closed，交由调用方响亮失败。
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * 稳定别名候选，按优先级排列：Homebrew ARM 前缀 → Homebrew Intel 前缀。
 * 与两个 watcher 的 EXTRA_PATHS 同源（launchd PATH 极简，node 只可能在这些前缀下）。
 */
export const STABLE_NODE_CANDIDATES = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];

/**
 * 纯判定：给定一个已确认可用的 node 路径，挑出指向同一个二进制、但升级不会消失的稳定别名。
 *
 * @param {object} o
 * @param {string} o.rawPath           已解析出的 node 路径（execPath 或 `command -v node`）
 * @param {string[]} [o.candidates]    稳定别名候选（按优先级）
 * @param {(p: string) => string|null} o.realpathOf  解软链；路径不存在/不可读返回 null
 * @returns {string} 稳定别名（若有），否则原样返回 rawPath
 */
export function pickStableNodeBin({ rawPath, candidates = STABLE_NODE_CANDIDATES, realpathOf }) {
  if (!rawPath) return rawPath;
  const target = realpathOf(rawPath);
  if (!target) return rawPath; // 连自己都解不动 → 无从比对，保持原样
  for (const candidate of candidates) {
    if (realpathOf(candidate) === target) return candidate;
  }
  return rawPath; // 无等价稳定别名（nvm / 自编译 / 非 Homebrew）→ 保持原样
}

/** realpathSync 的安全版：路径不存在 / 不可读 → null（不抛）。 */
const safeRealpath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * 解析出可写进 plist 的 node 绝对路径（本模块唯一做 I/O 的部分）。
 *
 * 先拿到一个可用的 node 路径：execPath 本身就是 node 就用它（`bun run` 拉起时 execPath 是
 * bun，basename 不是 node，此时回落 `command -v node`）；再交给 pickStableNodeBin 换稳定别名。
 *
 * @returns {{ ok: true, path: string } | { ok: false, path: null }} ok=false 时调用方须 fail-closed
 */
export function resolveLaunchdNodeBin({
  execPath = process.execPath,
  realpathOf = safeRealpath,
  candidates = STABLE_NODE_CANDIDATES,
} = {}) {
  let rawPath = basename(execPath) === 'node' ? execPath : '';
  if (!rawPath) {
    const r = spawnSync('sh', ['-lc', 'command -v node'], { encoding: 'utf-8' });
    rawPath = (r.stdout || '').trim();
  }
  if (!rawPath) return { ok: false, path: null };
  return { ok: true, path: pickStableNodeBin({ rawPath, candidates, realpathOf }) };
}
