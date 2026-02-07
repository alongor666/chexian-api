#!/usr/bin/env python3
"""
Session 对话提取脚本
从 Claude Code 历史 session 中提取用户原文和 AI 回复概要
"""

import json
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# 配置
SESSION_DIR = Path.home() / ".claude/projects/-Users-xuechenglong-Downloads-01----Git---chexianYJFX"
OUTPUT_FILE = Path(__file__).parent.parent / "开发文档/沟通记录汇总表.md"
TRACKING_FILE = Path(__file__).parent.parent / ".claude/session-tracking.json"

def extract_session_conversations(session_file: Path) -> list:
    """提取单个 session 的所有对话"""
    conversations = []

    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    d = json.loads(line.strip())
                    msg_type = d.get('type', '')

                    if msg_type == 'user':
                        content = d.get('message', {}).get('content', '')
                        timestamp = d.get('timestamp', '')[:19]

                        # 跳过 command 消息
                        if isinstance(content, str):
                            if content.startswith('<command') or content.startswith('<local-command'):
                                continue
                            content = content.strip('"').strip()
                            if content and len(content) > 5:
                                conversations.append({
                                    'type': 'user',
                                    'timestamp': timestamp,
                                    'content': content
                                })

                    elif msg_type == 'assistant':
                        msg_content = d.get('message', {}).get('content', [])
                        timestamp = d.get('timestamp', '')[:19]

                        # 提取文本内容
                        text_parts = []
                        if isinstance(msg_content, list):
                            for item in msg_content:
                                if isinstance(item, dict) and item.get('type') == 'text':
                                    text_parts.append(item.get('text', ''))
                        elif isinstance(msg_content, str):
                            text_parts.append(msg_content)

                        if text_parts:
                            full_text = '\n'.join(text_parts)
                            if len(full_text) > 50:  # 过滤太短的回复
                                conversations.append({
                                    'type': 'assistant',
                                    'timestamp': timestamp,
                                    'content': full_text
                                })
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Error reading {session_file}: {e}")

    return conversations


def classify_topic(content: str) -> str:
    """根据内容自动分类"""
    content_lower = content.lower()

    keywords = {
        '#功能开发': ['实现', '开发', '新增', '功能', '添加', '创建', '增加'],
        '#BUG修复': ['修复', 'fix', 'bug', '错误', '问题', '失败', 'error'],
        '#性能优化': ['优化', '性能', '提升', '加速', '效率'],
        '#数据分析': ['分析', '查询', 'sql', '数据', '统计', '计算'],
        '#代码审查': ['审查', 'review', '检查', '审视'],
        '#配置调整': ['配置', '设置', 'config', '调整'],
        '#Git工作流': ['commit', 'push', 'pr', '分支', 'branch', 'pull', 'merge'],
        '#类型检查': ['类型', 'typecheck', 'tsc', 'typescript'],
        '#架构设计': ['架构', '设计', '重构', '结构'],
    }

    for tag, words in keywords.items():
        for word in words:
            if word in content_lower:
                return tag

    return '#其他'


def generate_summary(ai_content: str, max_length: int = 500) -> str:
    """生成 AI 回复概要"""
    # 取前几段作为概要
    paragraphs = ai_content.split('\n\n')
    summary_parts = []
    current_length = 0

    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if current_length + len(p) > max_length:
            break
        summary_parts.append(p)
        current_length += len(p)

    return '\n'.join(summary_parts) if summary_parts else ai_content[:max_length]


def process_all_sessions():
    """处理所有 session 文件"""
    if not SESSION_DIR.exists():
        print(f"Session 目录不存在: {SESSION_DIR}")
        return

    all_records = []

    # 遍历所有 session 文件
    session_files = sorted(SESSION_DIR.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True)

    print(f"发现 {len(session_files)} 个 session 文件")

    for session_file in session_files:
        if session_file.stat().st_size < 500:
            continue

        session_id = session_file.stem
        mod_time = datetime.fromtimestamp(session_file.stat().st_mtime)

        conversations = extract_session_conversations(session_file)

        if not conversations:
            continue

        # 配对用户消息和 AI 回复
        user_messages = [c for c in conversations if c['type'] == 'user']

        if not user_messages:
            continue

        # 创建记录
        record = {
            'session_id': session_id[:8],
            'date': mod_time.strftime('%Y-%m-%d'),
            'time': mod_time.strftime('%H:%M'),
            'user_messages': user_messages,
            'topic': classify_topic(user_messages[0]['content'])
        }

        all_records.append(record)

    return all_records


def generate_markdown(records: list) -> str:
    """生成 Markdown 格式的汇总表"""
    # 按日期分组
    by_date = defaultdict(list)
    for r in records:
        by_date[r['date']].append(r)

    # 统计分类
    topic_counts = defaultdict(int)
    for r in records:
        topic_counts[r['topic']] += 1

    # 生成 Markdown
    lines = [
        "# 沟通记录汇总表",
        "",
        f"> 最后更新: {datetime.now().strftime('%Y-%m-%d %H:%M')} | 记录总数: {len(records)} 条",
        "",
        "## 📊 统计概览",
        "",
        "| 分类 | 记录数 |",
        "|------|--------|",
    ]

    for topic, count in sorted(topic_counts.items(), key=lambda x: -x[1]):
        lines.append(f"| {topic} | {count} |")

    lines.append("")
    lines.append("---")
    lines.append("")

    # 按日期输出记录
    for date in sorted(by_date.keys(), reverse=True):
        lines.append(f"## {date}")
        lines.append("")

        for record in sorted(by_date[date], key=lambda x: x['time'], reverse=True):
            lines.append(f"### [{record['time']}] {record['topic']} `session:{record['session_id']}`")
            lines.append("")

            # 输出所有用户消息
            lines.append("**用户原文**:")
            for i, msg in enumerate(record['user_messages'], 1):
                if len(record['user_messages']) > 1:
                    lines.append(f"\n**[{i}]** {msg['timestamp'][11:16]}")
                lines.append(f"> {msg['content']}")
                lines.append("")

            lines.append("---")
            lines.append("")

    return '\n'.join(lines)


if __name__ == '__main__':
    print("开始提取 session 对话...")
    records = process_all_sessions()

    if records:
        print(f"共提取 {len(records)} 条有效记录")

        markdown = generate_markdown(records)

        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            f.write(markdown)

        print(f"已写入: {OUTPUT_FILE}")
    else:
        print("未找到有效记录")
