"""Qwen-TTS 0.1.1 CustomVoice 适配；仅首次合成导入 SDK / 加载权重。"""

from dataclasses import dataclass
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import struct
import threading
import wave

from .engine import AudioResult, EngineError, EngineInfo

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class QwenConfig:
    model_path: Path
    device: str = "cuda:0"
    dtype: str = "bfloat16"
    cache_dir: Path = ROOT / "models/hf-cache"
    language: str = "Chinese"
    max_new_tokens: int = 1024
    max_text_chars: int = 120

    def __post_init__(self):
        if not re.fullmatch(r"cpu|cuda:[0-9]+", self.device):
            raise ValueError("TTS_QWEN_DEVICE 仅支持 cpu 或 cuda:N")
        if self.dtype not in ("float32", "float16", "bfloat16"):
            raise ValueError("TTS_QWEN_DTYPE 无效")
        if self.device == "cpu" and self.dtype != "float32":
            raise ValueError("CPU 模式需显式使用 float32；性能尚未实测")
        if not 1 <= self.max_new_tokens <= 4096 or not 1 <= self.max_text_chars <= 1000:
            raise ValueError("Qwen token/文本限制超出允许范围")

    @classmethod
    def from_env(cls):
        def path(name, default):
            value = Path(os.environ.get(name, default)).expanduser()
            return (ROOT / value).resolve() if not value.is_absolute() else value.resolve()

        return cls(
            model_path=path("TTS_QWEN_MODEL_PATH", "models/Qwen3-TTS-12Hz-0.6B-CustomVoice"),
            device=os.environ.get("TTS_QWEN_DEVICE", "cuda:0"),
            dtype=os.environ.get("TTS_QWEN_DTYPE", "bfloat16"),
            cache_dir=path("TTS_QWEN_CACHE_DIR", "models/hf-cache"),
            max_new_tokens=int(os.environ.get("TTS_QWEN_MAX_NEW_TOKENS", "1024")),
            max_text_chars=int(os.environ.get("TTS_QWEN_MAX_TEXT_CHARS", "120")),
        )


def _pcm_wav(wavs, sample_rate, voice_id):
    """验证 SDK 输出再转换为单声道 PCM16；不需要额外音频库。"""
    if len(wavs) != 1 or not isinstance(sample_rate, int) or sample_rate <= 0:
        raise EngineError("invalid_audio", "模型输出的采样率或批次数无效。", 500)
    frames = bytearray()
    try:
        for value in wavs[0]:
            value = float(value)
            if not math.isfinite(value):
                raise ValueError("nonfinite")
            frames.extend(struct.pack("<h", round(max(-1.0, min(1.0, value)) * 32767)))
    except (TypeError, ValueError, OverflowError) as exc:
        raise EngineError("invalid_audio", "模型输出不是有限值的单声道音频。", 500) from exc
    if not frames:
        raise EngineError("invalid_audio", "模型返回空音频。", 500)
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(frames)
    return AudioResult(output.getvalue(), sample_rate, voice_id)


class Qwen3Engine:
    def __init__(self, config: QwenConfig):
        self.config = config
        self._model = None
        self._lock = threading.Lock()

    def _local_config(self):
        try:
            config = json.loads((self.config.model_path / "config.json").read_text())
            if config.get("tts_model_type") != "custom_voice" or config.get("tts_model_size") != "0b6":
                return None
            speakers = config.get("talker_config", {}).get("spk_id", {})
            if not isinstance(speakers, dict) or not all(isinstance(key, str) and key for key in speakers):
                return None
            return config
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def _availability(self):
        if not all(importlib.util.find_spec(name) is not None for name in ("torch", "qwen_tts")):
            return "缺少 Qwen SDK / PyTorch；请使用既有 podcast-tts 环境。"
        if self._local_config() is None:
            return "缺少有效的 0.6B CustomVoice 配置；Base 权重不适用。"
        required = ("model.safetensors", "generation_config.json", "preprocessor_config.json", "tokenizer_config.json",
                    "vocab.json", "merges.txt", "speech_tokenizer/config.json", "speech_tokenizer/model.safetensors")
        if not all((self.config.model_path / name).is_file() and (self.config.model_path / name).stat().st_size > 0 for name in required):
            return "CustomVoice 本地模型文件不完整；不会自动下载。"
        if not self.list_voices():
            return "CustomVoice 配置未包含可用音色。"
        return None

    def info(self):
        reason = self._availability()
        return EngineInfo("qwen3-customvoice", reason is None, self._model is not None,
                          ("cpu", "cuda"), self.config.device, availability_reason=reason,
                          max_text_length=self.config.max_text_chars)

    def list_voices(self):
        config = self._local_config()
        if config is None:
            return []
        return sorted(config.get("talker_config", {}).get("spk_id", {}))

    def _load_model(self):
        # SDK 的 processor/tokenizer 路径不完整转发 local_files_only，故额外强制离线。
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["DO_NOT_TRACK"] = "1"
        import torch
        from qwen_tts import Qwen3TTSModel

        if self.config.device.startswith("cuda:"):
            index = int(self.config.device.split(":")[1])
            if not torch.cuda.is_available() or index >= torch.cuda.device_count():
                raise EngineError("unsupported_device", "指定 CUDA 设备不可用；请检查驱动、GPU 访问权限和进程环境。")
        model = Qwen3TTSModel.from_pretrained(
            str(self.config.model_path), device_map=self.config.device,
            dtype=getattr(torch, self.config.dtype), attn_implementation="sdpa",
            local_files_only=True, cache_dir=str(self.config.cache_dir),
        )
        if not set(self.list_voices()).issubset(set(model.get_supported_speakers() or [])):
            raise EngineError("model_load_failed", "实际模型音色与本地配置不一致。")
        return model

    def synthesize(self, text, voice_id, speed=1.0):
        if not text.strip() or len(text) > self.config.max_text_chars:
            raise EngineError("invalid_text", f"Qwen 短文本需为 1–{self.config.max_text_chars} 字符且非空白。", 422)
        if speed != 1.0:
            raise EngineError("unsupported_feature", "Qwen 适配器不支持语速控制。", 422)
        if voice_id not in self.list_voices():
            raise EngineError("unknown_voice", "CustomVoice 不支持指定音色。", 422)
        if not self._lock.acquire(blocking=False):
            raise EngineError("engine_busy", "模型正在处理其他请求，请稍后重试。")
        loading = self._model is None
        try:
            if loading:
                reason = self._availability()
                if reason:
                    raise EngineError("engine_unavailable", reason)
                self._model = self._load_model()
            wavs, sr = self._model.generate_custom_voice(
                text=text, speaker=voice_id, language=self.config.language,
                non_streaming_mode=True, max_new_tokens=self.config.max_new_tokens,
            )
            return _pcm_wav(wavs, sr, voice_id)
        except EngineError:
            raise
        except Exception as exc:
            if isinstance(exc, MemoryError) or type(exc).__name__ == "OutOfMemoryError":
                raise EngineError("out_of_memory", "模型加载或推理内存不足，请减少 GPU 负载。") from exc
            code = "model_load_failed" if loading and self._model is None else "synthesis_failed"
            raise EngineError(code, "模型加载失败。" if code == "model_load_failed" else "模型推理失败。", 503 if code == "model_load_failed" else 500) from exc
        finally:
            self._lock.release()
