import pandas as pd
excel_file = "/Users/xuechenglong/Downloads/01-正开发Git项目/chexian-api/数据管理/车险签单报价数据20260221.xlsx"
df = pd.read_excel(excel_file)
col_name = '交叉销售保费-驾意'

print(f"Column '{col_name}' Top 20 raw values (non-null, non-zero):")
valid_vals = df[df[col_name].notna() & (df[col_name] != 0) & (df[col_name] != '0')][col_name]
print(valid_vals.head(20).tolist())

print("\nLargest 10 values when converted to numeric:")
num_vals = pd.to_numeric(valid_vals, errors='coerce').dropna()
print(num_vals.nlargest(10).tolist())
