# 每日数据同步

## 步骤

1. 运行 ETL：`node 数据管理/daily.mjs`
2. 维度表更新（如需要）：`python3 数据管理/warehouse/dim/generate_dim_tables.py`
3. 同步到 VPS：`node scripts/sync-vps.mjs`
   （rsync current/ + dim/ + renewal/，自动重启+健康检查）
4. 验证：`curl -s https://chexian.cretvalu.com/health`
