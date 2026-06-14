"""飞书 OpenAPI bitable 子集薄客户端。

只覆盖本项目用到的 endpoints。文档：
- 多维表格 v1: /open-apis/bitable/v1/...
- 云空间文档 v1: /open-apis/drive/v1/...

错误处理统一抛 BitableError，body 字段保留原始 response 供排查。
"""

from __future__ import annotations

import json
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError
from urllib.parse import urlencode

from auth import api_host, get_tenant_access_token


class BitableError(RuntimeError):
    def __init__(self, code: int, msg: str, raw: dict):
        super().__init__(f"飞书 API 错误 code={code} msg={msg}")
        self.code = code
        self.msg = msg
        self.raw = raw


def _request(method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> dict:
    url = f"{api_host()}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    token = get_tenant_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(url, data=data, method=method, headers=headers)
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            raise BitableError(exc.code, str(exc), {}) from exc
    if payload.get("code") != 0:
        raise BitableError(payload.get("code", -1), payload.get("msg", "unknown"), payload)
    return payload.get("data", {})


# ---------- Base / App ----------

def create_base(name: str, folder_token: str = "") -> dict:
    """创建一个空多维表格。folder_token 为空时建在应用归属空间根目录。

    Returns: {"app": {"app_token": ..., "name": ..., "folder_token": ..., "url": ...}}
    """
    body: dict[str, Any] = {"name": name}
    if folder_token:
        body["folder_token"] = folder_token
    return _request("POST", "/open-apis/bitable/v1/apps", body=body)


def get_base(app_token: str) -> dict:
    return _request("GET", f"/open-apis/bitable/v1/apps/{app_token}")


# ---------- Table ----------

def list_tables(app_token: str) -> list[dict]:
    data = _request("GET", f"/open-apis/bitable/v1/apps/{app_token}/tables", params={"page_size": 100})
    return data.get("items", [])


def get_default_table_id(app_token: str) -> str:
    tables = list_tables(app_token)
    if not tables:
        raise BitableError(-1, "base 内无任何 table", {})
    return tables[0]["table_id"]


def rename_table(app_token: str, table_id: str, new_name: str) -> dict:
    return _request(
        "PATCH",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}",
        body={"name": new_name},
    )


# ---------- Field ----------

def list_fields(app_token: str, table_id: str) -> list[dict]:
    data = _request(
        "GET",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
        params={"page_size": 100},
    )
    return data.get("items", [])


def create_field(app_token: str, table_id: str, *, field_name: str, type_: int, property_: dict | None = None) -> dict:
    """创建字段。type 编号见飞书文档：
    1=文本, 2=数字, 3=单选, 4=多选, 5=日期, 11=人员, 13=电话, 15=URL, 17=附件...
    """
    body: dict[str, Any] = {"field_name": field_name, "type": type_}
    if property_:
        body["property"] = property_
    return _request("POST", f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields", body=body)


def update_field(app_token: str, table_id: str, field_id: str, **kwargs) -> dict:
    body = {k: v for k, v in kwargs.items() if v is not None}
    return _request(
        "PUT",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields/{field_id}",
        body=body,
    )


# ---------- Record ----------

def create_record(app_token: str, table_id: str, fields: dict) -> dict:
    return _request(
        "POST",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records",
        body={"fields": fields},
    )


def update_record(app_token: str, table_id: str, record_id: str, fields: dict) -> dict:
    return _request(
        "PUT",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}",
        body={"fields": fields},
    )


def delete_record(app_token: str, table_id: str, record_id: str) -> dict:
    return _request(
        "DELETE",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}",
    )


def batch_delete_records(app_token: str, table_id: str, record_ids: list[str]) -> dict:
    return _request(
        "POST",
        f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_delete",
        body={"records": record_ids},
    )


def list_records(app_token: str, table_id: str, page_size: int = 500) -> list[dict]:
    """全表扫（无 filter，归档表条数小，Python 端再过滤幂等）。"""
    items: list[dict] = []
    page_token = None
    while True:
        params: dict[str, Any] = {"page_size": page_size}
        if page_token:
            params["page_token"] = page_token
        data = _request(
            "GET",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records",
            params=params,
        )
        items.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
        if not page_token:
            break
    return items


# 保留旧名做向后兼容（早期 push_report 仍引用此名）
def search_records(app_token: str, table_id: str, filter_: dict | None = None, page_size: int = 500) -> list[dict]:
    return list_records(app_token, table_id, page_size=page_size)


# ---------- 自检入口 ----------

if __name__ == "__main__":
    # 简易自检：建一张测试 base 并立刻删除（删除需 drive 接口，这里不做，留 app_token）
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        result = create_base("chexian-api · bitable selftest")
        app = result.get("app", {})
        print(json.dumps(app, ensure_ascii=False, indent=2))
        print("⚠️ 这是一张测试表，可手工删除")
    else:
        print("usage: python3 client.py selftest")
