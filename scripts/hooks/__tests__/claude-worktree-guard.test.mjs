// @vitest-environment node
/**
 * claude-worktree-guard.sh —— PreToolUse hook 端到端测试
 *
 * 验证 worktree 会话中 Write/Edit「逃逸进主仓」的拦截判定（exit 0 放行 / exit 2 拦截）。
 * 防 worktree 模式下用主仓绝对路径写代码 → 泄漏进主仓 main（PR #476/#644(heuristic)/#792 三次发作）。
 *
 * 用真临时 git repo + 一个 linked worktree（.claude/worktrees/ 嵌套落点）经 spawnSync 跑 bash hook
 * 断言退出码。兄弟目录落点的「前缀陷阱」（chexian-api vs chexian-api-sx-g8）用纯路径字符串验证
 * （hook 只看目标路径前缀、不要求该路径是真 worktree）；真实兄弟 worktree 会话由 PR 描述里的
 * 真实 chexian-api 端到端手验覆盖（与本单测互补）。
 *
 * 健壮性（避免满载并发 flaky）：① git 子进程一律走隔离 env（清 GIT_DIR/GIT_WORK_TREE 等继承上下文
 * + GIT_CONFIG_GLOBAL/SYSTEM=/dev/null），不受外部 git 环境污染落到错误 repo；② beforeAll/afterAll
 * 给足 timeout；③ 只建 1 个 worktree，最小化 fixture IO。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../claude-worktree-guard.sh')
const HAS_PY3 = spawnSync('python3', ['--version']).status === 0

let tmpBase
let mainRoot // 主仓（模拟 chexian-api）
let wtNested // .claude/worktrees/ 嵌套落点 worktree
let fakeSibling // 兄弟目录落点的纯路径（名字含主仓名前缀，验证前缀陷阱，不建真 worktree）

/** 隔离 git 环境：清继承的 git 上下文 + 屏蔽全局/系统 config，避免外部污染让命令落到错误 repo（flaky 根因）。 */
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
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (status ${r.status}): ${r.stderr || r.stdout}`)
  }
  return r
}

/** 跑 hook：返回退出码。默认经 $CLAUDE_TOOL_INPUT 传输（与生产 settings.json 一致）。 */
function runHook(filePath, cwd, { viaStdin = false } = {}) {
  const input = JSON.stringify({ file_path: filePath })
  const opts = { cwd, encoding: 'utf8', env: gitEnv() }
  if (viaStdin) {
    opts.input = input
  } else {
    opts.env = gitEnv({ CLAUDE_TOOL_INPUT: input })
  }
  return spawnSync('bash', [HOOK], opts).status
}

/** 跑 hook 传入任意原始 JSON（测无 file_path / 空输入）。 */
function runHookRaw(rawJson, cwd) {
  return spawnSync('bash', [HOOK], { cwd, encoding: 'utf8', env: gitEnv({ CLAUDE_TOOL_INPUT: rawJson }) }).status
}

beforeAll(() => {
  tmpBase = mkdtempSync(path.join(tmpdir(), 'cx-wt-guard-'))
  mainRoot = path.join(tmpBase, 'chexian-api')
  mkdirSync(mainRoot)
  git(['init', '-q', '-b', 'main'], mainRoot)
  git(['config', 'user.email', 'test@example.com'], mainRoot)
  git(['config', 'user.name', 'Test'], mainRoot)
  git(['commit', '--allow-empty', '-q', '-m', 'init'], mainRoot)

  // 嵌套落点：mainRoot/.claude/worktrees/wt-nested
  wtNested = path.join(mainRoot, '.claude', 'worktrees', 'wt-nested')
  git(['worktree', 'add', '-q', wtNested], mainRoot)

  // 兄弟目录落点的纯路径（名字 = 主仓名 + 后缀 → 前缀陷阱），不建真 worktree
  fakeSibling = path.join(tmpBase, 'chexian-api-sx-g8')
}, 30000)

afterAll(() => {
  if (tmpBase) rmSync(tmpBase, { recursive: true, force: true })
}, 30000)

describe('claude-worktree-guard · 嵌套落点 (.claude/worktrees/)', () => {
  it('放行：worktree 内绝对路径', () => {
    expect(runHook(path.join(wtNested, 'server/src/foo.ts'), wtNested)).toBe(0)
  })

  it('拦截：逃逸到主仓根的绝对路径（PR #476/#792 泄漏场景）', () => {
    expect(runHook(path.join(mainRoot, 'server/src/foo.ts'), wtNested)).toBe(2)
  })

  it('放行：worktree 内相对路径', () => {
    expect(runHook('server/src/foo.ts', wtNested)).toBe(0)
  })

  it.skipIf(!HAS_PY3)('拦截：相对路径用 ../ 逃逸到主仓（需 python3 规范化）', () => {
    // wtNested = mainRoot/.claude/worktrees/wt-nested，../../../ 回到 mainRoot
    expect(runHook('../../../server/src/foo.ts', wtNested)).toBe(2)
  })
})

describe('claude-worktree-guard · 前缀陷阱（chexian-api vs chexian-api-sx-g8）', () => {
  it('放行：目标在兄弟目录（主仓名是其前缀）不被主仓规则误判', () => {
    // cwd 在嵌套 worktree，目标在 tmpBase/chexian-api-sx-g8/ → 不以 tmpBase/chexian-api/ 开头 → 放行
    expect(runHook(path.join(fakeSibling, 'server/src/foo.ts'), wtNested)).toBe(0)
  })
})

describe('claude-worktree-guard · 不介入 / 边界', () => {
  it('放行：主仓会话（非 linked worktree）写主仓', () => {
    expect(runHook(path.join(mainRoot, 'server/src/foo.ts'), mainRoot)).toBe(0)
  })

  it('放行：无 file_path 的输入', () => {
    expect(runHookRaw(JSON.stringify({ tool: 'Bash' }), wtNested)).toBe(0)
  })

  it('放行：空输入', () => {
    expect(runHookRaw('', wtNested)).toBe(0)
  })

  it('放行：经 stdin 传输的 worktree 内路径（fallback 输入路径）', () => {
    expect(runHook(path.join(wtNested, 'server/src/foo.ts'), wtNested, { viaStdin: true })).toBe(0)
  })

  it('拦截：经 stdin 传输的逃逸路径（fallback 输入路径）', () => {
    expect(runHook(path.join(mainRoot, 'server/src/foo.ts'), wtNested, { viaStdin: true })).toBe(2)
  })
})
