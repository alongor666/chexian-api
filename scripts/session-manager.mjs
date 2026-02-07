#!/usr/bin/env node
/**
 * Claude Code 会话管理器 v2.0
 *
 * 符合官方 Claude Code CLI 会话格式规范：
 * - JSONL (JSON Lines) 格式
 * - 存储：~/.claude/projects/[project-path]/[sessionId].jsonl
 * - 标题字段：第一行的 summary 字段
 *
 * 功能：
 * - 查找、列出、搜索会话
 * - 重命名、批量重命名会话
 * - 删除、批量删除会话
 * - 导出会话（Markdown/JSON）
 * - 会话统计分析
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 类型定义 ====================

/**
 * @typedef {Object} SessionInfo
 * @property {string} sessionId - 会话 ID (UUID)
 * @property {string} summary - 会话标题（第一行的 summary 字段）
 * @property {string} projectPath - 项目路径
 * @property {string} filePath - 完整文件路径
 * @property {number} messageCount - 消息数量
 * @property {number} fileSize - 文件大小（字节）
 * @property {string} createdAt - 创建时间
 * @property {string} updatedAt - 最后修改时间
 * @property {Array} entries - JSONL 条目数组
 */

/**
 * @typedef {Object} JSONLEntry
 * @property {string} type - 条目类型 (summary, user, assistant, system, etc.)
 * @property {string} uuid - 消息 UUID
 * @property {string} timestamp - ISO 8601 时间戳
 * @property {*} ...otherFields - 其他字段
 */

// ==================== 常量定义 ====================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const EMOJIS = {
  folder: '📁',
  file: '📄',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  search: '🔍',
  calendar: '📅',
  clock: '🕒',
  chat: '💬',
  tag: '🏷️',
  stats: '📊',
  trash: '🗑️',
  edit: '✏️',
  export: '📤',
};

// Claude Code 会话存储根目录
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ==================== 工具函数 ====================

/**
 * 彩色输出
 */
function colorize(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

/**
 * 规范化项目路径（符合 Claude Code 命名规则）
 * 例如：/Users/xxx/project → -Users-xxx-project
 */
function normalizeProjectPath(projectPath) {
  return projectPath
    .replace(/^\//, '-')           // 开头的 / 替换为 -
    .replace(/^\//, '')             // 移除开头的 /
    .replace(/\//g, '-');           // 所有 / 替换为 -
}

/**
 * 反规范化项目路径
 * 例如：-Users-xxx-project → /Users/xxx/project
 */
function denormalizeProjectPath(normalizedPath) {
  return '/' + normalizedPath.replace(/^-/, '').replace(/-/g, '/');
}

/**
 * 读取 JSONL 文件（每行一个 JSON 对象）
 */
function readJSONL(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    }).filter(entry => entry !== null);
  } catch (error) {
    console.error(colorize(`${EMOJIS.error} 读取会话文件失败: ${filePath}`, 'red'));
    console.error(colorize(error.message, 'dim'));
    return null;
  }
}

/**
 * 写入 JSONL 文件
 */
function writeJSONL(filePath, entries) {
  const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 获取所有项目目录
 */
function getAllProjectDirs() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return [];
  }

  const dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  return dirs
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

/**
 * 获取指定项目的所有会话
 */
function getProjectSessions(projectPath) {
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectPath);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = fs.readdirSync(projectDir);
  const sessions = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    if (file.startsWith('agent-')) continue; // 跳过子代理会话

    const filePath = path.join(projectDir, file);
    const stats = fs.statSync(filePath);

    try {
      const entries = readJSONL(filePath);
      if (!entries || entries.length === 0) continue;

      const summaryEntry = entries.find(e => e.type === 'summary');
      const summary = summaryEntry?.summary || '(无标题)';

      // 计算消息数量（user + assistant 消息）
      const messageCount = entries.filter(e =>
        e.type === 'user' || e.type === 'assistant'
      ).length;

      // 获取时间戳
      const firstUserMessage = entries.find(e => e.type === 'user');
      const lastEntry = entries[entries.length - 1];

      sessions.push({
        sessionId: file.replace('.jsonl', ''),
        summary,
        projectPath: denormalizeProjectPath(projectPath),
        filePath,
        messageCount,
        fileSize: stats.size,
        createdAt: firstUserMessage?.timestamp || stats.birthtime.toISOString(),
        updatedAt: lastEntry?.timestamp || stats.mtime.toISOString(),
        entries,
      });
    } catch (error) {
      console.error(colorize(`${EMOJIS.warning} 跳过损坏的会话文件: ${file}`, 'yellow'));
    }
  }

  // 按更新时间倒序排列
  return sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * 获取所有会话
 */
