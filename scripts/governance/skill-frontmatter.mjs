/**
 * 治理检查：项目本地 skill 契约（2026-07-16 知识体系审计新建；
 * 2026-07-16 存量迁移收口扩展目录/软链形态；同日 PR #1126 评审返工升级为「实体必红灯」）
 *
 * 背景：本项目为 AI-native——`.claude/skills/` 不维护人工 README/INDEX 索引，
 * 全靠各 skill frontmatter 的 `description` 自动注入上下文被发现（AGENTS.md「AI-native」
 * 约定 + `.claude/rules/skill-prefix.md`「Frontmatter 必填」）。缺 frontmatter 的 skill
 * 是不可被发现的孤岛。审计评审明确否决"新建人工索引登记"方案（人工清单必腐），
 * 改为本闸：按文件系统动态扫描，无人工清单，不会腐化。
 *
 * 2026-07-16 铁律（`.claude/rules/skill-prefix.md` [policy-override] 段）：所有技能
 * 必须建在 alongor666-skills 仓库，项目与 Agent 一律经 sync-skills 软链消费，
 * 项目内禁止实体技能。原 14 个项目内扁平存量技能已迁出（PR #1126），
 * `.claude/skills/` 预期为空。本闸执行政策语义（PR #1126 评审 P1-3 收紧）：
 *   - 目录为空或不存在 → 优雅通过（绿）。
 *   - **实体条目必红灯**：`fs.lstatSync` 区分实体与软链——实体目录、实体 `.md`
 *     文件一律报错（绕铁律往项目里塞实体技能的唯一入口，直接拦）。
 *   - 软链条目 → 解析目标：悬空链报错；目标为 `.md` 文件（扁平形态）或含
 *     `SKILL.md` 的目录（sync-skills 直连标准形态）→ 校验 frontmatter 契约；
 *     目录无 SKILL.md → 跳过（非技能目录）。
 *   - 实体非 `.md` 杂项文件（.gitkeep 等）→ 跳过（技能发现机制不识别，无绕闸面）。
 *
 * frontmatter 契约（兑现 `.claude/rules/skill-prefix.md`「Frontmatter 必填」）：
 *   1. 以可解析的 `---` frontmatter 块开头（未闭合/缺失 = 损坏，报错）；
 *   2. `name:` 非空且与文件名/目录名 stem 一致；
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
  info('检查项目本地 skill 契约（禁实体技能 + AI-native frontmatter）...');

  const skillsDir = path.join(rootDir, SKILLS_REL);
  if (!fs.existsSync(skillsDir)) {
    success(`${SKILLS_REL}/ 不存在，跳过（无项目本地 skill）`);
    return true;
  }

  const entries = fs.readdirSync(skillsDir).sort();
  const TRIGGER_MARKERS = ['Use when', '当用户', '触发', '适用于'];
  const IRON_RULE_HINT =
    '违反 2026-07-16 铁律：技能必须建在 alongor666-skills 仓、经 sync-skills 软链消费' +
    '（见 .claude/rules/skill-prefix.md [policy-override] 段）';
  const problems = [];
  let checked = 0;

  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry);
    const lst = fs.lstatSync(fullPath);

    if (!lst.isSymbolicLink()) {
      // 实体条目：技能形态（目录 / .md 文件）一律红灯
      if (lst.isDirectory()) {
        problems.push(`${SKILLS_REL}/${entry}/: 实体目录——${IRON_RULE_HINT}`);
      } else if (lst.isFile() && entry.endsWith('.md')) {
        problems.push(`${SKILLS_REL}/${entry}: 实体 skill 文件——${IRON_RULE_HINT}`);
      }
      continue;
    }

    // 软链条目：解析目标真实类型
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      problems.push(`${SKILLS_REL}/${entry}: 软链目标不存在（悬空链接）`);
      continue;
    }

    let stem;
    let contentPath;
    if (stat.isFile() && entry.endsWith('.md')) {
      // 软链扁平形态 <name>.md
      stem = entry.replace(/\.md$/, '');
      contentPath = fullPath;
    } else if (stat.isDirectory()) {
      // 软链目录形态 <name>/SKILL.md（sync-skills 直连标准形态）
      const skillMdPath = path.join(fullPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue; // 非技能目录，跳过
      stem = entry;
      contentPath = skillMdPath;
    } else {
      continue;
    }

    checked += 1;
    const label = contentPath === fullPath ? `${SKILLS_REL}/${entry}` : `${SKILLS_REL}/${entry}/SKILL.md`;
    const content = fs.readFileSync(contentPath, 'utf-8');
    const fm = extractFrontmatter(content);
    if (fm === null) {
      problems.push(`${label}: frontmatter 块缺失或未闭合（须以 --- 开头、--- 结束）——无法被自动发现`);
      continue;
    }
    const name = matchFrontmatterValue(fm, 'name');
    if (!name) {
      problems.push(`${label}: frontmatter 缺非空 name（skill-prefix.md 必填契约）`);
    } else if (name !== stem) {
      problems.push(`${label}: name「${name}」与文件名/目录名「${stem}」不一致（skill-prefix.md 要求同名）`);
    }
    const desc = matchFrontmatterValue(fm, 'description');
    if (!desc) {
      problems.push(`${label}: frontmatter 缺非空 description`);
    } else if (!TRIGGER_MARKERS.some((t) => desc.includes(t))) {
      problems.push(`${label}: description 缺触发语义（须含 ${TRIGGER_MARKERS.join(' / ')} 之一，skill-prefix.md 契约）`);
    }
  }

  if (problems.length === 0) {
    success(`项目本地 skill 契约通过（软链技能 ${checked} 个，实体技能 0 个）`);
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
