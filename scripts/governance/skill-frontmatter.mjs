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
 * 口径：`.claude/skills/` 下每个 .md 文件必须
 *   1. 以 `---` frontmatter 块开头；
 *   2. 块内含非空的 `description:`。
 * `name:` 与文件名一致性属编辑期规范（skill-prefix.md），暂不强制。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式，与 branch-rls-enabled 同构）。
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

  const problems = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
    const fm = extractFrontmatter(content);
    if (fm === null) {
      problems.push(`${SKILLS_REL}/${file}: 缺 frontmatter 块（须以 --- 开头）——无 description 的 skill 无法被自动发现`);
      continue;
    }
    const desc = matchFrontmatterValue(fm, 'description');
    if (!desc) {
      problems.push(`${SKILLS_REL}/${file}: frontmatter 缺非空 description`);
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
