#!/usr/bin/env python3
"""
知识提取辅助脚本

功能:
1. 扫描对话记录,识别潜在知识点
2. 提取上下文片段
3. 生成分类知识清单
4. 导出为Markdown格式

使用方式:
  python extract_knowledge.py <conversation_file>

输出:
  knowledge_candidates.md - 候选知识清单
  knowledge_report.txt - 提取报告
"""

import sys
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

class KnowledgeExtractor:
    """知识提取器"""

    # 关键词配置
    KEYWORDS = {
        'business_rules': ['规则', '含义', '表示', '对应', '定义'],
        'corrections': ['不对', '不是', '错误', '重新理解', '应该是'],
        'constraints': ['必须', '不能', '禁止', '要求', '限制', '只能'],
        'decisions': ['决定', '选择', '采用', '方案', '确定'],
        'exceptions': ['除非', '特殊', '例外', '但是', '不过'],
        'priorities': ['优先', '重要', '关键', '核心'],
    }

    def __init__(self, conversation_file):
        self.conversation_file = Path(conversation_file)
        self.conversations = []
        self.candidates = defaultdict(list)

    def load_conversations(self):
        """加载对话记录"""
        if not self.conversation_file.exists():
            print(f"❌ 对话文件不存在: {self.conversation_file}")
            return False

        with open(self.conversation_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 简单分割对话轮次 (按User和Assistant标记)
        self.conversations = re.split(r'\n(?:User|Assistant):', content)
        print(f"✅ 加载对话: {len(self.conversations)} 轮")
        return True

    def scan_keywords(self):
        """扫描关键词"""
        print("\n🔍 扫描关键词...")

        for idx, conv in enumerate(self.conversations):
            for category, keywords in self.KEYWORDS.items():
                for keyword in keywords:
                    if keyword in conv:
                        # 提取上下文 (前后3行)
                        lines = conv.split('\n')
                        for line_idx, line in enumerate(lines):
                            if keyword in line:
                                # 获取上下文窗口
                                start = max(0, line_idx - 2)
                                end = min(len(lines), line_idx + 3)
                                context = '\n'.join(lines[start:end])

                                self.candidates[category].append({
                                    'conversation_index': idx,
                                    'line_index': line_idx,
                                    'keyword': keyword,
                                    'context': context,
                                    'category': category,
                                })

        # 统计结果
        print("\n📊 扫描结果:")
        for category, items in self.candidates.items():
            print(f"  {category}: {len(items)} 条")

        return self.candidates

    def extract_candidates(self):
        """提取候选知识"""
        print("\n📋 生成候选知识清单...")

        markdown = "# 知识提取候选清单\n\n"
        markdown += f"**提取时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        markdown += f"**对话文件**: {self.conversation_file}\n\n"
        markdown += f"**扫描结果**: 共 {sum(len(items) for items in self.candidates.values())} 条候选\n\n"
        markdown += "---\n\n"

        # 按类别输出
        category_names = {
            'business_rules': '业务规则',
            'corrections': '纠正内容',
            'constraints': '约束条件',
            'decisions': '决策内容',
            'exceptions': '例外情况',
            'priorities': '优先级',
        }

        for category, items in self.candidates.items():
            if not items:
                continue

            markdown += f"## {category_names.get(category, category)} ({len(items)}条)\n\n"

            for idx, item in enumerate(items, 1):
                markdown += f"### 候选 {idx}\n\n"
                markdown += f"**关键词**: {item['keyword']}\n\n"
                markdown += f"**位置**: 对话第{item['conversation_index']+1}轮, 第{item['line_index']+1}行\n\n"
                markdown += f"**上下文**:\n\n```\n{item['context']}\n```\n\n"
                markdown += "---\n\n"

        return markdown

    def generate_report(self):
        """生成提取报告"""
        total = sum(len(items) for items in self.candidates.values())

        report = f"""
知识提取报告
{'='*50}

提取时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
对话文件: {self.conversation_file}

扫描统计:
{'-'*50}
"""

        for category, items in self.candidates.items():
            report += f"{category:20s}: {len(items):4d} 条\n"

        report += f"{'-'*50}\n"
        report += f"{'总计':20s}: {total:4d} 条\n"

        report += f"""
{'='*50}

下一步:
1. 审查候选知识清单 (knowledge_candidates.md)
2. 确认/修正/补充/删除
3. 归档到知识库

建议:
- 重点关注: corrections (纠正内容)
- 优先处理: business_rules (业务规则)
- 注意: constraints (约束条件)可能涉及技术细节
"""

        return report

    def run(self):
        """执行提取流程"""
        print("=" * 60)
        print("知识提取辅助工具")
        print("=" * 60)

        # 加载对话
        if not self.load_conversations():
            return 1

        # 扫描关键词
        self.scan_keywords()

        # 生成候选清单
        markdown = self.extract_candidates()
        output_md = Path("knowledge_candidates.md")
        with open(output_md, 'w', encoding='utf-8') as f:
            f.write(markdown)
        print(f"\n✅ 候选清单已生成: {output_md}")

        # 生成报告
        report = self.generate_report()
        output_report = Path("knowledge_report.txt")
        with open(output_report, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"✅ 提取报告已生成: {output_report}")

        print("\n" + "=" * 60)
        print("✅ 知识提取完成!")
        print("=" * 60)

        return 0


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("使用方式: python extract_knowledge.py <conversation_file>")
        print("\n示例:")
        print("  python extract_knowledge.py conversation_20260111.txt")
        sys.exit(1)

    conversation_file = sys.argv[1]
    extractor = KnowledgeExtractor(conversation_file)
    sys.exit(extractor.run())


if __name__ == "__main__":
    main()
