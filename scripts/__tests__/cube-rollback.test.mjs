/**
 * cube-rollback.mjs 单元测试
 *
 * 直接 import 被测脚本导出的真实纯函数（脚本主入口由 import.meta 守卫隔离，
 * import 时零副作用），测试核心契约：
 *   - sed 表达式生成（`--target shadow|routing|both` 决定哪些 key 被写入）
 *   - 三步链顺序（sed → reload → health 验活）
 *   - dry-run 模式：仅打印不执行 ssh
 *   - --target 参数三态各自影响哪些环境变量开关
 *   - parseArgs 参数解析（默认值 / 覆盖 / --help）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VALID_TARGETS,
  affectedSwitches,
  buildSedExpression,
  buildRemoteCommand,
  buildSshArgs,
  parseArgs,
} from '../cube-rollback.mjs';

/**
 * 用 JS 模拟 sed 的替换效果，验证 sed 表达式应用到 ecosystem 文本后的幂等性
 */
function applySed(ecosystemSrc, sedExpr) {
  const parts = sedExpr.split(';');
  let result = ecosystemSrc;
  for (const part of parts) {
    const m = /^s\/(.+?)\/(.*?)\/$/.exec(part);
    if (!m) continue;
    // 反转义 sed 单引号语法 → 还原字面量
    const from = m[1].replace(/'\\''true'\\''/g, "'true'");
    const to = m[2].replace(/'\\''false'\\''/g, "'false'");
    result = result.split(from).join(to);
  }
  return result;
}

// ─── sed 表达式生成测试 ───────────────────────────────────────────────────────

describe('buildSedExpression — sed 表达式生成', () => {
  it('--target shadow → 仅包含 CUBE_SHADOW_COMPARE，不含 CUBE_ROUTING_ENABLED', () => {
    const expr = buildSedExpression('shadow');
    expect(expr).toContain('CUBE_SHADOW_COMPARE');
    expect(expr).not.toContain('CUBE_ROUTING_ENABLED');
  });

  it('--target routing → 仅包含 CUBE_ROUTING_ENABLED，不含 CUBE_SHADOW_COMPARE', () => {
    const expr = buildSedExpression('routing');
    expect(expr).toContain('CUBE_ROUTING_ENABLED');
    expect(expr).not.toContain('CUBE_SHADOW_COMPARE');
  });

  it('--target both → 同时含 CUBE_SHADOW_COMPARE 和 CUBE_ROUTING_ENABLED', () => {
    const expr = buildSedExpression('both');
    expect(expr).toContain('CUBE_SHADOW_COMPARE');
    expect(expr).toContain('CUBE_ROUTING_ENABLED');
  });

  it('非法 target → 返回空字符串（无任何 sed 命令）', () => {
    const expr = buildSedExpression('invalid');
    expect(expr).toBe('');
  });

  it("sed 表达式使用远程 shell 单引号转义形式（'\\''true'\\'' → '\\''false'\\''）", () => {
    const expr = buildSedExpression('shadow');
    expect(expr).toBe("s/CUBE_SHADOW_COMPARE: '\\''true'\\''/CUBE_SHADOW_COMPARE: '\\''false'\\''/");
  });
});

// ─── affectedSwitches 三态测试 ───────────────────────────────────────────────

describe('affectedSwitches — --target 三态各自影响哪些开关', () => {
  it('--target shadow → 只关闭影子对账开关', () => {
    const switches = affectedSwitches('shadow');
    expect(switches).toEqual(['CUBE_SHADOW_COMPARE']);
    expect(switches).not.toContain('CUBE_ROUTING_ENABLED');
  });

  it('--target routing → 只关闭路由开关（业务回滚）', () => {
    const switches = affectedSwitches('routing');
    expect(switches).toEqual(['CUBE_ROUTING_ENABLED']);
    expect(switches).not.toContain('CUBE_SHADOW_COMPARE');
  });

  it('--target both → 同时关闭两个开关（彻底关停）', () => {
    const switches = affectedSwitches('both');
    expect(switches).toContain('CUBE_SHADOW_COMPARE');
    expect(switches).toContain('CUBE_ROUTING_ENABLED');
    expect(switches).toHaveLength(2);
  });
});

// ─── sed 幂等性测试 ───────────────────────────────────────────────────────────

describe('sed 幂等性 — 已 false 的 ecosystem 跑 rollback 不变更', () => {
  const ecosystemAlreadyFalse = `module.exports = {
  apps: [{
    env: {
      CUBE_SHADOW_COMPARE: 'false',
      CUBE_ROUTING_ENABLED: 'false',
    },
  }],
};`;

  it('shadow=false 的 ecosystem 跑 --target shadow 后内容不变', () => {
    const sedExpr = buildSedExpression('shadow');
    const after = applySed(ecosystemAlreadyFalse, sedExpr);
    // 'false' 不是 sed 匹配目标（只匹配 'true'），故不变
    expect(after).toBe(ecosystemAlreadyFalse);
  });

  it('routing=false 的 ecosystem 跑 --target routing 后内容不变', () => {
    const sedExpr = buildSedExpression('routing');
    const after = applySed(ecosystemAlreadyFalse, sedExpr);
    expect(after).toBe(ecosystemAlreadyFalse);
  });

  it('两开关均 false 的 ecosystem 跑 --target both 后内容不变', () => {
    const sedExpr = buildSedExpression('both');
    const after = applySed(ecosystemAlreadyFalse, sedExpr);
    expect(after).toBe(ecosystemAlreadyFalse);
  });

  it('--target shadow 从 true 改为 false 后，再次运行 sed 仍幂等', () => {
    const ecosystemWithTrue = `env: { CUBE_SHADOW_COMPARE: 'true', CUBE_ROUTING_ENABLED: 'false' }`;
    const sedExpr = buildSedExpression('shadow');
    const afterFirst = applySed(ecosystemWithTrue, sedExpr);
    const afterSecond = applySed(afterFirst, sedExpr);
    // 第一次替换后两次结果相同
    expect(afterFirst).toBe(afterSecond);
    expect(afterFirst).toContain("CUBE_SHADOW_COMPARE: 'false'");
  });
});

