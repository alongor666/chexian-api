"""WeCom Smart Sheet integrations.

包内 _env 模块在 import 时自动从项目根 .env.local 加载环境变量，
确保单独跑 `python3 sync_*.py` 时不会因缺 WECOM_SMARTSHEET_WEBHOOK_* 而失败。
"""
from . import _env as _env  # noqa: F401  — 触发 .env.local 加载
