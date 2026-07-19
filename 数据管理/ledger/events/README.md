# ETL 台账月度分片

新事件由 `scripts/etl-ledger/record.mjs` 自动追加到 `YYYY-MM.jsonl`；每行一个独立 JSON 事件。

- 分片只追加，不修改历史行；Git 合并策略为 `merge=union`。
- 旧事件保留在上级 `etl-ledger.jsonl`，不搬迁、不重复写入。
- 报告与分析工具自动聚合旧文件及本目录全部月度分片。
