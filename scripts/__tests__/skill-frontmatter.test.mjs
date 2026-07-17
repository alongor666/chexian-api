/**
 * 红绿夹具测试：项目本地 skill 契约闸（2026-07-16 评审返工新增；
 * 2026-07-16 存量迁移收口补目录/软链形态；同日 PR #1126 评审 P1-3 升级「实体必红灯」）
 *
 * 政策语义（2026-07-16 铁律，.claude/rules/skill-prefix.md [policy-override] 段）：
 * 项目内禁实体技能——实体 .md / 实体目录一律红灯（lstatSync 区分实体与软链）；
 * 合法形态只有软链（扁平 <name>.md 或目录 <name>/SKILL.md，sync-skills 直连）。
 * frontmatter 契约（name=stem、description 含触发语义、可解析）经软链继续强制。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSkillFrontmatterCheck } from '../governance/skill-frontmatter.mjs';

const silentIo = { info: () => {}, success: () => {}, error: () => {} };

let tmp;
let realDirs;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fm-'));
  fs.mkdirSync(path.join(tmp, '.claude/skills'), { recursive: true });
  realDirs = [];
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  realDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

/** 实体扁平 .md（铁律后一律违规） */
function writePhysicalSkill(filename, content) {
  fs.writeFileSync(path.join(tmp, '.claude/skills', filename), content);
}

/** 实体目录形态 .claude/skills/<name>/SKILL.md（铁律后一律违规） */
function writePhysicalSkillDir(dirname, content) {
  const dir = path.join(tmp, '.claude/skills', dirname);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

/** 软链扁平形态：.claude/skills/<name>.md -> 仓外真实 .md */
function writeSymlinkFlatSkill(filename, content) {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-real-'));
  realDirs.push(realDir);
  const realFile = path.join(realDir, filename);
  fs.writeFileSync(realFile, content);
  fs.symlinkSync(realFile, path.join(tmp, '.claude/skills', filename), 'file');
}

/** 软链目录形态：.claude/skills/<name> -> 真实目录含 SKILL.md（模拟 sync-skills 直连） */
function writeSymlinkSkillDir(dirname, content) {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-real-'));
  realDirs.push(realDir);
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

describe('skill 契约闸（实体必红灯 + frontmatter 契约）', () => {
  // —— 政策语义：实体条目红灯 ——

  it('红：实体扁平 .md 即使 frontmatter 完全合规也被拦（铁律：项目内禁实体技能）', () => {
    writePhysicalSkill('good-skill.md', GOOD);
    expect(run()).toBe(false);
  });

  it('红：实体目录形态即使 SKILL.md 合规也被拦', () => {
    writePhysicalSkillDir('dir-skill', GOOD.replace('good-skill', 'dir-skill'));
    expect(run()).toBe(false);
  });

  it('红：实体目录不含 SKILL.md 同样被拦（.claude/skills/ 内不允许任何实体目录）', () => {
    fs.mkdirSync(path.join(tmp, '.claude/skills', 'not-a-skill', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude/skills', 'not-a-skill', 'README.md'), '# 杂项\n');
    expect(run()).toBe(false);
  });

  it('绿：实体非 .md 杂项文件（.gitkeep）跳过不报错', () => {
    fs.writeFileSync(path.join(tmp, '.claude/skills', '.gitkeep'), '');
    expect(run()).toBe(true);
  });

  // —— 合法形态：软链 ——

  it('绿：软链目录形态（sync-skills 直连场景）合规通过', () => {
    writeSymlinkSkillDir('linked-skill', GOOD.replace('good-skill', 'linked-skill'));
    expect(run()).toBe(true);
  });

  it('绿：软链扁平 .md 形态合规通过', () => {
    writeSymlinkFlatSkill('good-skill.md', GOOD);
    expect(run()).toBe(true);
  });

  it('红：悬空软链（目标已删）被拦', () => {
    fs.symlinkSync(path.join(tmp, 'no-such-target'), path.join(tmp, '.claude/skills', 'dangling'), 'dir');
    expect(run()).toBe(false);
  });

  it('绿：软链目录内无 SKILL.md 视为非技能目录，跳过不报错', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-real-'));
    realDirs.push(realDir);
    fs.writeFileSync(path.join(realDir, 'README.md'), '# 杂项\n');
    fs.symlinkSync(realDir, path.join(tmp, '.claude/skills', 'linked-misc'), 'dir');
    expect(run()).toBe(true);
  });

  // —— frontmatter 契约经软链继续强制 ——

  it('红：软链技能缺 name', () => {
    writeSymlinkFlatSkill('no-name.md', '---\ndescription: 描述。Use when 需要时。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：软链技能 name 与文件名 stem 不一致', () => {
    writeSymlinkFlatSkill('real-name.md', '---\nname: other-name\ndescription: 描述。Use when 需要时。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：软链目录形态 name 与目录名不一致同样被拦', () => {
    writeSymlinkSkillDir('real-dir-name', GOOD.replace('good-skill', 'other-name'));
    expect(run()).toBe(false);
  });

  it('红：软链技能 description 为空', () => {
    writeSymlinkFlatSkill('empty-desc.md', '---\nname: empty-desc\ndescription:\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：软链技能 description 无触发语义（Use when/当用户/触发/适用于 全缺）', () => {
    writeSymlinkFlatSkill('no-trigger.md', '---\nname: no-trigger\ndescription: 只是一段自我介绍，没有说明何时该用本技能。\n---\n# 正文\n');
    expect(run()).toBe(false);
  });

  it('红：软链技能损坏 YAML（frontmatter 未闭合）', () => {
    writeSymlinkFlatSkill('broken.md', '---\nname: broken\ndescription: 描述。Use when 需要时。\n# 正文（缺闭合 ---）\n');
    expect(run()).toBe(false);
  });

  it('红：软链技能完全没有 frontmatter', () => {
    writeSymlinkFlatSkill('bare.md', '# 裸标题开头\n正文\n');
    expect(run()).toBe(false);
  });

  it('绿：触发语义四种标记任一即可（当用户）', () => {
    writeSymlinkFlatSkill('cn-trigger.md', '---\nname: cn-trigger\ndescription: 当用户说"跑一下"时使用。\n---\n# 正文\n');
    expect(run()).toBe(true);
  });

  // —— 边界 ——

  it('绿：空目录（0 个 skill，迁移后预期态）通过', () => {
    expect(run()).toBe(true);
  });

  it('绿：skills 目录不存在时跳过（无项目本地 skill）', () => {
    fs.rmSync(path.join(tmp, '.claude/skills'), { recursive: true });
    expect(run()).toBe(true);
  });
});
