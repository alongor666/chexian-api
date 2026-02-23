import pandas as pd
import sys

excel_file = "/Users/xuechenglong/Downloads/01-正开发Git项目/chexian-api/数据管理/车险签单报价数据20260221.xlsx"

df = pd.read_excel(excel_file)
col_name = '交叉销售保费-驾意'

df[col_name] = pd.to_numeric(df[col_name], errors='coerce').fillna(0)

# Find policies with multiple rows
policy_counts = df['保单号'].value_counts()
dup_policies = policy_counts[policy_counts > 1].index

df_dups = df[df['保单号'].isin(dup_policies)]

# Find a policy where sum != max
grouped = df_dups.groupby('保单号')[col_name].agg(['sum', 'max', 'first', 'last', 'count'])
diff_policies = grouped[grouped['sum'] != grouped['max']]

print("Policies where SUM != MAX (Additive?): ", len(diff_policies))
if len(diff_policies) > 0:
    print(diff_policies.head(5))
    
    sample_policy = diff_policies.index[0]
    print(f"\nSample Policy {sample_policy} details:")
    print(df_dups[df_dups['保单号'] == sample_policy][['保单号', '批单号', col_name]])

print("\n--------------------------\n")
diff_first_max = grouped[grouped['first'] != grouped['max']]
print("Policies where FIRST != MAX (Premium on later endorsement?): ", len(diff_first_max))
if len(diff_first_max) > 0:
    print(diff_first_max.head(5))
    sample_policy_2 = diff_first_max.index[0]
    print(f"\nSample Policy {sample_policy_2} details:")
    print(df_dups[df_dups['保单号'] == sample_policy_2][['保单号', '批单号', col_name]])

