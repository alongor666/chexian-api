/**
 * 红绿夹具测试：项目本地 skill frontmatter 契约闸（2026-07-16 评审返工新增）
 *
 * 兑现 .claude/rules/skill-prefix.md「Frontmatter 必填」契约：
 * name 非空且=文件名 stem、description 非空且含触发语义、frontmatter 可解析。
 * 五个红灯场景（缺 name / 错 name / 空 description / 无触发语义 / 损坏 YAML）+ 绿灯对照。
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
});
