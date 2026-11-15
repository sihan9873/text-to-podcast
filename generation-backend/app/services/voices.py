"""User-owned reference recordings and immutable cloning snapshots."""
from copy import deepcopy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import wave

from sqlalchemy import func, select

from app.core.common import BusinessError, iso, new_token
from app.db.database import transaction
from app.db.models import Asset, Task, User, VoiceProfile, VoiceVersion
from app.integrations.local_tts import LocalTTSAudioGenerator, audio_config
from app.services.views import accepted

MAX_UPLOAD = 10 * 1024 * 1024


def normalize_reference(content, settings):
    if not content or len(content) > MAX_UPLOAD:
        raise BusinessError("INVALID_REFERENCE", "录音不能为空且不能超过 10 MiB", 422)
    kind = "wav" if content.startswith(b"RIFF") and content[8:12] == b"WAVE" else "mp3"
    if kind == "mp3" and not (content.startswith(b"ID3") or content[0] == 255 and len(content) > 1 and content[1] & 224 == 224):
        raise BusinessError("INVALID_REFERENCE", "仅接受可解码的 WAV/MP3 录音", 422)
    try:
        # Force input format and pipe-only protocols: uploaded playlists cannot fetch URLs.
        result = subprocess.run([settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-nostdin",
            "-protocol_whitelist", "pipe", "-f", kind, "-i", "pipe:0", "-t", "30.1", "-ac", "1", "-ar", "24000",
            "-f", "s16le", "pipe:1"], input=content, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=True)
    except FileNotFoundError as exc:
        raise BusinessError("TTS_ENCODER_UNAVAILABLE", "需先配置 FFmpeg", 503) from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise BusinessError("INVALID_REFERENCE", "录音解码失败或超时", 422) from exc
    pcm = result.stdout
    duration = len(pcm) / 48000
    if not 3 <= duration <= 30 or len(pcm) % 2:
        raise BusinessError("INVALID_REFERENCE", "参考录音需为 3–30 秒", 422)
    import array
    samples = array.array("h", pcm)
    if math.sqrt(sum(x * x for x in samples) / len(samples)) < 32:
        raise BusinessError("INVALID_REFERENCE", "录音接近静音，请重新录制", 422)
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(pcm)
    return output.getvalue(), round(duration * 1000)


def upload_reference(session, user_id, content, settings):
    data, duration = normalize_reference(content, settings)
    digest = hashlib.sha256(data).hexdigest()
    root = settings.voice_reference_dir.resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = digest + ".wav"
    with transaction(session):
        session.scalar(select(User).where(User.id == user_id).with_for_update())
        count = session.scalar(select(func.count()).select_from(Asset).where(Asset.user_id == user_id, Asset.kind == "voice_reference"))
        if count >= 40:
            raise BusinessError("VOICE_QUOTA", "参考录音已达 40 条上限", 429)
        target = root / key
        temporary = root / (new_token() + ".tmp")
        try:
            temporary.write_bytes(data)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        asset = Asset(user_id=user_id, object_key=f"voice/{user_id}/{new_token()}.wav", kind="voice_reference",
            size_bytes=len(data), duration_ms=duration, sha256=digest,
            metadata_json={"reference_key": key, "sample_rate": 24000})
        session.add(asset)
        session.flush()
        return {"asset_id": asset.id, "duration_ms": duration}


def owned_voice(session, user_id, profile_id):
    profile = session.get(VoiceProfile, profile_id)
    if profile is None or profile.user_id != user_id:
        raise BusinessError("RESOURCE_NOT_FOUND", "声音不存在", 404)
    return profile


def voice_view(session, profile):
    version = session.scalar(select(VoiceVersion).where(VoiceVersion.profile_id == profile.id))
    asset = session.get(Asset, version.reference_asset_id)
    return {"voice_profile_id": profile.id, "voice_version_id": version.id, "voice_id": f"clone_{version.id}",
        "name": profile.name, "status": profile.status, "language": version.language,
        "reference_text": version.reference_text, "duration_ms": asset.duration_ms,
        "created_at": iso(profile.created_at), "updated_at": iso(profile.updated_at)}


def create_voice(session, user_id, body):
    with transaction(session):
        session.scalar(select(User).where(User.id == user_id).with_for_update())
        asset = session.get(Asset, body.reference_asset_id)
        if asset is None or asset.user_id != user_id or asset.kind != "voice_reference" or asset.status != "ready":
            raise BusinessError("RESOURCE_NOT_FOUND", "参考录音不存在", 404)
        existing = session.execute(select(VoiceVersion, VoiceProfile).join(VoiceProfile).where(
            VoiceProfile.user_id == user_id, VoiceProfile.name == body.name, VoiceVersion.reference_asset_id == asset.id,
            VoiceVersion.reference_text == body.reference_text, VoiceVersion.language == body.language)).first()
        if existing:
            return voice_view(session, existing[1])
        if session.scalar(select(func.count()).select_from(VoiceProfile).where(VoiceProfile.user_id == user_id)) >= 20:
            raise BusinessError("VOICE_QUOTA", "声音库已达 20 条上限", 429)
        profile = VoiceProfile(user_id=user_id, name=body.name)
        session.add(profile)
        session.flush()
        session.add(VoiceVersion(profile_id=profile.id, reference_asset_id=asset.id,
                                 reference_text=body.reference_text, language=body.language))
        session.flush()
        return voice_view(session, profile)


