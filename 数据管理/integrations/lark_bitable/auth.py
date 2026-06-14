"""tenant_access_token 鉴权与缓存。

复用 ~/.claude-to-im/config.env 的 CTI_FEISHU_APP_ID/SECRET/DOMAIN。
token 默认有效期 2h，缓存到 state/token.json 并自动刷新。
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from urllib import request as urlrequest

INTEGRATION_DIR = Path(__file__).resolve().parent
STATE_DIR = INTEGRATION_DIR / "state"
TOKEN_CACHE = STATE_DIR / "token.json"
CONFIG_ENV = Path.home() / ".claude-to-im" / "config.env"

DOMAIN_TO_HOST = {
    "feishu.cn": "https://open.feishu.cn",
    "lark.com": "https://open.larksuite.com",
}


class AuthError(RuntimeError):
    pass


def load_app_credentials() -> tuple[str, str, str]:
    if not CONFIG_ENV.exists():
        raise AuthError(
            f"未找到 {CONFIG_ENV} — 请先按 claude-to-im 流程配置自建飞书应用，"
            "或手动写入 CTI_FEISHU_APP_ID/SECRET/DOMAIN 三个字段。"
        )
    app_id = app_secret = domain = None
    for line in CONFIG_ENV.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key == "CTI_FEISHU_APP_ID":
            app_id = value
        elif key == "CTI_FEISHU_APP_SECRET":
            app_secret = value
        elif key == "CTI_FEISHU_DOMAIN":
            domain = value
    if not app_id or not app_secret:
        raise AuthError("CTI_FEISHU_APP_ID / CTI_FEISHU_APP_SECRET 缺失")
    return app_id, app_secret, domain or "feishu.cn"


def _http_post_json(url: str, body: dict, headers: dict | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8")
    req = urlrequest.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    with urlrequest.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _api_host() -> str:
    _, _, domain = load_app_credentials()
    return DOMAIN_TO_HOST.get(domain, DOMAIN_TO_HOST["feishu.cn"])


def _fetch_new_token() -> tuple[str, int]:
    app_id, app_secret, domain = load_app_credentials()
    host = DOMAIN_TO_HOST.get(domain, DOMAIN_TO_HOST["feishu.cn"])
    url = f"{host}/open-apis/auth/v3/tenant_access_token/internal"
    body = {"app_id": app_id, "app_secret": app_secret}
    resp = _http_post_json(url, body)
    if resp.get("code") != 0:
        raise AuthError(f"tenant_access_token 获取失败 code={resp.get('code')} msg={resp.get('msg')}")
    return resp["tenant_access_token"], int(resp.get("expire", 7200))


def get_tenant_access_token(force_refresh: bool = False) -> str:
    """返回有效的 tenant_access_token，缓存 2h，提前 5 分钟刷新。"""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    if not force_refresh and TOKEN_CACHE.exists():
        try:
            cached = json.loads(TOKEN_CACHE.read_text(encoding="utf-8"))
            if cached.get("expires_at", 0) - 300 > now:
                return cached["token"]
        except (json.JSONDecodeError, KeyError):
            pass
    token, ttl = _fetch_new_token()
    TOKEN_CACHE.write_text(
        json.dumps({"token": token, "expires_at": now + ttl}, indent=2),
        encoding="utf-8",
    )
    os.chmod(TOKEN_CACHE, 0o600)
    return token


def api_host() -> str:
    return _api_host()


if __name__ == "__main__":
    token = get_tenant_access_token()
    masked = token[:6] + "..." + token[-4:]
    print(f"tenant_access_token: {masked}")
    print(f"api_host: {api_host()}")
