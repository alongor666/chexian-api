/**
 * 红绿夹具测试：项目本地 skill frontmatter 契约闸（2026-07-16 评审返工新增；
 * 2026-07-16 存量迁移收口时补目录/软链形态覆盖）
 *
 * 兑现 .claude/rules/skill-prefix.md「Frontmatter 必填」契约：
 * name 非空且=文件名/目录名 stem、description 非空且含触发语义、frontmatter 可解析。
 * 五个红灯场景（缺 name / 错 name / 空 description / 无触发语义 / 损坏 YAML）+ 绿灯对照，
 * 另补目录形态 `<name>/SKILL.md`（含真实目录与软链两种）+ 非技能目录跳过 + 空目录通过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSkillFrontmatterCheck } from '../governance/skill-frontmatter.mjs';

const silentIo = { info: () => {}, success: () => {}, error: () => {} };

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fm-'));
  fs.mkdirSync(path.join(tmp, '.claude/skills'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSkill(filename, content) {
  fs.writeFileSync(path.join(tmp, '.claude/skills', filename), content);
}

/** 建一个目录形态 skill：.claude/skills/<name>/SKILL.md */
function writeSkillDir(dirname, content) {
  const dir = path.join(tmp, '.claude/skills', dirname);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

/** 建一个软链目录形态 skill：.claude/skills/<name> -> 真实目录含 SKILL.md（模拟 sync-skills 直连） */
function writeSkillSymlink(dirname, content) {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-real-'));
  fs.writeFileSync(path.join(realDir, 'SKILL.md'), content);
  fs.symlinkSync(realDir, path.join(tmp, '.claude/skills', dirname), 'dir');
}

function run() {
  return runSkillFrontmatterCheck({ rootDir: tmp, io: silentIo });
}

const GOOD = `---
name: good-skill
description: 好技能 — 做正确的事。Use when 用户说"来一发"时。
version: 1.0.0
---

# 正文
`;

describe('skill frontmatter 契约闸', () => {
  it('绿：合规 skill 通过', () => {
    writeSkill('good-skill.md', GOOD);
    expect(run()).toBe(true);
  });

  it('绿：skills 目录不存在时跳过（无项目本地 skill）', () => {
    fs.rmSync(path.join(tmp, '.claude/skills'), { recursive: true });
    expect(run()).toBe(true);
  });

  it('红：缺 name', () => {
    writeSkill('no-name.md', '---\ndescription: 描述。Use when 需要时。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：name 与文件名 stem 不一致', () => {
    writeSkill('real-name.md', '---\nname: other-name\ndescription: 描述。Use when 需要时。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：description 为空', () => {
    writeSkill('empty-desc.md', '---\nname: empty-desc\ndescription:\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：description 无触发语义（Use when/当用户/触发/适用于 全缺）', () => {
    writeSkill('no-trigger.md', '---\nname: no-trigger\ndescription: 只是一段自我介绍，没有说明何时该用本技能。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：损坏 YAML（frontmatter 未闭合）', () => {
    writeSkill('broken.md', '---\nname: broken\ndescription: 描述。Use when 需要时。\n# 正文（缺闭合 ---）\n');
    expect(run()).toBe(false);
  });

  it('红：完全没有 frontmatter', () => {
    writeSkill('bare.md', '# 裸标题开头\n正文\n');
    expect(run()).toBe(false);
  });

  it('绿：触发语义四种标记任一即可（当用户）', () => {
    writeSkill('cn-trigger.md', '---\nname: cn-trigger\ndescription: 当用户说"跑一下"时使用。\n---\n# 正文\n');
    expect(run()).toBe(true);
  });

  it('绿：空目录（0 个 skill）通过', () => {
    // beforeEach 已建空 .claude/skills，不写任何文件即代表「迁移后预期态」
    expect(run()).toBe(true);
  });

  it('绿：目录形态 <name>/SKILL.md 合规通过', () => {
    writeSkillDir('dir-skill', GOOD.replace('good-skill', 'dir-skill'));
    expect(run()).toBe(true);
  });

  it('绿：软链目录形态（sync-skills 直连场景）合规通过', () => {
    writeSkillSymlink('linked-skill', GOOD.replace('good-skill', 'linked-skill'));
    expect(run()).toBe(true);
  });

  it('红：目录形态 name 与目录名不一致同样被拦（防绕铁律塞实体技能）', () => {
    writeSkillDir('real-dir-name', GOOD.replace('good-skill', 'other-name'));
    expect(run()).toBe(false);
  });

  it('绿：目录内无 SKILL.md 视为非技能目录，跳过不报错', () => {
    fs.mkdirSync(path.join(tmp, '.claude/skills', 'not-a-skill', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude/skills', 'not-a-skill', 'README.md'), '# 杂项\n');
    expect(run()).toBe(true);
  });
});
