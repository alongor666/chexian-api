# 飞书多维表格 · 报告归档集成

> 把 chexian-api 生成的 HTML 报告（diagnose-loss-development / diagnose-period-trend / diagnose-org-weekly 等）的元数据 + URL 归档到一张飞书多维表格，便于：
>
> 1. 手机随时翻阅历史报告链接
> 2. 自动 HEAD 探测 URL 是否仍可访问，反向监控 VPS 上报告是否被误删
> 3. 替代企微 `wecom_bot/push_html.py`（其首次新建表受 errcode 851014 文档授权过期阻塞）

## 鉴权方式

复用 `~/.claude-to-im/config.env` 中的自建飞书应用：
- `CTI_FEISHU_APP_ID`
- `CTI_FEISHU_APP_SECRET`
- `CTI_FEISHU_DOMAIN`（feishu.cn / lark.com）

调用 `POST /open-apis/auth/v3/tenant_access_token/internal` 换取 `tenant_access_token`（bot 身份，2h 有效，自动刷新）— 不需要 user OAuth，不需要 device flow。

## 必备 scope（在飞书开发者后台「权限管理」勾选）

```
bitable:app                    # 多维表格完整读写
bitable:app:readonly           # 只读兜底
base:app:create / read         # 建/读 base
base:table:create / read       # 建/读表
base:field:create / read       # 建/读字段
base:record:create / read / update  # 写记录 + HEAD 探活更新状态
```

加完 scope 后必须**创建新版本 + 发布**才生效。

## 文件结构

- `auth.py` — `tenant_access_token` 缓存与刷新
- `client.py` — 飞书 OpenAPI 薄客户端（bitable 子集）
- `bootstrap.py` — 一次性建表：创建归档 base + 添加字段 schema
- `push_report.py` — 单次推送：往归档表追加一行（被 sync-and-reload 调用）
- `backfill_history.py` — 扫描本地 + VPS 现存报告，回填到归档表
- `probe_links.py` — 每日 HEAD 探测所有归档 URL，回填「链接状态」字段
- `state/` — 缓存 token / app_token / table_id / 字段名→field_id 映射
- `logs/` — 推送/探活日志

## 归档表 schema

| 字段 | 类型 | 说明 |
|---|---|---|
| 日期 | 日期 | 报告 cutoff 日期 |
| 报告类型 | 单选 | diagnose-loss-development / diagnose-period-trend / diagnose-org-weekly / 其他 |
| 报告名 | 文本 | 主页 HTML 文件名 |
| 报告 URL | URL | 生产链接 |
| 子页数 | 数字 | 下钻子页数量（如 loss-dev 75） |
| 生成耗时 | 数字 | 秒 |
| VPS 文件大小 | 数字 | KB |
| 链接状态 | 单选 | ✅可访问 / ❌已失效 / ⏳未探测 |
| 探测时间 | 日期 | 最近一次 HEAD 探测时间 |
| 备注 | 文本 | 自由 |
