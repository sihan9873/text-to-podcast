"""通过独立 TTS 服务生成 WAV，按快照顺序拼接，再返回后端要求的完整 MP3。

只依赖标准库和已存在的生成协议；不导入模型 SDK，不维护数据库/文件发布。
"""

import io
import json
import math
import re
import shutil
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import ProxyHandler, Request, build_opener
import wave

from app.core.common import BusinessError
from app.integrations.contracts import GeneratedAudio

MAX_WAV_BYTES = 20 * 1024 * 1024


def audio_config(settings):
    """只在提交任务时读取部署配置，运行时不混入后来变更的 .env。"""
    return {
        "provider": settings.audio_provider,
        "base_url": settings.tts_base_url,
        "engine_id": settings.tts_engine_id,
        "timeout_seconds": settings.tts_timeout_seconds,
        "chunk_chars": settings.tts_chunk_chars,
        "sample_rate": settings.tts_sample_rate,
        "turn_silence_ms": settings.tts_turn_silence_ms,
        "ffmpeg_binary": settings.ffmpeg_binary,
        "encode_timeout_seconds": settings.audio_encode_timeout_seconds,
        "simulated": settings.audio_provider == "mock" or settings.tts_engine_id == "mock",
    }


def split_text(text, limit):
    """优先在句末/逗号处切分；每个字符仅出现一次，不 strip 或改写原文。"""
    chunks = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break
        boundary = max((text.rfind(mark, 0, limit) + 1 for mark in "。！？!?；;\n，,"), default=0)
        end = boundary or limit
        chunks.append(text[:end])
        text = text[end:]
    if any(not chunk.strip() for chunk in chunks):
        raise BusinessError("TTS_INVALID_SCRIPT", "分块后存在纯空白片段，请整理脚本文本", 422)
    return chunks


