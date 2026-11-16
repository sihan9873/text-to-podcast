"""Uvicorn factory: 通过环境变量显式启用 Qwen，保留默认 Mock 启动方式。"""

import os
import logging
import threading

from .app import DEFAULT_ALIASES, create_app
from .mock import MockEngine
from .qwen import Qwen3Engine, QwenConfig


def configured_app():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
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
    cloning = os.environ.get("TTS_ENABLE_QWEN_BASE", "0")
    if cloning not in ("0", "1"):
        raise ValueError("TTS_ENABLE_QWEN_BASE 必须为 0 或 1")
    if cloning == "1":
        # Separate processes can still contend for the GPU: deploy one model per GPU.
        if enabled == "1":
            raise ValueError("首版同一 TTS 进程只启用 Base 或 CustomVoice，避免双模型驻留显存")
        from .qwen_base import base_engine_from_env
        engines["qwen3-base"] = base_engine_from_env(threading.Lock())
    return create_app(engines, aliases)
