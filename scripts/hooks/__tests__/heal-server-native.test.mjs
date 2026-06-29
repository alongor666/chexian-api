// @vitest-environment node
/**
 * lib/heal-server-native.sh —— server 原生模块「健康检查 + 分级自愈」共享库单测
 *
 * 被 pre-push（推送前前置兜底）与 post-checkout（worktree add 后腐蚀自愈）source 复用。
 * 见 .claude/rules/worktree-setup.md §B + pr-evolution.md R20/#844。
 *
 * 测试范围（纯逻辑，进 CI）：
 *   · heal_native_manual_hint —— 按分发类型给手动指引（bcrypt build-from-source / @duckdb 删 scope）
 *   · heal_native_module_ok / heal_native_unhealthy / heal_native_all_ok —— 用 **fake 模块** 模拟
 *     「目录在但 require 失败」（worktree 的真实故障模式），不依赖真原生模块/网络。
 *   · heal_native_cp_one —— 离线兜底的边界（主仓即自己时不自我 cp）。
 * 真正的 `bun install --force` 端到端自愈（需 bun + 网络 + 真原生模块）走本地手验，不进 CI。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(__dirname, '../lib/heal-server-native.sh')

/** 隔离 git 环境（清继承上下文 + 屏蔽全局/系统 config），避免外部 git 污染 → flaky。 */
function gitEnv(extra = {}) {
  const e = { ...process.env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG']) delete e[k]
  e.GIT_CONFIG_GLOBAL = '/dev/null'
  e.GIT_CONFIG_SYSTEM = '/dev/null'
  e.GIT_TERMINAL_PROMPT = '0'
  return { ...e, ...extra }
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`)
  return r
}

/**
 * source 库后跑一段 bash（可先覆盖 HEAL_NATIVE_MODULES）。
 * @returns {{status:number, stdout:string}}
 */
function runLib(script, { cwd, modules } = {}) {
  const override = modules ? `HEAL_NATIVE_MODULES=(${modules.map((m) => `'${m}'`).join(' ')})\n` : ''
  const full = `set -u\n. "${LIB}"\n${override}${script}`
  const r = spawnSync('bash', ['-c', full], { cwd, encoding: 'utf8', env: gitEnv() })
  return { status: r.status, stdout: (r.stdout || '').trim() }
}

/** 在 root/node_modules 下建一个 require 成功的 fake 包（含可选 .node 占位）。 */
function mkOkModule(root, name, { withNode = false } = {}) {
  const dir = path.join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  writeFileSync(path.join(dir, 'index.js'), 'module.exports = {}')
  if (withNode) writeFileSync(path.join(dir, 'fake.node'), 'BINARY')
}

/** 建一个「目录在但 require 失败」的坏包（无 package.json / index.js）——worktree 的真实故障模式。 */
function mkBadModule(root, name) {
  mkdirSync(path.join(root, 'node_modules', name), { recursive: true })
}

let tmpBase
let serverDir // 普通 server fixture（非 git）

beforeAll(() => {
  tmpBase = mkdtempSync(path.join(tmpdir(), 'cx-heal-'))
  serverDir = path.join(tmpBase, 'server')
  mkdirSync(path.join(serverDir, 'node_modules'), { recursive: true })
  mkOkModule(serverDir, 'cx-fake-ok')
  mkBadModule(serverDir, 'cx-fake-bad')
}, 30000)

afterAll(() => {
  if (tmpBase) rmSync(tmpBase, { recursive: true, force: true })
}, 30000)

describe('heal_native_manual_hint · 按分发类型给手动指引', () => {
  it('源码型 bcrypt → build-from-source + 删单包', () => {
    const { stdout } = runLib('heal_native_manual_hint bcrypt')
    expect(stdout).toContain('npm_config_build_from_source=true')
    expect(stdout).toContain('node_modules/bcrypt')
  })
  it('源码型 better-sqlite3 → build-from-source', () => {
    const { stdout } = runLib('heal_native_manual_hint better-sqlite3')
    expect(stdout).toContain('npm_config_build_from_source=true')
    expect(stdout).toContain('node_modules/better-sqlite3')
  })
  it('@duckdb/node-api → 删整个 @duckdb scope，不 build-from-source', () => {
    const { stdout } = runLib('heal_native_manual_hint @duckdb/node-api')
    expect(stdout).toContain('node_modules/@duckdb')
    expect(stdout).not.toContain('build_from_source')
  })
})

describe('heal_native_module_ok · 单模块加载判定', () => {
  it('健康 fake 包 → 退出 0', () => {
    expect(runLib(`heal_native_module_ok "${serverDir}" cx-fake-ok`).status).toBe(0)
  })
  it('「目录在但 require 失败」的坏包 → 非 0', () => {
    expect(runLib(`heal_native_module_ok "${serverDir}" cx-fake-bad`).status).not.toBe(0)
  })
  it('完全不存在的模块目录 → 非 0', () => {
    expect(runLib(`heal_native_module_ok "${serverDir}" cx-not-there`).status).not.toBe(0)
  })
})

describe('heal_native_all_ok · 快速门（单进程检查全部）', () => {
  it('全部健康 → 0', () => {
    expect(runLib(`heal_native_all_ok "${serverDir}"`, { modules: ['cx-fake-ok'] }).status).toBe(0)
  })
  it('含一个坏包 → 非 0', () => {
    expect(runLib(`heal_native_all_ok "${serverDir}"`, { modules: ['cx-fake-ok', 'cx-fake-bad'] }).status).not.toBe(0)
  })
  it('node_modules 不存在的目录 → 非 0', () => {
    expect(runLib(`heal_native_all_ok "${path.join(tmpBase, 'nope')}"`, { modules: ['cx-fake-ok'] }).status).not.toBe(0)
  })
})

describe('heal_native_unhealthy · 只列不健康模块', () => {
  it('混合 → 仅输出坏包名', () => {
    const { stdout } = runLib(`heal_native_unhealthy "${serverDir}"`, { modules: ['cx-fake-ok', 'cx-fake-bad'] })
    expect(stdout).toBe('cx-fake-bad')
  })
  it('全健康 → 空输出', () => {
    const { stdout } = runLib(`heal_native_unhealthy "${serverDir}"`, { modules: ['cx-fake-ok'] })
    expect(stdout).toBe('')
  })
})

describe('heal_native_cp_one · 离线兜底边界', () => {
  let repoServer
  beforeAll(() => {
    // 普通（非 linked worktree）git repo：git-common-dir == .git → main_server == server_dir → 不自我 cp
    const repo = path.join(tmpBase, 'plain-repo')
    mkdirSync(repo, { recursive: true })
    git(['init', '-q', '-b', 'main'], repo)
    repoServer = path.join(repo, 'server')
    mkdirSync(path.join(repoServer, 'node_modules'), { recursive: true })
    mkOkModule(repoServer, 'cx-fake-ok', { withNode: true })
  }, 30000)

  it('主仓即自己（非 linked worktree）→ 返回 1（不自我 cp）', () => {
    const { status } = runLib(`heal_native_cp_one "${repoServer}" cx-fake-ok`, { cwd: repoServer, modules: ['cx-fake-ok'] })
    expect(status).toBe(1)
  })
  it('非 git 目录（无 git-common-dir）→ 返回 1（优雅失败）', () => {
    const { status } = runLib(`heal_native_cp_one "${serverDir}" cx-fake-ok`, { cwd: serverDir, modules: ['cx-fake-ok'] })
    expect(status).toBe(1)
  })
})
