/**
 * 治理检查：项目本地 skill 的 frontmatter 契约（2026-07-16 知识体系审计）
 *
 * 背景：本项目为 AI-native——`.claude/skills/*.md` 不维护人工 README/INDEX 索引，
 * 全靠各文件 frontmatter 的 `description` 自动注入上下文被发现（AGENTS.md「AI-native」
 * 约定 + `.claude/rules/skill-prefix.md`「Frontmatter 必填」）。缺 frontmatter 的 skill
 * 是不可被发现的孤岛（实证：accident-profile-report.md 裸标题开头，任何索引/自动发现
 * 都找不到它）。审计评审明确否决"新建人工索引登记"方案（人工清单必腐），改为本闸：
 * 按文件系统动态扫描，无人工清单，不会腐化。
 *
 * 口径（兑现 `.claude/rules/skill-prefix.md`「Frontmatter 必填」契约，2026-07-16 评审返工收紧）：
 * `.claude/skills/` 下每个 .md 文件必须
 *   1. 以可解析的 `---` frontmatter 块开头（未闭合/缺失 = 损坏，报错）；
 *   2. `name:` 非空且与文件名 stem 一致；
 *   3. `description:` 非空且含触发语义标记之一：Use when / 当用户 / 触发 / 适用于。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式，与 branch-rls-enabled 同构）。
 * 红绿夹具测试：scripts/__tests__/skill-frontmatter.test.mjs。
 */

import fs from 'fs';
import path from 'path';

const SKILLS_REL = '.claude/skills';

export function runSkillFrontmatterCheck({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查项目本地 skill frontmatter（AI-native 自动发现契约）...');

  const skillsDir = path.join(rootDir, SKILLS_REL);
  if (!fs.existsSync(skillsDir)) {
    success(`${SKILLS_REL}/ 不存在，跳过（无项目本地 skill）`);
    return true;
  }

  const files = fs
    .readdirSync(skillsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const TRIGGER_MARKERS = ['Use when', '当用户', '触发', '适用于'];
  const problems = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
    const fm = extractFrontmatter(content);
    if (fm === null) {
      problems.push(`${SKILLS_REL}/${file}: frontmatter 块缺失或未闭合（须以 --- 开头、--- 结束）——无法被自动发现`);
      continue;
    }
    const stem = file.replace(/\.md$/, '');
    const name = matchFrontmatterValue(fm, 'name');
    if (!name) {
      problems.push(`${SKILLS_REL}/${file}: frontmatter 缺非空 name（skill-prefix.md 必填契约）`);
    } else if (name !== stem) {
      problems.push(`${SKILLS_REL}/${file}: name「${name}」与文件名 stem「${stem}」不一致（skill-prefix.md 要求同名）`);
    }
    const desc = matchFrontmatterValue(fm, 'description');
    if (!desc) {
      problems.push(`${SKILLS_REL}/${file}: frontmatter 缺非空 description`);
    } else if (!TRIGGER_MARKERS.some((t) => desc.includes(t))) {
      problems.push(`${SKILLS_REL}/${file}: description 缺触发语义（须含 ${TRIGGER_MARKERS.join(' / ')} 之一，skill-prefix.md 契约）`);
    }
  }

  if (problems.length === 0) {
    success(`项目本地 skill frontmatter 契约通过（${files.length} 个文件）`);
    return true;
  }
  problems.forEach((p) => error(p));
  return false;
}

/** 提取文件开头的 frontmatter 块内容；无则返回 null */
function extractFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  return m ? m[1] : null;
}

/** 取 frontmatter 中某 key 的裸值（单行），空/缺失返回 '' */
function matchFrontmatterValue(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