function getAllSessions() {
  const projectDirs = getAllProjectDirs();
  const allSessions = [];

  for (const projectDir of projectDirs) {
    const sessions = getProjectSessions(projectDir);
    allSessions.push(...sessions);
  }

  return allSessions;
}

/**
 * 格式化日期
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 从消息内容中提取文本
 * 支持：字符串、对象数组（Claude Code 格式）
 */
function extractContentText(content, maxLength = 200) {
  if (!content) return '';

  // 如果是字符串，直接截取
  if (typeof content === 'string') {
    return content.substring(0, maxLength);
  }

  // 如果是数组，找到所有 type="text" 的内容
  if (Array.isArray(content)) {
    const textItems = content
      .filter(item => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text);

    const combined = textItems.join(' ');
    return combined.substring(0, maxLength);
  }

  // 如果是对象且有 text 属性
  if (typeof content === 'object' && content.text) {
    return String(content.text).substring(0, maxLength);
  }

  return '';
}

/**
 * 提取项目名称
 */
function extractProjectName(projectPath) {
  const parts = projectPath.split('/');
  return parts[parts.length - 1] || projectPath;
}

// ==================== 主要功能 ====================

/**
 * 定位会话存储目录
 */
function locateSessions() {
  console.log(colorize(`${EMOJIS.search} 正在查找会话存储目录...`, 'cyan'));

  const projectsDir = CLAUDE_PROJECTS_DIR;

  console.log(colorize(`${EMOJIS.folder} 会话存储位置:`, 'bright'));
  console.log(colorize(projectsDir, 'dim'));

  if (!fs.existsSync(projectsDir)) {
    console.log(colorize(`${EMOJIS.warning} 目录不存在`, 'yellow'));
    console.log(colorize('可能从未使用 Claude Code CLI 创建过会话', 'dim'));
    return;
  }

  const projectDirs = getAllProjectDirs();
  const totalSessions = projectDirs.reduce((count, projectDir) => {
    const projectPath = path.join(projectsDir, projectDir);
    const files = fs.readdirSync(projectPath);
    return count + files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-')).length;
  }, 0);

  console.log(colorize(`${EMOJIS.folder} 找到 ${projectDirs.length} 个项目`, 'green'));
  console.log(colorize(`${EMOJIS.file} 找到 ${totalSessions} 个会话文件\n`, 'green'));

  // 列出项目
  if (projectDirs.length > 0) {
    console.log(colorize(`${EMOJIS.folder} 项目列表:`, 'bright'));
    projectDirs.forEach((projectDir, index) => {
      const originalPath = denormalizeProjectPath(projectDir);
      const projectName = extractProjectName(originalPath);
      const projectPath = path.join(projectsDir, projectDir);
      const files = fs.readdirSync(projectPath);
      const sessionCount = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-')).length;

      console.log(`  ${colorize(`[${index + 1}]`, 'cyan')} ${colorize(projectName, 'green')}`);
      console.log(`      ${colorize(originalPath, 'dim')}`);
      console.log(`      ${EMOJIS.chat} ${sessionCount} 个会话\n`);
    });
  }
}