class LocalTTSAudioGenerator:
    def __init__(self, config, opener=None):
        self.config = dict(config)
        url = urlsplit(config["base_url"])
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise BusinessError("TTS_INVALID_CONFIG", "本地 TTS 服务地址无效")
        self.opener = opener or build_opener(ProxyHandler({}))
        # 服务是显式配置的本地/LAN 地址；不经过环境中的外部 HTTP 代理。

    def _request(self, path, payload=None, audio=False):
        request = Request(self.config["base_url"].rstrip("/") + path,
                          data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None,
                          headers={"Content-Type": "application/json"} if payload is not None else {})
        try:
            with self.opener.open(request, timeout=self.config["timeout_seconds"]) as response:
                maximum = MAX_WAV_BYTES if audio else 1024 * 1024
                content = response.read(maximum + 1)
                if len(content) > maximum:
                    raise BusinessError("TTS_INVALID_RESPONSE", "TTS 响应超出允许大小")
                if audio:
                    if response.headers.get_content_type() != "audio/wav":
                        raise BusinessError("TTS_INVALID_AUDIO", "TTS 未返回 audio/wav")
                    return content
                return json.loads(content)
        except HTTPError as exc:
            try:
                code = json.loads(exc.read(4096)).get("error", {}).get("code", "http_error")
                if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,64}", code):
                    code = "http_error"
            except (ValueError, AttributeError):
                code = "http_error"
            # 不持久化上游原始错误内容，避免泄露路径、脚本或内部凭据。
            raise BusinessError("TTS_" + code.upper(), f"TTS 服务返回 HTTP {exc.code}，请检查模型状态和输入配置") from exc
        except TimeoutError as exc:
            raise BusinessError("TTS_TIMEOUT", "TTS 调用超时；上游推理可能仍在进行") from exc
        except URLError as exc:
            code = "TTS_TIMEOUT" if isinstance(exc.reason, TimeoutError) else "TTS_UNAVAILABLE"
            raise BusinessError(code, "无法连接本地 TTS 服务或读取响应超时") from exc
        except (ValueError, UnicodeError) as exc:
            raise BusinessError("TTS_INVALID_RESPONSE", "TTS 元数据不是有效 JSON") from exc

    def _ffmpeg(self, arguments, data):
        try:
            result = subprocess.run(
                [self.config["ffmpeg_binary"], "-hide_banner", "-loglevel", "error", "-nostdin", *arguments],
                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=self.config["encode_timeout_seconds"], check=True,
            )
            return result.stdout
        except FileNotFoundError as exc:
            raise BusinessError("TTS_ENCODER_UNAVAILABLE", "缺少 FFmpeg，请由部署者单独准备") from exc
        except subprocess.TimeoutExpired as exc:
            raise BusinessError("TTS_ENCODING_TIMEOUT", "音频转换超时") from exc
        except (subprocess.CalledProcessError, OSError) as exc:
            raise BusinessError("TTS_ENCODING_FAILED", "FFmpeg 音频转换失败，请检查编码器配置") from exc

    def _pcm(self, content):
        try:
            with wave.open(io.BytesIO(content), "rb") as wav:
                count, rate = wav.getnframes(), wav.getframerate()
                channels, width = wav.getnchannels(), wav.getsampwidth()
                frames = wav.readframes(count)
                if count <= 0 or rate <= 0 or len(frames) != count * channels * width:
                    raise ValueError("invalid frames")
        except (wave.Error, EOFError, ValueError) as exc:
            raise BusinessError("TTS_INVALID_AUDIO", "TTS 返回的 WAV 为空、损坏或不完整") from exc
        if (rate, channels, width) == (self.config["sample_rate"], 1, 2):
            return frames
        converted = self._ffmpeg(["-f", "wav", "-i", "pipe:0", "-ac", "1", "-ar", str(self.config["sample_rate"]), "-f", "s16le", "pipe:1"], content)
        if not converted or len(converted) % 2:
            raise BusinessError("TTS_INVALID_AUDIO", "WAV 重采样未产生有效 PCM")
        return converted

    def generate(self, snapshot):
        if not shutil.which(self.config["ffmpeg_binary"]):
            raise BusinessError("TTS_ENCODER_UNAVAILABLE", "缺少 FFmpeg，请由部署者单独准备")
        try:
            engines = self._request("/v1/engines")["engines"]
            engine = next((e for e in engines if e["engine_id"] == self.config["engine_id"]), None)
            if engine is None or not engine["installed"]:
                raise BusinessError("TTS_ENGINE_UNAVAILABLE", "指定 TTS 引擎未注册或模型资源未就绪")
            service_limit = engine.get("max_text_length", 1000)
            if type(service_limit) is not int or not 1 <= service_limit <= 1000:
                raise ValueError("invalid text limit")
            limit = min(self.config["chunk_chars"], service_limit)
            voices = self._request("/v1/voices?" + urlencode({"engine_id": self.config["engine_id"]}))
            available = set(voices["voices"]) | set(voices.get("aliases", {}))
            roles = {role["role_id"]: role for role in snapshot["script"]["roles"]}
            sentences = sorted(snapshot["script"]["sentences"], key=lambda s: s["sequence"])
            if not sentences or len({s["sequence"] for s in sentences}) != len(sentences):
                raise ValueError("empty or duplicate sequence")
            if sum(len(s["text"]) for s in sentences) > 5000:
                raise ValueError("script too long")
            prepared = []
            for sentence in sentences:
                text = sentence["text"]
                if not isinstance(text, str) or not text.strip() or not 1 <= len(text) <= 1000:
                    raise ValueError("invalid text")
                if type(sentence["sequence"]) is not int or sentence["sequence"] < 1:
                    raise ValueError("invalid sequence")
                voice = roles[sentence["role_id"]]["voice_config"]
                if voice.get("tts_provider") != "local_http" or voice.get("tts_model") != self.config["engine_id"]:
                    raise BusinessError("TTS_INVALID_VOICE_CONFIG", "脚本角色未配置为当前本地 TTS 模型；请使用本地角色重新生成并确认脚本", 422)
                voice_id = voice.get("voice_id")
                if voice_id not in available:
                    raise BusinessError("TTS_UNKNOWN_VOICE", "角色音色不在本地 TTS 服务可用列表中", 422)
                speed = sentence.get("speed")
                speed = voice.get("speed", 1.0) if speed is None else speed
                speed = 1.0 if speed is None else speed
                if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or speed <= 0:
                    raise ValueError("invalid speed")
                if speed != 1.0 and not engine["supports_speed"]:
                    raise BusinessError("TTS_UNSUPPORTED_FEATURE", "当前 TTS 引擎不支持指定语速，请使用 1.0", 422)
                if voice.get("style") or voice.get("extra_params") or sentence.get("extra_params"):
                    raise BusinessError("TTS_UNSUPPORTED_FEATURE", "当前 TTS 接入不支持风格或额外生成参数", 422)
                prepared.append((sentence, voice_id, speed, split_text(text, limit)))
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise BusinessError("TTS_INVALID_SCRIPT", "脚本快照或 TTS 元数据结构不符合接口契约", 422) from exc

        pcm = bytearray()
        chunks_generated = 0
        previous_role = None
        for sentence, voice_id, speed, chunks in prepared:
            if previous_role is not None and previous_role != sentence["role_id"]:
                pcm.extend(b"\0\0" * (self.config["sample_rate"] * self.config["turn_silence_ms"] // 1000))
            for text in chunks:
                wav = self._request("/v1/synthesize", {"text": text, "engine_id": self.config["engine_id"],
                                                     "voice_id": voice_id, "speed": speed, "output_type": "wav"}, audio=True)
                pcm.extend(self._pcm(wav))
                chunks_generated += 1
            previous_role = sentence["role_id"]
        rate = self.config["sample_rate"]
        content = self._ffmpeg(["-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
                                "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"], pcm)
        # 解码最终 MP3，确保实际可播放；时长包含编码器 padding，不拿原始 PCM 时长冒充。
        decoded = self._ffmpeg(["-i", "pipe:0", "-ac", "1", "-ar", str(rate), "-f", "s16le", "pipe:1"], content)
        if not content or not decoded or len(decoded) % 2:
            raise BusinessError("TTS_INVALID_AUDIO", "完整 MP3 未通过解码验证")
        duration_ms = round(len(decoded) * 1000 / (rate * 2))
        if duration_ms <= 0:
            raise BusinessError("TTS_INVALID_AUDIO", "完整 MP3 时长无效")
        simulated = self.config["engine_id"] == "mock"
        return GeneratedAudio(content, duration_ms, {
            "provider": "local_http", "engine_id": self.config["engine_id"], "format": "mp3",
            "sample_rate": rate, "channels": 1, "simulated": simulated, "real_speech": not simulated,
            "script_simulated": snapshot.get("script_simulated", True),
            "sentence_count": len(sentences), "chunk_count": chunks_generated,
            "turn_silence_ms": self.config["turn_silence_ms"],
        })


def generator_for_snapshot(snapshot):
    config = snapshot.get("audio_config", {"provider": "mock"})
    if config["provider"] == "local_http":
        return LocalTTSAudioGenerator(config)
    if config["provider"] == "mock":
        from app.integrations.mock import MockAudioGenerator
        return MockAudioGenerator()
    raise BusinessError("TTS_INVALID_CONFIG", "未知音频生成提供方")
