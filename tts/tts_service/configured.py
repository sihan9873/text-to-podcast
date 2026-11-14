"""Uvicorn factory: 通过环境变量显式启用 Qwen，保留默认 Mock 启动方式。"""

import os

from .app import DEFAULT_ALIASES, create_app
from .mock import MockEngine
from .qwen import Qwen3Engine, QwenConfig


def configured_app():
    engines = {"mock": MockEngine()}
    aliases = {key: dict(value) for key, value in DEFAULT_ALIASES.items()}
    enabled = os.environ.get("TTS_ENABLE_QWEN", "0")
    if enabled not in ("0", "1"):
        raise ValueError("TTS_ENABLE_QWEN 必须为 0 或 1")
    if enabled == "1":
        engines["qwen3-customvoice"] = Qwen3Engine(QwenConfig.from_env())
        aliases["qwen3-customvoice"] = {
            "host_a": os.environ.get("TTS_QWEN_HOST_A", "vivian"),
            "host_b": os.environ.get("TTS_QWEN_HOST_B", "uncle_fu"),
        }
    return create_app(engines, aliases)
