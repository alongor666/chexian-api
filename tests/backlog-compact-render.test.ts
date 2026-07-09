/**
 * 活跃视图紧凑渲染（renderRow compact / renderBacklog）单测
 *
 * 背景：BACKLOG.md 活跃视图整读会爆 25K token 上限——40 活跃任务把「完整 desc +
 * 全 note 链 + evidence」全量内联进表行（uid 2026-07-09-claude-e1c892）。
 * 治理：活跃视图改紧凑渲染（desc 截断 + note 链折叠 + 不铺 evidence），
 * 归档视图（renderArchive）保留完整历史。真相仍在 BACKLOG_LOG.jsonl，`backlog.mjs list <uid>` 可取全文。
 *
 * 本测试锁三条不变量：① 活跃行 desc 截断到 ACTIVE_DESC_MAX + 省略号；
 * ② note 链 ≥3 条折叠为「N 条 note，最新：…」且含计数；③ 归档行保留全 desc/note/evidence。
 */
import { describe, it, expect } from 'vitest';
import {
  renderRow,
  renderBacklog,
  renderArchive,
  ACTIVE_DESC_MAX,
} from '../scripts/backlog/lib.mjs';

/** 合成一个 fold 后形态的任务（字段与 lib.mjs fold() 产出对齐） */
function makeTask(overrides = {}) {
  return {
    uid: '2026-07-09-claude-test01',
    legacy_id: null,
    created: '2026-07-09',
    owner: '@claude',
    section: '治理·测试',
    priority: 'P2',
    desc: '默认描述',
    docs: 'N/A',
    code: 'scripts/backlog/lib.mjs',
    status: 'IN_PROGRESS',
    evidence: '',
    notes: [],
    ...overrides,
  };
}

// 远超 120 字的合成 desc（用单一字符便于精确断言截断边界）
const LONG_DESC = '甲'.repeat(300);

describe('renderRow — 活跃紧凑 vs 完整', () => {
  it('活跃行 desc 截断到 ACTIVE_DESC_MAX 字并加省略号，全文不进活跃行', () => {
    const row = renderRow(makeTask({ desc: LONG_DESC }), { compact: true });
    // 恰好 ACTIVE_DESC_MAX 个「甲」被保留，第 121 个被截掉
    expect(row).toContain('甲'.repeat(ACTIVE_DESC_MAX));
    expect(row).not.toContain('甲'.repeat(ACTIVE_DESC_MAX + 1));
    expect(row).toContain('…');
    // 全文 300 字绝不出现在活跃行
    expect(row).not.toContain(LONG_DESC);
  });

  it('完整行（归档默认）保留完整 desc，不截断、不加省略号', () => {
    const row = renderRow(makeTask({ desc: LONG_DESC, status: 'DONE', evidence: 'PR #123' }));
    expect(row).toContain(LONG_DESC);
    expect(row).not.toContain('…');
  });

  it('短 desc（≤ACTIVE_DESC_MAX）活跃行原样渲染、不加省略号', () => {
    const short = '很短的描述';
    const row = renderRow(makeTask({ desc: short }), { compact: true });
    expect(row).toContain(short);
    expect(row).not.toContain('…');
  });

  it('活跃行 note 链 ≥3 条折叠为「N 条 note，最新：…」并含计数，旧 note 不铺', () => {
    const notes = ['注记一号早期上下文', '注记二号中间进展', '注记三号最新结论XYZ'];
    const row = renderRow(makeTask({ notes }), { compact: true });
    expect(row).toContain('3 条 note');
    expect(row).toContain('最新：');
    expect(row).toContain('注记三号最新结论XYZ'); // 最新一条保留
    expect(row).not.toContain('注记一号早期上下文'); // 折叠掉的旧 note 不出现
    expect(row).not.toContain('注记二号中间进展');
  });

  it('活跃行 ≤2 条 note 内联展示，不出现折叠计数头', () => {
    const row = renderRow(makeTask({ notes: ['仅一条进展记录'] }), { compact: true });
    expect(row).toContain('仅一条进展记录');
    expect(row).not.toContain('条 note，最新：');
  });

  it('活跃行 0 条 note 时证据列为空', () => {
    const row = renderRow(makeTask({ notes: [] }), { compact: true });
    // 末列（证据/证据列）应为空 —— 行以「| |」收尾（最后两列 code、空证据列）
    expect(row.endsWith('|  |')).toBe(true);
  });

  it('活跃行不铺 evidence（evidence 仅终态/归档渲染），完整行铺 evidence', () => {
    const t = makeTask({ evidence: 'PR #999 合并证据链', notes: [] });
    expect(renderRow(t, { compact: true })).not.toContain('PR #999 合并证据链');
    expect(renderRow(t)).toContain('PR #999 合并证据链');
  });

  it('检索键（uid/状态/优先级/板块）在紧凑行完整保留', () => {
    const t = makeTask({ desc: LONG_DESC, notes: ['n1', 'n2', 'n3'] });
    const row = renderRow(t, { compact: true });
    expect(row).toContain(t.uid); // 身份键不截
    expect(row).toContain('P2'); // 优先级
    expect(row).toContain('IN_PROGRESS'); // 状态
    expect(row).toContain('治理·测试'); // 板块
  });
});

describe('renderBacklog / renderArchive — 视图分层', () => {
  const activeTask = makeTask({
    uid: '2026-07-09-claude-actv01',
    desc: LONG_DESC,
    notes: ['进展一', '进展二', '进展三最新'],
    status: 'IN_PROGRESS',
  });
  const doneTask = makeTask({
    uid: '2026-07-09-claude-done01',
    desc: LONG_DESC,
    notes: ['进展一', '进展二', '进展三最新'],
    status: 'DONE',
    evidence: 'PR #1 完整证据',
  });

  it('renderBacklog 活跃视图：desc 截断 + note 折叠 + 不含 evidence 全文', () => {
    const backlog = renderBacklog([activeTask, doneTask]);
    expect(backlog).toContain('…'); // 截断标记
    expect(backlog).toContain('3 条 note'); // note 折叠计数
    expect(backlog).not.toContain(LONG_DESC); // 完整 desc 不进活跃视图
    expect(backlog).toContain(activeTask.uid); // 活跃任务在
    expect(backlog).not.toContain(doneTask.uid); // 终态任务不在活跃视图
  });

  it('renderArchive 归档视图：保留完整 desc + 全 note 链 + evidence', () => {
    const archive = renderArchive([activeTask, doneTask]);
    expect(archive).toContain(LONG_DESC); // 完整 desc 保留
    expect(archive).toContain('进展一'); // 全 note 链保留（不折叠）
    expect(archive).toContain('进展二');
    expect(archive).toContain('PR #1 完整证据'); // evidence 保留
    expect(archive).toContain(doneTask.uid);
    expect(archive).not.toContain(activeTask.uid); // 活跃任务不进归档
  });
});
