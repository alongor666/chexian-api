import pandas as pd
import sys

excel_file = "/Users/xuechenglong/Downloads/01-正开发Git项目/chexian-api/数据管理/车险签单报价数据20260221.xlsx"
parquet_file = "/Users/xuechenglong/Downloads/01-正开发Git项目/chexian-api/数据管理/warehouse/fact/policy/车险签单报价数据20260221.parquet"

print("=" * 50)
print("1. 分析 Excel 文件数据")
try:
    df_excel = pd.read_excel(excel_file)
    print(f"Excel 总行数: {len(df_excel)}")
    
    # 查找是否有 交叉销售保费 相关字段
    col_names = [col for col in df_excel.columns if '驾意' in str(col) or '交叉销售' in str(col)]
    print(f"找到相关字段: {col_names}")
    
    for col_name in col_names:
        excel_col = pd.to_numeric(df_excel[col_name], errors='coerce').fillna(0)
        print(f"Excel '{col_name}' 总和: {excel_col.sum():.2f}")
        print(f"Excel '{col_name}' 非零行数: {(excel_col > 0).sum()}")

except Exception as e:
    print(f"读取 Excel 文件失败: {e}")

print("=" * 50)
print("2. 分析 Parquet 文件数据")
try:
    df_parquet = pd.read_parquet(parquet_file)
    print(f"Parquet 总行数: {len(df_parquet)}")
    
    col_names_pq = [col for col in df_parquet.columns if '驾意' in str(col) or '交叉销售' in str(col)]
    print(f"Parquet 找到相关字段: {col_names_pq}")
    
    for col_name_pq in col_names_pq:
        pq_col = pd.to_numeric(df_parquet[col_name_pq], errors='coerce').fillna(0)
        print(f"Parquet '{col_name_pq}' 总和: {pq_col.sum():.2f}")
        print(f"Parquet '{col_name_pq}' 非零行数: {(pq_col > 0).sum()}")
        
except Exception as e:
    print(f"读取 Parquet 文件失败: {e}")

print("=" * 50)
print("3. 按保单号去重影响分析")
try:
    jiayi_col = '交叉销售保费-驾意'
    if jiayi_col in df_excel.columns:
        df_excel_clean = df_excel.copy()
        df_excel_clean[jiayi_col] = pd.to_numeric(df_excel_clean[jiayi_col], errors='coerce').fillna(0)
        
        df_dedup = df_excel_clean.drop_duplicates(subset=['保单号'], keep='first')
        
        print(f"按保单号保留第一条去重后的行数: {len(df_dedup)}")
        print(f"去重后 {jiayi_col} 总和: {df_dedup[jiayi_col].sum():.2f}")
        print(f"通过合并计算(聚合 max)去重后保费:", df_excel_clean.groupby('保单号')[jiayi_col].max().sum())
        print(f"通过合并计算(聚合 sum)去重后保费:", df_excel_clean.groupby('保单号')[jiayi_col].sum().sum())
except Exception as e:
    print(f"去重分析失败: {e}")
