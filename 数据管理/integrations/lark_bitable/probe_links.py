"""每日 HEAD 探测归档表所有 URL，回填「链接状态」+「探测时间」。

VPS 上的报告路径走 /api/reports/，受 admin auth 保护：
- 200 = 正常资源（不会发生，需 cookie）
- 401 = 资源存在但未鉴权 → 视为 ✅可访问（说明文件还在）
- 404 = 资源不存在 → 视为 ❌已失效

用法：
    python3 数据管理/integrations/lark_bitable/probe_links.py [--verbose]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from urllib import request as urlrequest

import client
from auth import AuthError

INTEGRATION_DIR = Path(__file__).resolve().parent
META_PATH = INTEGRATION_DIR / "state" / "meta.json"

OK_STATUS = "✅可访问"
DEAD_STATUS = "❌已失效"
UNKNOWN_STATUS = "⏳未探测"


def head_probe(url: str, timeout: int = 10) -> tuple[int, str]:
    """返回 (HTTP status, 状态分类)。401 也算可访问（资源还在）。"""
    req = urlrequest.Request(url, method="HEAD")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            code = resp.status
    except Exception as exc:
        # HTTPError 提供 code，其他异常视为不可达
        code = getattr(exc, "code", -1)
    if code == 200 or code == 401:
        return code, OK_STATUS
    if code == 404:
        return code, DEAD_STATUS
    return code, UNKNOWN_STATUS  # 5xx / 网络错误 — 保留 ⏳ 等下次重试


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not META_PATH.exists():
        print(f"[ERROR] 缺 {META_PATH}，请先 bootstrap.py")
        raise SystemExit(2)
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))

    rows = client.search_records(meta["app_token"], meta["table_id"], page_size=200)
    print(f"探测 {len(rows)} 条记录...")
    ok = dead = unchanged = 0
    now_ms = int(dt.datetime.now(tz=dt.timezone(dt.timedelta(hours=8))).timestamp() * 1000)

    for row in rows:
        fields = row.get("fields", {})
        url_field = fields.get("报告 URL", {})
        url = url_field.get("link") if isinstance(url_field, dict) else None
        if not url:
            continue
        code, status = head_probe(url)
        prev_status = fields.get("链接状态")
        if args.verbose:
            print(f"  · {url} → HTTP {code} → {status}")
        update_fields = {"链接状态": status, "探测时间": now_ms}
        try:
            client.update_record(meta["app_token"], meta["table_id"],
                                 row["record_id"], update_fields)
        except client.BitableError as exc:
            print(f"    [update 失败] {exc}")
            continue
        if status == OK_STATUS:
            ok += 1
        elif status == DEAD_STATUS:
            dead += 1
        else:
            unchanged += 1

    print(f"\n=== 探测结果 ===")
    print(f"  ✅可访问: {ok}")
    print(f"  ❌已失效: {dead}")
    print(f"  ⏳保留未变: {unchanged}")


if __name__ == "__main__":
    try:
        main()
    except AuthError as exc:
        print(f"[ERROR] 鉴权失败: {exc}")
        raise SystemExit(2)