/**
 * 列出所有会话
 */
function listSessions(page = 1, perPage = 20) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在: ${CLAUDE_PROJECTS_DIR}`, 'red'));
    console.error(colorize('请先使用 Claude Code CLI 创建会话', 'yellow'));
    return;
  }

  const sessions = getAllSessions();

  if (sessions.length === 0) {
    console.log(colorize(`${EMOJIS.info} 暂无会话数据`, 'yellow'));
    return;
  }

  console.log(colorize(`${EMOJIS.file} 历史会话列表（共 ${sessions.length} 个）\n`, 'bright'));

  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageSessions = sessions.slice(start, end);

  pageSessions.forEach((session, index) => {
    const displayIndex = start + index + 1;
    const projectName = extractProjectName(session.projectPath);

    console.log(colorize(`[${displayIndex}] ${session.sessionId}`, 'cyan'));
    console.log(`    ${EMOJIS.tag} 标题: ${colorize(session.summary, 'green')}`);
    console.log(`    ${EMOJIS.folder} 项目: ${colorize(projectName, 'yellow')} ${colorize(`(${session.projectPath})`, 'dim')}`);
    console.log(`    ${EMOJIS.calendar} 创建: ${colorize(formatDate(session.createdAt), 'dim')}`);
    console.log(`    ${EMOJIS.clock} 最后修改: ${colorize(formatDate(session.updatedAt), 'dim')}`);
    console.log(`    ${EMOJIS.chat} 消息数: ${colorize(session.messageCount, 'yellow')}`);
    console.log(`    ${EMOJIS.file} 大小: ${colorize(formatFileSize(session.fileSize), 'dim')}`);
    console.log('');
  });

  if (sessions.length > end) {
    console.log(
      colorize(`显示第 ${start + 1}-${end} 个，共 ${sessions.length} 个`, 'dim')
    );
    console.log(colorize(`使用 --page ${page + 1} 查看下一页\n`, 'cyan'));
  }
}

/**
 * 查看会话详情
 */
function showSessionDetail(sessionId) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在`, 'red'));
    return;
  }

  const sessions = getAllSessions();
  const session = sessions.find(s =>
    s.sessionId === sessionId ||
    s.sessionId.includes(sessionId) ||
    sessionId.includes(s.sessionId.substring(0, 8))
  );

  if (!session) {
    console.error(colorize(`${EMOJIS.error} 未找到会话: ${sessionId}`, 'red'));
    console.error(colorize('提示: 可以使用会话 ID 的前 8 位字符', 'yellow'));
    return;
  }

  const projectName = extractProjectName(session.projectPath);

  console.log(colorize(`${EMOJIS.file} 会话详情\n`, 'bright'));
  console.log(colorize(`会话 ID: ${session.sessionId}`, 'cyan'));
  console.log(colorize(`标题: ${session.summary}`, 'green'));
  console.log(colorize(`项目: ${projectName}`, 'yellow'));
  console.log(colorize(`项目路径: ${session.projectPath}`, 'dim'));
  console.log(`${EMOJIS.calendar} 创建时间: ${formatDate(session.createdAt)}`);
  console.log(`${EMOJIS.clock} 最后修改: ${formatDate(session.updatedAt)}`);
  console.log(`${EMOJIS.chat} 消息数量: ${session.messageCount}`);
  console.log(`${EMOJIS.file} 文件大小: ${formatFileSize(session.fileSize)}`);
  console.log('');

  if (session.entries && session.entries.length > 0) {
    console.log(colorize(`${EMOJIS.chat} 对话记录（前 10 条）:\n`, 'bright'));

    const entriesToShow = session.entries.slice(0, 10);

    entriesToShow.forEach((entry, index) => {
      const timestamp = formatDate(entry.timestamp);

      if (entry.type === 'summary') {
        console.log(colorize(`[${index + 1}] 📋 会话摘要`, 'blue'));
        console.log(colorize(`    ${entry.summary}`, 'green'));
      } else if (entry.type === 'user') {
        const content = extractContentText(entry.message?.content, 200);
        console.log(colorize(`[${index + 1}] 👤 用户 - ${timestamp}`, 'cyan'));
        console.log(colorize(`    ${content}${content.length >= 200 ? '...' : ''}`, 'dim'));
      } else if (entry.type === 'assistant') {
        const content = extractContentText(entry.message?.content, 200);
        console.log(colorize(`[${index + 1}] 🤖 助手 - ${timestamp}`, 'cyan'));
        console.log(colorize(`    ${content}${content.length >= 200 ? '...' : ''}`, 'dim'));
      } else if (entry.type === 'system') {
        console.log(colorize(`[${index + 1}] ⚙️ 系统 - ${timestamp}`, 'cyan'));
      }
      console.log('');
    });

    if (session.entries.length > 10) {
      console.log(colorize(`    ... (还有 ${session.entries.length - 10} 条消息)`, 'dim'));
      console.log('');
    }
  }
}

