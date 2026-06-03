"""统一加载项目根 .env.local 到 os.environ。

设计动机
--------
`release:daily`（走 node 启动）会自动通过 sync-and-reload.mjs::loadDotEnvLocal 注入
环境变量。但单独跑 `python3 sync_filtered_policies.py` 等脚本时，没有 dotenv 加载，
会因 `RuntimeError: 缺少环境变量 WECOM_SMARTSHEET_WEBHOOK_POSTAL_ALL` 直接失败。

本模块在 wecom_smartsheet 包的 __init__ 中被 import，一次加载，幂等。
"""
from __future__ import annotations

import os
from pathlib import Path


def _project_root() -> Path:
    # 文件位置：数据管理/integrations/wecom_smartsheet/_env.py
    # 项目根：上溯 3 级（wecom_smartsheet → integrations → 数据管理 → root）
    return Path(__file__).resolve().parents[3]


def load_dotenv_local(verbose: bool = False) -> int:
    """读取项目根 .env.local 并填充 os.environ（已存在的键不覆盖）。

    返回新写入的键数量。文件不存在 → 返回 0（静默）。
    """
    env_file = _project_root() / ".env.local"
    if not env_file.exists():
        return 0
    written = 0
    with env_file.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # 剥离首尾的成对引号（与 node dotenv 行为一致）
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if not key or key in os.environ:
                continue
            os.environ[key] = value
            written += 1
            if verbose:
                print(f"[_env] loaded {key} from {env_file}")
    return written


# 包导入时自动加载（幂等：已设置的 env 不会被覆盖）
load_dotenv_local()