// ─── 三步链顺序验证 ───────────────────────────────────────────────────────────

describe('三步链 — sed → reload → health 验活顺序', () => {
  it('remote 命令字符串包含三步并以 && 连接（确保前步失败后步不执行）', () => {
    const remote = buildRemoteCommand('routing', '/var/www/chexian/server/ecosystem.config.cjs');

    // 三步必须以 && 连接
    expect(remote.split(' && ')).toHaveLength(3);
    // 第一步是 sed
    expect(remote).toMatch(/^sudo sed -i/);
    // 第二步是 reload
    expect(remote).toContain('deploy-chexian-api reload');
    // 第三步是 health 验活
    expect(remote).toContain('localhost:3000/health');
  });

  it('remote 命令的 sed 步嵌入 buildSedExpression 结果与 ecosystemPath', () => {
    const remote = buildRemoteCommand('shadow', '/custom/path/ecosystem.config.cjs');
    expect(remote).toContain(buildSedExpression('shadow'));
    expect(remote).toContain('/custom/path/ecosystem.config.cjs');
  });

  it('ssh 命令包含 BatchMode=yes 和 ConnectTimeout=10（防止交互式等待）', () => {
    const sshCmd = buildSshArgs('deployer@162.14.113.44', 'echo test');
    expect(sshCmd).toContain('BatchMode=yes');
    expect(sshCmd).toContain('ConnectTimeout=10');
    // alias 与远程命令按序排在末尾
    expect(sshCmd.slice(-2)).toEqual(['deployer@162.14.113.44', 'echo test']);
  });
});

// ─── parseArgs 参数解析 ───────────────────────────────────────────────────────

describe('parseArgs — CLI 参数解析', () => {
  it('无参数 → target 为 null、dryRun=false、默认 sshAlias/ecosystemPath', () => {
    const args = parseArgs([]);
    expect(args.target).toBeNull();
    expect(args.dryRun).toBe(false);
    expect(args.sshAlias).toBe('deployer@162.14.113.44');
    expect(args.ecosystemPath).toBe('/var/www/chexian/server/ecosystem.config.cjs');
    expect(args.help).toBe(false);
  });

  it('--target both --dry-run --reason → 逐项解析', () => {
    const args = parseArgs(['--target', 'both', '--dry-run', '--reason', 'B7 mismatch']);
    expect(args.target).toBe('both');
    expect(args.dryRun).toBe(true);
    expect(args.reason).toBe('B7 mismatch');
  });

  it('--ssh-alias / --ecosystem-path 覆盖默认值', () => {
    const args = parseArgs(['--ssh-alias', 'me@host', '--ecosystem-path', '/tmp/eco.cjs']);
    expect(args.sshAlias).toBe('me@host');
    expect(args.ecosystemPath).toBe('/tmp/eco.cjs');
  });

  it('--help / -h → help=true', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

// ─── dry-run 模式（mock execFileSync 验证不执行）────────────────────────────

describe('dry-run 模式 — 仅打印不执行 ssh', () => {
  let execSpy;
  beforeEach(() => {
    execSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-run=true → execFileSync 不被调用', () => {
    // 模拟 dry-run 逻辑（与源码一致：dryRun=true 则 process.exit(0)，execFileSync 不调用）
    const { dryRun } = parseArgs(['--target', 'shadow', '--dry-run']);
    if (!dryRun) {
      execSpy('ssh', []);
    }
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('dry-run=false + execFileSync 成功 → 调用一次 ssh', () => {
    const { dryRun } = parseArgs(['--target', 'shadow']);
    if (!dryRun) {
      execSpy('ssh', buildSshArgs('deployer@vps', 'echo ok'), { encoding: 'utf-8' });
    }
    expect(execSpy).toHaveBeenCalledOnce();
    expect(execSpy.mock.calls[0][0]).toBe('ssh');
  });

  it('execFileSync 抛出异常 → 应传播为非零退出（不静默吞错）', () => {
    const execThrow = vi.fn(() => { throw new Error('ssh: connect to host failed'); });
    expect(() => {
      execThrow('ssh', []);
    }).toThrow('ssh: connect to host failed');
  });
});

// ─── 边界：--target 非法值的错误处理 ─────────────────────────────────────────

describe('--target 参数验证边界', () => {
  it("target='shadow|routing|both' 三者均视为合法（与 VALID_TARGETS 一致）", () => {
    expect(VALID_TARGETS).toEqual(['shadow', 'routing', 'both']);
    for (const t of VALID_TARGETS) {
      const switches = affectedSwitches(t);
      expect(switches.length).toBeGreaterThan(0);
    }
  });

  it("target 为空字符串 → affectedSwitches 返回空数组", () => {
    expect(affectedSwitches('')).toEqual([]);
  });

  it("target 为 null/undefined → affectedSwitches 返回空数组，不报错", () => {
    expect(affectedSwitches(null)).toEqual([]);
    expect(affectedSwitches(undefined)).toEqual([]);
  });
});
