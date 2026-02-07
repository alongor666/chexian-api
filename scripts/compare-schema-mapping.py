#!/usr/bin/env python3
"""
对比代码中的字段映射与 Parquet 文件的真实字段
生成差异报告
"""

import json
import sys
from pathlib import Path

def load_actual_schema(schema_file):
    """加载实际 Parquet schema"""
    with open(schema_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return {field['field_name']: field for field in data['fields']}

def parse_mapping_ts(mapping_file):
    """解析 TypeScript mapping 文件，提取字段别名"""
    with open(mapping_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 简单解析：提取 COLUMN_ALIASES 对象
    # 这是一个简化的解析器，针对当前文件格式
    mappings = {}
    in_aliases = False
    current_field = None

    for line in content.split('\n'):
        line = line.strip()

        if 'export const COLUMN_ALIASES' in line:
            in_aliases = True
            continue

        if in_aliases and line == '};':
            break

        if in_aliases:
            # 匹配字段名行，如: policy_no: ['policy_no', 'policyNo', '保单号', ...]
            if ':' in line and '[' in line:
                parts = line.split(':', 1)
                field_name = parts[0].strip()

                # 提取别名列表（简化处理）
                aliases_part = parts[1]
                # 提取所有引号内容
                import re
                aliases = re.findall(r"'([^']+)'", aliases_part)

                if aliases:
                    mappings[field_name] = aliases
            # 处理跨行的情况
            elif "'" in line:
                import re
                aliases = re.findall(r"'([^']+)'", line)
                if current_field and aliases:
                    mappings[current_field].extend(aliases)

    return mappings

def main():
    # 文件路径
    schema_file = Path('/home/user/2025fupan/签单清洗/schema-analysis.json')
    mapping_file = Path('/home/user/2025fupan/src/shared/normalize/mapping.ts')

    print("=" * 80)
    print("字段映射对比报告")
    print("=" * 80)
    print()

    # 加载实际 schema
    actual_fields = load_actual_schema(schema_file)
    print(f"✓ 实际 Parquet 文件字段数: {len(actual_fields)}")

    # 解析 mapping
    code_mappings = parse_mapping_ts(mapping_file)
    print(f"✓ 代码中定义的域字段数: {len(code_mappings)}")
    print()

    # 检查每个域字段是否能在实际数据中找到对应的列
    print("=" * 80)
    print("1. 代码映射验证（检查代码中的映射是否正确）")
    print("=" * 80)
    print()

    all_valid = True
    for domain_field, aliases in code_mappings.items():
        found = False
        matched_alias = None

        for alias in aliases:
            if alias in actual_fields:
                found = True
                matched_alias = alias
                break

        if found:
            field_info = actual_fields[matched_alias]
            print(f"✅ {domain_field}")
            print(f"   映射到: {matched_alias} ({field_info['field_type']})")
            print(f"   非空率: {100 - field_info['null_percentage']:.1f}%")
        else:
            print(f"❌ {domain_field}")
            print(f"   别名列表: {', '.join(aliases)}")
            print(f"   问题: 在实际数据中未找到任何匹配的列")
            all_valid = False
        print()

    # 检查实际数据中有哪些字段未被映射
    print("=" * 80)
    print("2. 未映射字段（实际数据中存在但代码未映射的字段）")
    print("=" * 80)
    print()

    # 收集所有已映射的实际列名
    mapped_columns = set()
    for aliases in code_mappings.values():
        mapped_columns.update(aliases)

    unmapped_fields = []
    for field_name, field_info in actual_fields.items():
        if field_name not in mapped_columns:
            unmapped_fields.append((field_name, field_info))

    if unmapped_fields:
        print(f"发现 {len(unmapped_fields)} 个未映射字段：")
        print()
        for field_name, field_info in unmapped_fields:
            print(f"📋 {field_name}")
            print(f"   类型: {field_info['field_type']}")
            print(f"   非空率: {100 - field_info['null_percentage']:.1f}%")
            if field_info['sample_values']:
                print(f"   示例: {', '.join(field_info['sample_values'][:2])}")
            print()
    else:
        print("✅ 所有实际字段都已映射")
        print()

    # 总结
    print("=" * 80)
    print("总结")
    print("=" * 80)
    print()

    if all_valid:
        print("✅ 所有代码映射都能在实际数据中找到对应的列")
    else:
        print("❌ 部分代码映射在实际数据中找不到对应的列")

    if unmapped_fields:
        print(f"⚠️  发现 {len(unmapped_fields)} 个未映射的实际字段")
        print()
        print("建议操作：")
        print("1. 评估这些未映射字段是否需要在业务逻辑中使用")
        print("2. 如需使用，在 mapping.ts 中添加相应的域字段和别名映射")
        print("3. 如不需要，可以忽略这些字段")
    else:
        print("✅ 所有实际字段都已映射")

    print()

    return 0 if all_valid else 1

if __name__ == "__main__":
    sys.exit(main())
