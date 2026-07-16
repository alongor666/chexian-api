/**
 * 红绿夹具测试：00_index 索引死链闸（2026-07-16 知识体系审计）
 *
 * 用临时目录构造合规/违规索引内容，断言闸的 pass/fail 行为——证明闸真能拦，不是空过。
 * 覆盖：相对/根锚定链接、裸根文件退役词、fenced code block、锚点、行号后缀、glob 跳过、
 * governance-allow 豁免边界、越界路径、gitignored 派生视图、上下文简写 token 跳过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIndexDocLinksCheck, extractRefs } from '../governance/index-doc-links.mjs';

const silentIo = { info: () => {}, success: () => {}, error: () => {} };
const notIgnored = () => false;

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-links-'));
  fs.mkdirSync(path.join(tmp, '开发文档/00_index'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 把内容写进被扫描的 DOC_INDEX 位置 */
function writeIndex(content) {
  fs.writeFileSync(path.join(tmp, '开发文档/00_index/DOC_INDEX.md'), content);
}

function writeRepoFile(rel, content = 'x') {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function run(overrides = {}) {
  return runIndexDocLinksCheck({ rootDir: tmp, io: silentIo, isGitIgnored: notIgnored, ...overrides });
}

describe('R1 — markdown 链接存在性', () => {
  it('绿：相对路径链接指向存在文件', () => {
    writeRepoFile('开发文档/00_index/CODE_INDEX.md');
    writeIndex('- [代码索引](./CODE_INDEX.md)\n');
    expect(run()).toBe(true);
  });

  it('红：相对路径链接指向不存在文件', () => {
    writeIndex('- [不存在](./GHOST.md)\n');
    expect(run()).toBe(false);
  });

  it('绿：/ 开头根锚定链接指向存在文件', () => {
    writeRepoFile('CLAUDE.md');
    writeIndex('- [协议](/CLAUDE.md)\n');
    expect(run()).toBe(true);
  });

  it('红：/ 开头根锚定链接指向不存在文件', () => {
    writeIndex('- [幽灵](/GEMINI.md)\n');
    expect(run()).toBe(false);
  });

  it('绿：不带前导 / 的仓库根相对链接（索引常见写法）', () => {
    writeRepoFile('server/src/sql/kpi.ts');
    writeIndex('- [口径](server/src/sql/kpi.ts)\n');
    expect(run()).toBe(true);
  });

  it('绿：纯锚点与 URL 跳过', () => {
    writeIndex('- [章节](#section) [外链](https://duckdb.org/docs) [邮件](mailto:x@y.z)\n');
    expect(run()).toBe(true);
  });

  it('绿：越出仓库的相对路径放行（无法校验）', () => {
    writeIndex('- [上游](../../../outside/thing.md)\n');
    expect(run()).toBe(true);
  });
});

describe('R2 — 反引号与 fenced code block 内路径 token', () => {
  it('红：反引号内根锚定死路径（首段是顶层目录）', () => {
    writeRepoFile('server/src/app.ts'); // 让 server 成为顶层条目
    writeIndex('| 契约 | `server/src/normalize/validator.ts` | 说明 |\n');
    expect(run()).toBe(false);
  });

  it('绿：反引号内根锚定路径存在（含 :行号 后缀剥离）', () => {
    writeRepoFile('server/src/services/duckdb.ts');
    writeIndex('| 视图 | `server/src/services/duckdb.ts:78-95` | 说明 |\n');
    expect(run()).toBe(true);
  });

  it('绿：上下文简写 token（首段非顶层条目）跳过', () => {
    writeIndex('| 路由 | `routes/` + `query/*.ts` 子路由 | 说明 |\n');
    expect(run()).toBe(true);
  });

  it('红：fenced code block 内的死路径命令', () => {
    writeRepoFile('scripts/keep.mjs'); // 让 scripts 成为顶层条目
    writeIndex('```bash\npython3 scripts/ghost_tool.py\n```\n');
    expect(run()).toBe(false);
  });

  it('绿：fenced code block 内存在的路径 + glob 跳过', () => {
    writeRepoFile('scripts/backlog.mjs');
    writeIndex('```bash\nbun scripts/backlog.mjs\nduckdb -c "SELECT 1 FROM \'数据管理/warehouse/fact/*.parquet\'"\n```\n');
    expect(run()).toBe(true);
  });

  it('绿：模板/占位/家目录 token 跳过', () => {
    writeIndex('```bash\nnode 数据管理/daily.mjs <域>\ncat 数据管理/release-manifests/YYYY-MM-DD.json\nls ~/.claude/skills/\n```\n');
    expect(run()).toBe(true);
  });
});

describe('R3 — 退役词硬禁', () => {
  it('红：签单清洗/ 出现即拦', () => {
    writeIndex('| 字典 | `签单清洗/字段字典.md` | 说明 |\n');
    expect(run()).toBe(false);
  });

  it('红：src/shared/duckdb 旧架构路径出现即拦', () => {
    writeIndex('见 `src/shared/duckdb/client.ts` 的实现\n');
    expect(run()).toBe(false);
  });

  it('红：裸 BACKLOG.md 无派生视图说明即拦', () => {
    writeIndex('详见 BACKLOG.md 需求账本\n');
    expect(run()).toBe(false);
  });

  it('绿：BACKLOG.md 带「派生视图」说明放行', () => {
    writeIndex('`BACKLOG.md` 为 gitignored 本地派生视图（bun run backlog:render 生成）\n');
    expect(run()).toBe(true);
  });

  it('绿：BACKLOG_LOG.jsonl 不误伤', () => {
    writeRepoFile('BACKLOG_LOG.jsonl');
    writeIndex('真相日志 `BACKLOG_LOG.jsonl` 冻结只读\n');
    expect(run()).toBe(true);
  });
});

describe('豁免边界 — governance-allow 标记', () => {
  it('绿：同行标记豁免退役词与死链', () => {
    writeIndex('- 原 `签单清洗/字典.md` 与 `/GHOST.md` 已删除 <!-- governance-allow: index-doc-links 墓碑 -->\n');
    expect(run()).toBe(true);
  });

  it('绿：上一行标记豁免', () => {
    writeIndex('<!-- governance-allow: index-doc-links 墓碑 -->\n- 原 `签单清洗/字典.md` 已删除\n');
    expect(run()).toBe(true);
  });

  it('红：标记只豁免所在行与下一行，不豁免隔行', () => {
    writeIndex('<!-- governance-allow: index-doc-links 墓碑 -->\n- 合法行\n- 死引用 `签单清洗/字典.md`\n');
    expect(run()).toBe(false);
  });

  it('红：错误命名空间的标记不豁免（防第六种词根后门）', () => {
    writeIndex('- `签单清洗/字典.md` <!-- link-ok: 理由 -->\n');
    expect(run()).toBe(false);
  });
});

describe('二期扩面 — 导航型活文档', () => {
  it('红：AGENTS.md 中的死链同样被扫描', () => {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '- 见 [幽灵](./GHOST.md)\n');
    expect(run()).toBe(false);
  });

  it('绿：a|b 择一简写不当作路径校验', () => {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '- 不维护 `.claude/commands|agents|skills/README.md` 索引\n');
    expect(run()).toBe(true);
  });
});

describe('gitignored 派生/数据产物', () => {
  it('绿：gitignored 路径不报死链（注入 stub）', () => {
    writeIndex('- [看板](/BACKLOG_ARCHIVE.md)\n');
    const ignoredStub = (_root, rel) => rel === 'BACKLOG_ARCHIVE.md';
    expect(run({ isGitIgnored: ignoredStub })).toBe(true);
  });

  it('红：同路径未被 ignore 则仍报死链', () => {
    writeIndex('- [看板](/BACKLOG_ARCHIVE.md)\n');
    expect(run()).toBe(false);
  });
});

describe('extractRefs 提取契约', () => {
  it('markdown 链接与反引号 token 分 kind', () => {
    const refs = extractRefs('- [a](./x.md) 与 `server/src/y.ts` 及 `routes/`');
    expect(refs).toContainEqual({ target: './x.md', kind: 'link' });
    expect(refs).toContainEqual({ target: 'server/src/y.ts', kind: 'token' });
    expect(refs).toContainEqual({ target: 'routes/', kind: 'token' });
  });

  it('不含 / 的裸词与纯中文说明不被提取', () => {
    const refs = extractRefs('| `mapping.ts` | 列名别名映射，详见 §2 |');
    expect(refs).toEqual([]);
  });
});