def clone_reference(session, user_id, voice_id, settings):
    try:
        version_id = int(voice_id.removeprefix("clone_")) if voice_id.startswith("clone_") else 0
    except (ValueError, AttributeError):
        version_id = 0
    version = session.get(VoiceVersion, version_id)
    if version is None or voice_id != f"clone_{version_id}":
        raise BusinessError("INVALID_VOICE", "克隆声音不存在或不可用", 422)
    profile = owned_voice(session, user_id, version.profile_id)
    if profile.status != "enabled":
        raise BusinessError("INVALID_VOICE", "克隆声音已停用", 422)
    asset = session.get(Asset, version.reference_asset_id)
    root = settings.voice_reference_dir.resolve()
    key = asset.metadata_json["reference_key"]
    path = (root / key).resolve()
    if (not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != asset.size_bytes
            or hashlib.sha256(path.read_bytes()).hexdigest() != asset.sha256):
        raise BusinessError("REFERENCE_MISSING", "参考录音丢失或校验失败", 422)
    return {"voice_version_id": version.id, "reference_key": key, "reference_sha256": asset.sha256,
            "reference_text": version.reference_text, "language": version.language}


def prepare_clones(session, user_id, script, settings):
    references = {}
    for role in script["roles"]:
        config = role["voice_config"]
        if config.get("tts_model") == "qwen3-base":
            if settings.audio_provider != "local_http" or settings.tts_engine_id != "qwen3-base":
                raise BusinessError("INVALID_VOICE", "当前部署未启用 Base 克隆引擎", 422)
            references[config["voice_id"]] = clone_reference(session, user_id, config["voice_id"], settings)
    if references:
        if not os.environ.get("TTS_INTERNAL_TOKEN"):
            raise BusinessError("TTS_INVALID_CONFIG", "未配置内部克隆服务凭据", 503)
        client = LocalTTSAudioGenerator({**audio_config(settings), "timeout_seconds": 5})
        engines = client._request("/v1/engines")["engines"]
        engine = next((e for e in engines if e["engine_id"] == "qwen3-base"), {})
        if not engine.get("installed") or not engine.get("supports_cloning") or not engine.get("model_revision"):
            raise BusinessError("TTS_ENGINE_UNAVAILABLE", "Base 模型资源尚未准备好", 503)
        for ref in references.values():
            ref["model_revision"] = engine["model_revision"]
    return references


def submit_preview(session, user_id, profile_id, body, key, settings):
    signature = json.dumps({"voice_profile_id": profile_id, "text": body.text}, sort_keys=True)
    digest = hashlib.sha256(signature.encode()).hexdigest()
    with transaction(session):
        session.scalar(select(User).where(User.id == user_id).with_for_update())
        existing = session.scalar(select(Task).where(Task.user_id == user_id, Task.idempotency_key == key))
        if existing:
            if existing.request_hash != digest:
                raise BusinessError("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求")
            return accepted(existing), 200 if existing.status in ("succeeded", "failed") else 202
        profile = owned_voice(session, user_id, profile_id)
        view = voice_view(session, profile)
        active = session.scalar(select(func.count()).select_from(Task).where(Task.user_id == user_id, Task.status.in_(["queued", "running"])))
        total = session.scalar(select(func.count()).select_from(Task).where(Task.status.in_(["queued", "running"])))
        if active >= 2 or total >= settings.max_pending_tasks:
            raise BusinessError("QUEUE_FULL", "已有生成任务，请稍后试听", 429)
        script = {"roles": [{"role_id": 1, "voice_config": {"tts_provider": "local_http", "tts_model": "qwen3-base", "voice_id": view["voice_id"], "speed": 1.0}}],
                  "sentences": [{"role_id": 1, "sequence": 1, "text": body.text}]}
        refs = prepare_clones(session, user_id, script, settings)
        task = Task(user_id=user_id, task_type="voice_preview", voice_version_id=view["voice_version_id"],
            input_snapshot={"script": deepcopy(script), "clone_references": refs, "audio_config": audio_config(settings)},
            request_hash=digest, idempotency_key=key, total_sentences=1)
        session.add(task)
        session.flush()
        return accepted(task), 202
