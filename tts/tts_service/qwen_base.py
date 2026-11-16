"""Offline Base cloning; reference audio is a bounded, private PCM WAV."""
from collections import OrderedDict
from dataclasses import replace
import hashlib
import io
import json
import os
from pathlib import Path
import re
import wave

from .engine import EngineError, EngineInfo
from .qwen import Qwen3Engine, QwenConfig, _pcm_wav


class Qwen3BaseEngine(Qwen3Engine):
    def __init__(self, config, reference_dir, lock=None):
        super().__init__(replace(config, backend="standard"))
        self.reference_dir = Path(reference_dir).resolve()
        self._prompts = OrderedDict()
        self._loaded_revision = None
        if lock is not None:
            self._lock = lock

    def _local_config(self):
        try:
            value = json.loads((self.config.model_path / "config.json").read_text())
            return value if value.get("tts_model_type") == "base" and value.get("tts_model_size") in ("0b6", "1b7") else None
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def _availability(self):
        # The CustomVoice implementation checks list_voices; Base has no speakers.
        import importlib.util
        if not all(importlib.util.find_spec(name) is not None for name in ("torch", "qwen_tts")):
            return "缺少 Qwen SDK / PyTorch。"
        if self._local_config() is None:
            return "缺少有效的 Qwen3-TTS Base 本地配置。"
        files = ("model.safetensors", "generation_config.json", "preprocessor_config.json", "tokenizer_config.json",
                 "vocab.json", "merges.txt", "speech_tokenizer/config.json", "speech_tokenizer/model.safetensors")
        if not all((self.config.model_path / name).is_file() and (self.config.model_path / name).stat().st_size for name in files):
            return "Base 本地模型文件不完整；不会自动下载。"
        if self._model is not None and self._loaded_revision != self.revision():
            return "模型文件在加载后发生变化，请重启 TTS 服务。"
        return None

    def revision(self):
        try:
            # Deployment fingerprint: includes actual model file metadata without reading GBs.
            content = (self.config.model_path / "config.json").read_bytes()
            entries = []
            for name in ("model.safetensors", "generation_config.json", "preprocessor_config.json", "tokenizer_config.json",
                         "vocab.json", "merges.txt", "speech_tokenizer/config.json", "speech_tokenizer/model.safetensors"):
                path = self.config.model_path / name
                stat = path.stat() if path.is_file() else None
                entries.append((name, stat.st_size if stat else None, stat.st_mtime_ns if stat else None))
            return hashlib.sha256(content + json.dumps(entries).encode()).hexdigest()
        except OSError:
            return None

    def info(self):
        reason = self._availability()
        return EngineInfo("qwen3-base", reason is None, self._model is not None, ("cpu", "cuda"),
                          self.config.device, supports_cloning=True, availability_reason=reason,
                          max_text_length=self.config.max_text_chars, model_revision=self.revision())

    def list_voices(self):
        return []  # Private voices are owned and listed by the business API.

    def synthesize(self, text, voice_id, speed=1.0):
        raise EngineError("unsupported_feature", "Base 引擎需使用声音克隆接口。", 422)

    def _reference(self, reference_key, reference_sha256):
        if not re.fullmatch(r"[a-f0-9]{64}\.wav", reference_key) or reference_key != reference_sha256 + ".wav":
            raise EngineError("invalid_reference", "参考音频标识无效。", 422)
        path = (self.reference_dir / reference_key).resolve()
        if not path.is_relative_to(self.reference_dir) or not path.is_file():
            raise EngineError("reference_missing", "参考音频不可用。", 422)
        if path.stat().st_size > 3_000_000:
            raise EngineError("invalid_reference", "参考音频超出限制。", 422)
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != reference_sha256:
            raise EngineError("reference_changed", "参考音频校验失败。", 409)
        try:
            with wave.open(io.BytesIO(content), "rb") as audio:
                rate, frames = audio.getframerate(), audio.getnframes()
                pcm = audio.readframes(frames)
                if (rate, audio.getnchannels(), audio.getsampwidth()) != (24000, 1, 2) or not 3 <= frames / rate <= 30 or len(pcm) != frames * 2:
                    raise ValueError()
            import numpy as np
            return np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768, rate
        except (wave.Error, ValueError, EOFError) as exc:
            raise EngineError("invalid_reference", "参考音频必须为 3–30 秒的标准 WAV。", 422) from exc

    def clone(self, text, voice_id, reference_key, reference_sha256, reference_text, language="Chinese", model_revision=None):
        if not text.strip() or len(text) > self.config.max_text_chars or not reference_text.strip() or len(reference_text) > 2000:
            raise EngineError("invalid_text", "目标文本或参考转写超出限制。", 422)
        if model_revision and model_revision != self.revision():
            raise EngineError("model_changed", "模型部署已变化，请重新提交任务。", 409)
        if not self._lock.acquire(blocking=False):
            raise EngineError("engine_busy", "模型正在处理其他请求，请稍后重试。")
        try:
            revision = self.revision()
            if self._model is not None and self._loaded_revision != revision:
                raise EngineError("model_changed", "已加载的模型与磁盘文件不同，请重启 TTS 服务。", 503)
            audio = self._reference(reference_key, reference_sha256)
            if self._model is None:
                reason = self._availability()
                if reason:
                    raise EngineError("engine_unavailable", reason)
                self._model = self._load_model()
                self._loaded_revision = revision
                if revision != self.revision():
                    raise EngineError("model_changed", "模型文件在加载期间发生变化，请重启 TTS 服务。", 503)
            key = (voice_id, reference_sha256, hashlib.sha256(reference_text.encode()).hexdigest(), self.revision())
            prompt = self._prompts.get(key)
            if prompt is None:
                prompt = self._model.create_voice_clone_prompt(ref_audio=audio, ref_text=reference_text, x_vector_only_mode=False)
                self._prompts[key] = prompt
                if len(self._prompts) > 8:
                    self._prompts.popitem(last=False)
            self._prompts.move_to_end(key)
            wavs, rate = self._model.generate_voice_clone(text=text, language=language, voice_clone_prompt=prompt,
                non_streaming_mode=True, max_new_tokens=self.config.max_new_tokens)
            return _pcm_wav(wavs, rate, voice_id)
        except EngineError:
            raise
        except Exception as exc:
            code = "out_of_memory" if isinstance(exc, MemoryError) or type(exc).__name__ == "OutOfMemoryError" else (
                "model_load_failed" if self._model is None else "synthesis_failed")
            raise EngineError(code, "克隆推理失败，请检查模型资源与参考音频。", 503) from exc
        finally:
            self._lock.release()


def base_engine_from_env(lock=None):
    path = Path(os.environ.get("TTS_QWEN_BASE_MODEL_PATH", "models/Qwen3-TTS-12Hz-0.6B-Base")).expanduser()
    from .qwen import ROOT
    path = path.resolve() if path.is_absolute() else (ROOT / path).resolve()
    config = replace(QwenConfig.from_env(), model_path=path)
    reference_dir = os.environ.get("VOICE_REFERENCE_DIR")
    if not reference_dir:
        raise ValueError("启用克隆需显式配置 VOICE_REFERENCE_DIR，与生成后端使用同一目录")
    return Qwen3BaseEngine(config, reference_dir, lock)
