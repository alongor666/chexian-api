/**
 * SSH 连接复用 + 域间有界并发（BACKLOG 2026-07-10-claude-976a9d）
 *
 * 背景：sync-vps 每域任务 mkdir(ssh) + rsync(-e ssh) 各开独立 TCP 连接，无上限并行触发
 * 生产 sshd MaxStartups 节流（kex_exchange_identification: Connection reset by peer）。
 * 修复 = ControlMaster/ControlPersist 复用单条连接 + runWithConcurrency 有界并发（默认 6）。
 *
 * 本文件锁定：复用选项构造 / 逃生阀 / rsync -e 注入 / 并发上限解析 / 有界并发执行器语义。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sshMuxEnabled,
  buildSshMuxOptions,
  buildSshCommandString,
  sshConcurrencyLimit,
  runWithConcurrency,
  buildRsyncArgs,
} from '../sync-vps.mjs';

const ENV_KEYS = ['SYNC_VPS_SSH_MUX', 'SYNC_VPS_CONCURRENCY'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('buildSshMuxOptions — ControlMaster 复用选项构造', () => {
  it('默认开启：含 ControlMaster=auto + ControlPath（~/.ssh 下 %C 哈希）+ ControlPersist=60s', () => {
    expect(sshMuxEnabled()).toBe(true);
    const opts = buildSshMuxOptions();
    expect(opts).toContain('ControlMaster=auto');
    expect(opts).toContain('ControlPersist=60s');
    const controlPath = opts.find((o) => o.startsWith('ControlPath='));
    expect(controlPath).toBeDefined();
    expect(controlPath).toContain('cx-sync-%C');
    // unix socket 路径长度上限约 104 字节：必须在 ~/.ssh 下，禁止落仓库内中文长路径
    expect(controlPath).toContain('/.ssh/');
    expect(controlPath).not.toMatch(/\s/); // rsync -e 按空白切分命令串，路径含空格会被截断
  });

  it('SYNC_VPS_SSH_MUX=0/false/no → 逃生阀关闭复用，回落裸 ssh（历史行为）', () => {
    for (const off of ['0', 'false', 'no']) {
      process.env.SYNC_VPS_SSH_MUX = off;
      expect(sshMuxEnabled()).toBe(false);
      expect(buildSshMuxOptions()).toEqual([]);
      expect(buildSshCommandString()).toBe('ssh');
    }
  });

  it('buildSshCommandString 开启时 = ssh + 全部复用选项拼接（rsync -e 可直接消费）', () => {
    const cmd = buildSshCommandString();
    expect(cmd.startsWith('ssh ')).toBe(true);
    expect(cmd).toContain('-o ControlMaster=auto');
    expect(cmd).toContain('-o ControlPersist=60s');
  });
});

describe('buildRsyncArgs — sshCommand 注入（-e 单一来源，防执行与 dry-run 漂移）', () => {
  const base = { src: '/local/dir/', remote: 'alias:/remote/dir/' };

  it('默认 sshCommand=ssh：与历史逐字节等价（纯函数字节安全基线）', () => {
    const args = buildRsyncArgs(base);
    const eIdx = args.indexOf('-e');
    expect(args[eIdx + 1]).toBe('ssh');
  });

  it('显式传 buildSshCommandString()：-e 值为完整复用命令串，src/remote 仍在末尾', () => {
    const args = buildRsyncArgs({ ...base, sshCommand: buildSshCommandString() });
    const eIdx = args.indexOf('-e');
    expect(args[eIdx + 1]).toContain('ControlMaster=auto');
    expect(args[args.length - 2]).toBe('/local/dir/');
    expect(args[args.length - 1]).toBe('alias:/remote/dir/');
  });
});

describe('sshConcurrencyLimit — 域间并发上限解析', () => {
  it('默认 6（复用后受服务端 MaxSessions=10 限制，留旁路会话余量）', () => {
    expect(sshConcurrencyLimit()).toBe(6);
  });

  it('SYNC_VPS_CONCURRENCY 合法正整数生效；非法值（0/负数/非数字）回落 6', () => {
    process.env.SYNC_VPS_CONCURRENCY = '3';
    expect(sshConcurrencyLimit()).toBe(3);
    for (const bad of ['0', '-2', 'abc', '2.5']) {
      process.env.SYNC_VPS_CONCURRENCY = bad;
      expect(sshConcurrencyLimit()).toBe(6);
    }
  });
});

describe('runWithConcurrency — 有界并发执行器', () => {
  it('结果按 items 原序返回，worker 收到 (item, index)', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const results = await runWithConcurrency(items, 2, async (item, i) => {
      // 故意让早期任务更慢，验证结果顺序不受完成顺序影响
      await new Promise((r) => setTimeout(r, (items.length - i) * 5));
      return `${item}:${i}`;
    });
    expect(results).toEqual(['a:0', 'b:1', 'c:2', 'd:3', 'e:4']);
  });

  it('瞬时并发数从不超过 limit（MaxSessions 保护的核心语义）', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithConcurrency(items, 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // 确认确实并发了（非串行退化）
  });

  it('limit 大于任务数时车道数收敛到任务数；空任务列表直接返回空数组', async () => {
    const results = await runWithConcurrency([1, 2], 8, async (x) => x * 10);
    expect(results).toEqual([10, 20]);
    expect(await runWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