/**
 * 搜索会话
 */
function searchSessions(options) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在`, 'red'));
    return;
  }

  let results = getAllSessions();

  // 关键词搜索
  if (options.keyword) {
    const keyword = options.keyword.toLowerCase();
    results = results.filter((s) => {
      const summaryMatch = s.summary.toLowerCase().includes(keyword);
      const contentMatch = JSON.stringify(s.entries).toLowerCase().includes(keyword);
      return summaryMatch || contentMatch;
    });
  }

  // 项目路径筛选
  if (options.project) {
    const projectLower = options.project.toLowerCase();
    results = results.filter(s =>
      s.projectPath.toLowerCase().includes(projectLower) ||
      extractProjectName(s.projectPath).toLowerCase().includes(projectLower)
    );
  }

  // 日期范围筛选
  if (options.dateFrom) {
    const fromDate = new Date(options.dateFrom);
    results = results.filter(s => new Date(s.createdAt) >= fromDate);
  }

  if (options.dateTo) {
    const toDate = new Date(options.dateTo);
    toDate.setHours(23, 59, 59, 999);
    results = results.filter(s => new Date(s.createdAt) <= toDate);
  }

  // 消息数量筛选
  if (options.minMessages) {
    results = results.filter(s => s.messageCount >= options.minMessages);
  }

  console.log(colorize(`${EMOJIS.search} 搜索结果（共 ${results.length} 个）\n`, 'bright'));

  if (results.length === 0) {
    console.log(colorize(`${EMOJIS.info} 未找到匹配的会话`, 'yellow'));
    return;
  }

  results.forEach((session, index) => {
    const projectName = extractProjectName(session.projectPath);

    console.log(colorize(`[${index + 1}] ${session.sessionId}`, 'cyan'));
    console.log(`    ${EMOJIS.tag} 标题: ${colorize(session.summary, 'green')}`);
    console.log(`    ${EMOJIS.folder} 项目: ${colorize(projectName, 'yellow')}`);
    console.log(`    ${EMOJIS.calendar} 创建: ${colorize(formatDate(session.createdAt), 'dim')}`);
    console.log(`    ${EMOJIS.chat} 消息数: ${colorize(session.messageCount, 'yellow')}`);
    console.log('');
  });
}

/**
 * 重命名会话（修改第一行的 summary 字段）
 */
function renameSession(sessionId, newSummary) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在`, 'red'));
    return;
  }

  const sessions = getAllSessions();
  const session = sessions.find(s =>
    s.sessionId === sessionId ||
    s.sessionId.includes(sessionId) ||
    sessionId.includes(s.sessionId.substring(0, 8))
  );

  if (!session) {
    console.error(colorize(`${EMOJIS.error} 未找到会话: ${sessionId}`, 'red'));
    return;
  }

  try {
    // 备份原文件
    const backupPath = session.filePath + '.backup';
    fs.copyFileSync(session.filePath, backupPath);

    // 读取所有条目
    const entries = readJSONL(session.filePath);

    // 修改第一行的 summary 字段
    const summaryEntry = entries.find(e => e.type === 'summary');
    if (summaryEntry) {
      summaryEntry.summary = newSummary;
    } else {
      // 如果没有 summary 条目，创建一个
      entries.unshift({
        type: 'summary',
        summary: newSummary,
        leafUuid: entries[entries.length - 1]?.uuid || null,
      });
    }

    // 重新写入文件
    writeJSONL(session.filePath, entries);

    console.log(colorize(`${EMOJIS.success} 会话已重命名`, 'green'));
    console.log(colorize(`会话 ID: ${session.sessionId}`, 'dim'));
    console.log(colorize(`旧标题: ${session.summary}`, 'dim'));
    console.log(colorize(`新标题: ${newSummary}`, 'bright'));

    // 删除备份
    fs.unlinkSync(backupPath);
  } catch (error) {
    console.error(colorize(`${EMOJIS.error} 重命名失败`, 'red'));
    console.error(error.message);

    // 恢复备份
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, session.filePath);
      fs.unlinkSync(backupPath);
    }
  }
}

