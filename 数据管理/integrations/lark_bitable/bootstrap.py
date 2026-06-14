"""一次性初始化：建归档 base + 默认表 + 字段 schema + 写 meta 文件。

幂等：meta 文件已存在则跳过建表，可重复执行用于添加/校对字段。

用法：
    python3 数据管理/integrations/lark_bitable/bootstrap.py
        --base-name "chexian-api · 报告归档" \
        --table-name "diagnose-reports"

之后 state/meta.json 包含：
    {"app_token": "...", "table_id": "...", "url": "...",
     "fields": {"日期": "fldXXX", ...}}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import client
from auth import AuthError

INTEGRATION_DIR = Path(__file__).resolve().parent
META_PATH = INTEGRATION_DIR / "state" / "meta.json"


# 字段 schema：(中文字段名, type 编号, property)
# type 编号（飞书 v1）：
#   1=文本, 2=数字, 3=单选, 5=日期/时间, 15=URL
SCHEMA = [
    ("日期", 5, {"date_formatter": "yyyy-MM-dd", "auto_fill": False}),
    ("报告类型", 3, {"options": [
        {"name": "diagnose-loss-development"},
        {"name": "diagnose-period-trend"},
        {"name": "diagnose-org-weekly"},
        {"name": "diagnose-renewal"},
        {"name": "其他"},
    ]}),
    ("报告名", 1, None),
    ("报告 URL", 15, None),
    ("子页数", 2, {"formatter": "0"}),
    ("生成耗时(秒)", 2, {"formatter": "0"}),
    ("VPS文件大小(KB)", 2, {"formatter": "0"}),
    ("链接状态", 3, {"options": [
        {"name": "✅可访问"},
        {"name": "❌已失效"},
        {"name": "⏳未探测"},
    ]}),
    ("探测时间", 5, {"date_formatter": "yyyy-MM-dd HH:mm", "auto_fill": False}),
    ("备注", 1, None),
]


def load_meta() -> dict:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    return {}


def save_meta(meta: dict) -> None:
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_base(base_name: str) -> dict:
    meta = load_meta()
    if meta.get("app_token"):
        print(f"[skip] base 已存在: {meta['app_token']} ({meta.get('url', 'no url')})")
        return meta
    print(f"[create] 建归档 base: {base_name}")
    resp = client.create_base(base_name)
    app = resp.get("app", {})
    meta = {
        "base_name": base_name,
        "app_token": app["app_token"],
        "url": app.get("url"),
        "folder_token": app.get("folder_token"),
        "default_table_id": app.get("default_table_id"),  # 部分版本含
        "fields": {},
    }
    save_meta(meta)
    return meta


def ensure_table(meta: dict, table_name: str) -> dict:
    if meta.get("table_id"):
        print(f"[skip] table 已存在: {meta['table_id']}")
        return meta
    # 用 base 创建时自带的默认 table
    tables = client.list_tables(meta["app_token"])
    if not tables:
        raise RuntimeError("base 内无 table（异常情况，飞书 v1 应自动创建默认表）")
    default = tables[0]
    if default.get("name") != table_name:
        print(f"[rename] 默认表 '{default.get('name')}' → '{table_name}'")
        client.rename_table(meta["app_token"], default["table_id"], table_name)
    meta["table_id"] = default["table_id"]
    meta["table_name"] = table_name
    save_meta(meta)
    return meta


def ensure_fields(meta: dict) -> dict:
    existing = {f["field_name"]: f for f in client.list_fields(meta["app_token"], meta["table_id"])}
    meta_fields = meta.setdefault("fields", {})
    for name, type_, prop in SCHEMA:
        if name in existing:
            meta_fields[name] = existing[name]["field_id"]
            continue
        print(f"[create-field] {name} (type={type_})")
        resp = client.create_field(meta["app_token"], meta["table_id"], field_name=name, type_=type_, property_=prop)
        field = resp.get("field", {})
        meta_fields[name] = field.get("field_id")
    save_meta(meta)
    return meta


def cleanup_empty_template_rows(meta: dict) -> None:
    """飞书建 base 时默认表自带 10 行空模板，删掉。幂等：只删 fields 为空的行。"""
    rows = client.list_records(meta["app_token"], meta["table_id"])
    empty_ids = [r["record_id"] for r in rows if not r.get("fields")]
    if not empty_ids:
        return
    print(f"[cleanup] 删除 {len(empty_ids)} 条空模板行")
    client.batch_delete_records(meta["app_token"], meta["table_id"], empty_ids)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-name", default="chexian-api · 报告归档")
    parser.add_argument("--table-name", default="diagnose-reports")
    args = parser.parse_args()

    try:
        meta = ensure_base(args.base_name)
        meta = ensure_table(meta, args.table_name)
        meta = ensure_fields(meta)
        cleanup_empty_template_rows(meta)
    except AuthError as exc:
        print(f"[ERROR] 鉴权失败: {exc}")
        raise SystemExit(2)

    print("\n=== Bootstrap 完成 ===")
    print(f"Base URL: {meta.get('url')}")
    print(f"app_token: {meta['app_token']}")
    print(f"table_id: {meta['table_id']}")
    print(f"字段数: {len(meta['fields'])}")
    print(f"meta 文件: {META_PATH}")


if __name__ == "__main__":
    main()
