#!/usr/bin/env python3
"""
分析 Parquet 文件的实际字段与类型
用于确保代码与真实数据结构一致
"""

import pyarrow.parquet as pq
import sys
import json
from pathlib import Path

def analyze_parquet_schema(file_path):
    """分析 Parquet 文件的 schema"""
    try:
        # 读取 Parquet 文件
        table = pq.read_table(file_path)
        schema = table.schema

        print(f"=" * 80)
        print(f"Parquet 文件分析报告")
        print(f"=" * 80)
        print(f"文件路径: {file_path}")
        print(f"总行数: {table.num_rows:,}")
        print(f"总列数: {table.num_columns}")
        print(f"=" * 80)

        # 字段详细信息
        print(f"\n字段列表（共 {len(schema)} 个字段）:")
        print(f"-" * 80)

        fields_info = []
        for i, field in enumerate(schema, 1):
            field_name = field.name
            field_type = str(field.type)
            nullable = field.nullable

            # 获取该列的示例值（前5个非空值）
            column_data = table.column(field_name)
            sample_values = []
            for j in range(min(5, len(column_data))):
                val = column_data[j].as_py()
                if val is not None:
                    sample_values.append(val)
                if len(sample_values) >= 3:
                    break

            # 统计非空值数量
            non_null_count = len([v for v in column_data if v.as_py() is not None])
            null_count = table.num_rows - non_null_count

            print(f"{i:2d}. 字段名: {field_name}")
            print(f"    类型: {field_type}")
            print(f"    可空: {nullable}")
            print(f"    非空值: {non_null_count:,} ({non_null_count/table.num_rows*100:.1f}%)")
            print(f"    空值数: {null_count:,} ({null_count/table.num_rows*100:.1f}%)")
            if sample_values:
                print(f"    示例值: {sample_values[:3]}")
            print()

            fields_info.append({
                "field_name": field_name,
                "field_type": field_type,
                "nullable": nullable,
                "non_null_count": non_null_count,
                "null_count": null_count,
                "null_percentage": round(null_count/table.num_rows*100, 2),
                "sample_values": [str(v) for v in sample_values[:3]]
            })

        # 输出 JSON 格式（便于程序解析）
        print(f"=" * 80)
        print("JSON 格式输出（便于程序解析）:")
        print(f"=" * 80)
        output = {
            "file_path": str(file_path),
            "total_rows": table.num_rows,
            "total_columns": table.num_columns,
            "fields": fields_info
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))

        # 保存到文件
        output_file = Path(file_path).parent / "schema-analysis.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\n结果已保存到: {output_file}")

        return output

    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        parquet_file = sys.argv[1]
    else:
        # 默认路径
        parquet_file = "/home/user/2025fupan/签单清洗/车险清单截至20260108.parquet"

    if not Path(parquet_file).exists():
        print(f"错误: 文件不存在: {parquet_file}", file=sys.stderr)
        sys.exit(1)

    analyze_parquet_schema(parquet_file)