/**
 * 删除会话
 */
function deleteSession(sessionId, confirm = true) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在`, 'red'));
    return;
  }

  const sessions = getAllSessions();
  const session = sessions.find(s =>
    s.sessionId === sessionId ||
    s.sessionId.includes(sessionId) ||
    sessionId.includes(s.sessionId.substring(0, 8))
  );

  if (!session) {
    console.error(colorize(`${EMOJIS.error} 未找到会话: ${sessionId}`, 'red'));
    return;
  }

  if (confirm) {
    const projectName = extractProjectName(session.projectPath);

    console.log(colorize(`${EMOJIS.warning} 即将删除会话:`, 'yellow'));
    console.log(colorize(`会话 ID: ${session.sessionId}`, 'bright'));
    console.log(colorize(`标题: ${session.summary}`, 'bright'));
    console.log(colorize(`项目: ${projectName}`, 'dim'));
    console.log(colorize(`创建时间: ${formatDate(session.createdAt)}`, 'dim'));
    console.log('');
    console.log(colorize('⚠️ 此操作不可恢复！', 'red'));
    console.log('');
    console.log(colorize('请使用 --force 参数跳过确认', 'yellow'));
    return;
  }

  try {
    fs.unlinkSync(session.filePath);
    console.log(colorize(`${EMOJIS.success} 会话已删除`, 'green'));
  } catch (error) {
    console.error(colorize(`${EMOJIS.error} 删除失败`, 'red'));
    console.error(error.message);
  }
}

/**
 * 导出会话
 */
function exportSession(sessionId, format, outputPath) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error(colorize(`${EMOJIS.error} 会话目录不存在`, 'red'));
    return;
  }

  const sessions = getAllSessions();
  const session = sessions.find(s =>
    s.sessionId === sessionId ||
    s.sessionId.includes(sessionId) ||
    sessionId.includes(s.sessionId.substring(0, 8))
  );

  if (!session) {
    console.error(colorize(`${EMOJIS.error} 未找到会话: ${sessionId}`, 'red'));
    return;
  }

  let content = '';

  if (format === 'markdown') {
    const projectName = extractProjectName(session.projectPath);

    content = `# ${session.summary}\n\n`;
    content += `**会话 ID**: ${session.sessionId}\n\n`;
    content += `**项目**: ${projectName}\n\n`;
    content += `**项目路径**: ${session.projectPath}\n\n`;
    content += `**创建时间**: ${formatDate(session.createdAt)}\n\n`;
    content += `**最后修改**: ${formatDate(session.updatedAt)}\n\n`;
    content += `**消息数量**: ${session.messageCount}\n\n`;
    content += `---\n\n`;

    if (session.entries) {
      session.entries.forEach((entry) => {
        const timestamp = formatDate(entry.timestamp);

        if (entry.type === 'summary') {
          content += `## 📋 会话摘要\n\n${entry.summary}\n\n`;
        } else if (entry.type === 'user') {
          const content_text = entry.message?.content || '';
          content += `## 👤 用户 - ${timestamp}\n\n${content_text}\n\n`;
        } else if (entry.type === 'assistant') {
          const textBlocks = entry.message?.content?.filter(c => c.type === 'text') || [];
          const textContent = textBlocks.map(b => b.text).join('\n\n');
          content += `## 🤖 助手 - ${timestamp}\n\n${textContent}\n\n`;

          // 工具调用
          const toolUses = entry.message?.content?.filter(c => c.type === 'tool_use') || [];
          if (toolUses.length > 0) {
            content += `### 🔧 工具调用\n\n`;
            toolUses.forEach(tool => {
              content += `- **${tool.name}**: ${JSON.stringify(tool.input)}\n\n`;
            });
          }
        } else if (entry.type === 'system') {
          content += `## ⚙️ 系统消息 - ${timestamp}\n\n`;
          content += `\`\`\`\n${entry.content}\n\`\`\`\n\n`;
        }
      });
    }
  } else if (format === 'json') {
    content = JSON.stringify(session.entries, null, 2);
  } else if (format === 'jsonl') {
    // 导出原始 JSONL 格式
    content = session.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  }

  try {
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(colorize(`${EMOJIS.success} 会话已导出`, 'green'));
    console.log(colorize(`输出路径: ${outputPath}`, 'dim'));
    console.log(colorize(`文件大小: ${formatFileSize(content.length)}`, 'dim'));
  } catch (error) {
    console.error(colorize(`${EMOJIS.error} 导出失败`, 'red'));
    console.error(error.message);
  }
}

