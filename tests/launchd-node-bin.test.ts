/**
 * launchd node 路径稳定别名单测（数据管理/lib/launchd-node-bin.mjs）
 *
 * 锁定 pickStableNodeBin 的核心取舍：
 *   - Homebrew 场景（回归锁）：execPath 是 Cellar 实路径 → 换成 /opt/homebrew/bin/node 稳定软链，
 *     否则 node 升级后旧 Cellar 目录被 prune，launchd 静默 exec 失败（无日志、只有 spawn 失败）
 *   - realpath 相等才换，不是"文件存在即用"：nvm / 多版本机器不能被悄悄换成另一个大版本
 *   - 找不到等价稳定别名 → 保持原路径（行为不回退，不是 fail）
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明
import { pickStableNodeBin, STABLE_NODE_CANDIDATES } from '../数据管理/lib/launchd-node-bin.mjs';

const CELLAR = '/opt/homebrew/Cellar/node/26.3.1/bin/node';

/** 造一个假 realpath：给定「路径 → 实路径」映射，未登记的路径视为不存在（null）。 */
const fakeRealpath = (map: Record<string, string>) => (p: string) => map[p] ?? null;

describe('pickStableNodeBin', () => {
  it('Homebrew：Cellar 实路径 → 换成 /opt/homebrew/bin/node 稳定软链（回归锁）', () => {
    const realpathOf = fakeRealpath({
      [CELLAR]: CELLAR,
      '/opt/homebrew/bin/node': CELLAR, // 软链指向同一个二进制
    });
    expect(pickStableNodeBin({ rawPath: CELLAR, realpathOf })).toBe('/opt/homebrew/bin/node');
  });

  it('传入的已经是稳定别名 → 原样返回（幂等，不绕回 Cellar）', () => {
    const realpathOf = fakeRealpath({ '/opt/homebrew/bin/node': CELLAR, [CELLAR]: CELLAR });
    expect(pickStableNodeBin({ rawPath: '/opt/homebrew/bin/node', realpathOf })).toBe('/opt/homebrew/bin/node');
  });

  it('nvm：稳定候选存在但指向另一个 node → 保持原路径，绝不悄悄换大版本', () => {
    const nvm = '/Users/u/.nvm/versions/node/v20.11.0/bin/node';
    const realpathOf = fakeRealpath({
      [nvm]: nvm,
      '/opt/homebrew/bin/node': CELLAR, // 存在，但不是同一个二进制
    });
    expect(pickStableNodeBin({ rawPath: nvm, realpathOf })).toBe(nvm);
  });

  it('无任何稳定候选（自编译 / 非 Homebrew）→ 保持原路径', () => {
    const custom = '/usr/local/opt/custom/bin/node';
    expect(pickStableNodeBin({ rawPath: custom, realpathOf: fakeRealpath({ [custom]: custom }) })).toBe(custom);
  });

  it('Intel Homebrew：/usr/local/bin/node 同样被识别为稳定别名', () => {
    const intelCellar = '/usr/local/Cellar/node/26.3.1/bin/node';
    const realpathOf = fakeRealpath({
      [intelCellar]: intelCellar,
      '/usr/local/bin/node': intelCellar,
    });
    expect(pickStableNodeBin({ rawPath: intelCellar, realpathOf })).toBe('/usr/local/bin/node');
  });

  it('两个候选都等价时按优先级取 ARM 前缀（候选顺序即优先级）', () => {
    const realpathOf = fakeRealpath({
      [CELLAR]: CELLAR,
      '/opt/homebrew/bin/node': CELLAR,
      '/usr/local/bin/node': CELLAR,
    });
    expect(pickStableNodeBin({ rawPath: CELLAR, realpathOf })).toBe(STABLE_NODE_CANDIDATES[0]);
  });

  it('rawPath 自身解不动 realpath → 保持原样，不误判成某个候选', () => {
    const realpathOf = fakeRealpath({ '/opt/homebrew/bin/node': CELLAR });
    expect(pickStableNodeBin({ rawPath: '/gone/node', realpathOf })).toBe('/gone/node');
  });

  it('候选路径不存在（realpath 返回 null）不应与 null 目标误配', () => {
    const realpathOf = (p: string) => (p === CELLAR ? CELLAR : null);
    expect(pickStableNodeBin({ rawPath: CELLAR, realpathOf })).toBe(CELLAR);
  });
});
