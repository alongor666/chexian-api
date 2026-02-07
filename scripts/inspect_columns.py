import pandas as pd
import glob

# Find the parquet file
files = glob.glob('签单清洗/车险清单截至20260108.parquet')
if not files:
    print("File not found")
    exit(1)

file_path = files[0]
print(f"Reading {file_path}")

df = pd.read_parquet(file_path)
print("Columns:", df.columns.tolist())
print("Head:", df.head(1).to_dict())