/**
 * 会话统计
 */
function showStats() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log(colorize(`${EMOJIS.info} 暂无会话数据`, 'yellow'));
    return;
  }

  const sessions = getAllSessions();

  if (sessions.length === 0) {
    console.log(colorize(`${EMOJIS.info} 暂无会话数据`, 'yellow'));
    return;
  }

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisWeek = new Date(now);
  thisWeek.setDate(now.getDate() - 7);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const monthlyCount = sessions.filter(s => new Date(s.createdAt) >= thisMonth).length;
  const weeklyCount = sessions.filter(s => new Date(s.createdAt) >= thisWeek).length;
  const dailyCount = sessions.filter(s => new Date(s.createdAt) >= today).length;

  const messageCounts = sessions.map(s => s.messageCount);
  const avgMessages = messageCounts.reduce((a, b) => a + b, 0) / sessions.length;
  const maxMessages = Math.max(...messageCounts);

  const totalSize = sessions.reduce((sum, s) => sum + s.fileSize, 0);

  // 提取项目信息
  const projectCounts = {};
  sessions.forEach(s => {
    const projectName = extractProjectName(s.projectPath);
    projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
  });
  const topProjects = Object.entries(projectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log(colorize(`${EMOJIS.stats} 会话统计信息\n`, 'bright'));
  console.log(colorize(`总会话数: ${sessions.length}`, 'cyan'));
  console.log(colorize(`本月新增: ${monthlyCount}`, 'green'));
  console.log(colorize(`本周新增: ${weeklyCount}`, 'green'));
  console.log(colorize(`今日新增: ${dailyCount}`, 'green'));
  console.log('');
  console.log(colorize(`平均消息数: ${avgMessages.toFixed(1)}`, 'cyan'));
  console.log(colorize(`最活跃会话: ${maxMessages} 条消息`, 'yellow'));
  console.log('');
  console.log(colorize(`最活跃项目:`, 'cyan'));
  topProjects.forEach(([project, count]) => {
    console.log(colorize(`  - ${project}: ${count}个会话`, 'dim'));
  });
  console.log('');
  console.log(colorize(`存储空间占用: ${formatFileSize(totalSize)}`, 'cyan'));
}

// ==================== CLI 界面 ====================

function printHelp() {
  console.log(`
${colorize('Claude Code 会话管理器 v2.0', 'bright')}
${colorize('符合官方 JSONL 格式规范', 'green')}
${colorize('========================', 'dim')}

${colorize('用法:', 'cyan')}
  session-manager [命令] [选项]

${colorize('命令:', 'cyan')}
  --locate              查找会话存储目录
  --list                列出所有会话
  --detail <id>         查看会话详情
  --search <keyword>    搜索会话
  --rename <id>         重命名单个会话
  --delete <id>         删除单个会话
  --export <id>         导出会话
  --stats               显示统计信息
  --help                显示帮助信息

${colorize('选项:', 'cyan')}
  --page <num>          分页页码（默认: 1）
  --format <fmt>        导出格式（markdown/json/jsonl，默认: markdown）
  --output <path>       输出文件路径
  --project <name>      按项目名称筛选
  --date-from <date>    起始日期（YYYY-MM-DD）
  --date-to <date>      结束日期（YYYY-MM-DD）
  --min-messages <num>  最小消息数量
  --force               跳过确认提示

${colorize('示例:', 'cyan')}
  # 查找会话目录
  session-manager --locate

  # 列出所有会话
  session-manager --list

  # 查看会话详情
  session-manager --detail abc123de

  # 搜索会话
  session-manager --search "KPI分析" --date-from "2025-01-01"

  # 重命名会话
  session-manager --rename abc123de --summary "新标题"

  # 导出会话
  session-manager --export abc123de --format jsonl --output "session.jsonl"

  # 查看统计
  session-manager --stats

${colorize('格式说明:', 'cyan')}
  会话文件使用 JSONL (JSON Lines) 格式：
  - 每行一个独立的 JSON 对象
  - 第一行是 summary（标题）
  - 后续行是 user/assistant/system 消息

  重命名会话实际上是修改第一行的 summary 字段。
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const command = args[0];
  const options = {};

  // 解析选项
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  switch (command) {
    case '--locate':
      locateSessions();
      break;

    case '--list':
      listSessions(parseInt(options.page) || 1);
      break;

    case '--detail':
      if (!args[1]) {
        console.error(colorize(`${EMOJIS.error} 错误: 请指定会话 ID`, 'red'));
        console.error(colorize('提示: 可以使用会话 ID 的前 8 位字符', 'yellow'));
        return;
      }
      showSessionDetail(args[1]);
      break;

    case '--search':
      searchSessions({
        keyword: options.search || '',
        project: options.project,
        dateFrom: options['date-from'],
        dateTo: options['date-to'],
        minMessages: options['min-messages'] ? parseInt(options['min-messages']) : 0,
      });
      break;

    case '--rename':
      if (!options.summary) {
        console.error(colorize(`${EMOJIS.error} 错误: 请使用 --summary 指定新标题`, 'red'));
        return;
      }
      renameSession(args[1], options.summary);
      break;

    case '--delete':
      deleteSession(args[1], !options.force);
      break;

    case '--export':
      if (!options.output) {
        console.error(colorize(`${EMOJIS.error} 错误: 请使用 --output 指定输出路径`, 'red'));
        return;
      }
      exportSession(args[1], options.format || 'markdown', options.output);
      break;

    case '--stats':
      showStats();
      break;

    default:
      console.error(colorize(`${EMOJIS.error} 未知命令: ${command}`, 'red'));
      console.log(colorize('使用 --help 查看帮助信息', 'yellow'));
  }
}

main();
