"""Deterministic long-document normalization and segmentation.

The segmenter deliberately avoids model calls: previews and committed chunks must
be reproducible on every developer machine and safe to use as task snapshots.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import re
import unicodedata


MAX_SOURCE_CHARACTERS = 100_000
MAX_CHUNK_CHARACTERS = 5_000
DIRECT_LLM_MAX_CHARACTERS = 5_000
LONG_DOCUMENT_CHUNK_CHARACTERS = 3_500
MAX_SOURCE_CHUNKS = 2_000
DEFAULT_CHARS_PER_MINUTE = 240
DEFAULT_TARGET_MINUTES = 5

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SENTENCE_END = re.compile(r"(?<=[。！？!?；;\.])")
_MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MARKDOWN_HTML = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class ChunkDraft:
    sequence: int
    text: str
    character_count: int
    estimated_seconds: int
    boundary_type: str


def normalize_source(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    return text.strip().removeprefix("\ufeff")


def visible_character_count(text: str) -> int:
    return len(text)


def spoken_character_count(text: str, source_type: str) -> int:
    """Estimate spoken characters while retaining Markdown link labels."""
    value = text
    if source_type == "markdown":
        value = _MARKDOWN_LINK.sub(r"\1", value)
        value = _MARKDOWN_HTML.sub("", value)
        value = re.sub(r"^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+", "", value, flags=re.MULTILINE)
        value = value.replace("```", "").replace("~~~", "")
        value = re.sub(r"[*_~`]", "", value)
    return len(re.sub(r"\s+", "", value))


def _markdown_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    fence: str | None = None
    for line in text.split("\n"):
        marker = re.match(r"^\s*(```|~~~)", line)
        if marker:
            token = marker.group(1)
            fence = None if fence == token else token if fence is None else fence
            current.append(line)
            continue
        if not line.strip() and fence is None:
            if current:
                blocks.append("\n".join(current).strip())
                current = []
            continue
        current.append(line)
    if current:
        blocks.append("\n".join(current).strip())

    # A heading is context for the following block, not a standalone spoken chunk.
    merged: list[str] = []
    pending: list[str] = []
    for block in blocks:
        if re.fullmatch(r"\s{0,3}#{1,6}\s+[^\n]+", block):
            pending.append(block)
            continue
        if pending:
            block = "\n\n".join([*pending, block])
            pending = []
        merged.append(block)
    if pending:
        merged.append("\n\n".join(pending))
    return merged


def natural_blocks(text: str, source_type: str) -> list[str]:
    if source_type == "markdown":
        return _markdown_blocks(text)
    return [part.strip() for part in re.split(r"\n\s*\n+", text) if part.strip()]


def _hard_slice(text: str, limit: int) -> list[str]:
    return [text[index:index + limit].strip() for index in range(0, len(text), limit)
            if text[index:index + limit].strip()]


def split_oversized_block(block: str, source_type: str, limit: int) -> list[str]:
    if spoken_character_count(block, source_type) <= limit and len(block) <= MAX_CHUNK_CHARACTERS:
        return [block]
    sentences = [part.strip() for part in _SENTENCE_END.split(block) if part.strip()]
    if len(sentences) <= 1:
        return _hard_slice(block, min(limit, MAX_CHUNK_CHARACTERS))
    result: list[str] = []
    current = ""
    for sentence in sentences:
        if (len(sentence) > MAX_CHUNK_CHARACTERS
                or spoken_character_count(sentence, source_type) > limit):
            if current:
                result.append(current)
                current = ""
            result.extend(_hard_slice(sentence, min(limit, MAX_CHUNK_CHARACTERS)))
            continue
        candidate = sentence if not current else current + sentence
        if current and (spoken_character_count(candidate, source_type) > limit
                        or len(candidate) > MAX_CHUNK_CHARACTERS):
            result.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        result.append(current)
    return result


def segment_source(text: str, source_type: str = "text", mode: str = "auto",
                   target_minutes: int = DEFAULT_TARGET_MINUTES,
                   chars_per_minute: int = DEFAULT_CHARS_PER_MINUTE) -> dict:
    normalized = normalize_source(text)
    if not normalized:
        raise ValueError("原文不能为空或只包含空白字符")
    if visible_character_count(normalized) > MAX_SOURCE_CHARACTERS:
        raise ValueError(f"原文不能超过 {MAX_SOURCE_CHARACTERS} 个字符")
    if source_type not in {"text", "txt", "markdown"}:
        raise ValueError("原文类型无效")
    if mode not in {"auto", "paragraph", "duration"}:
        raise ValueError("分段方式无效")
    if not 1 <= target_minutes <= 15 or not 120 <= chars_per_minute <= 300:
        raise ValueError("预计时长或朗读速度超出允许范围")

    blocks = natural_blocks(normalized, source_type)
    if not blocks:
        raise ValueError("原文没有可处理的自然段")
    if mode == "auto" and len(normalized) <= DIRECT_LLM_MAX_CHARACTERS:
        pieces = [normalized]
    else:
        split_limit = (LONG_DOCUMENT_CHUNK_CHARACTERS if mode == "auto"
                       else min(MAX_CHUNK_CHARACTERS, target_minutes * chars_per_minute)
                       if mode == "duration" else MAX_CHUNK_CHARACTERS)
        pieces: list[str] = []
        for block in blocks:
            pieces.extend(split_oversized_block(block, source_type, split_limit))

    target = (LONG_DOCUMENT_CHUNK_CHARACTERS if mode == "auto"
              else min(MAX_CHUNK_CHARACTERS, target_minutes * chars_per_minute))

    grouped: list[str] = []
    if mode == "paragraph" or (mode == "auto" and len(normalized) <= DIRECT_LLM_MAX_CHARACTERS):
        grouped = pieces
    else:
        current = ""
        for piece in pieces:
            candidate = piece if not current else current + "\n\n" + piece
            if current and (spoken_character_count(candidate, source_type) > target
                            or len(candidate) > MAX_CHUNK_CHARACTERS):
                grouped.append(current)
                current = piece
            else:
                current = candidate
        if current:
            grouped.append(current)

    if len(grouped) > MAX_SOURCE_CHUNKS:
        raise ValueError(f"分段数量不能超过 {MAX_SOURCE_CHUNKS}，请改用按预计时长分段")

    chunks = []
    total_spoken = 0
    for sequence, chunk in enumerate(grouped, 1):
        spoken = max(1, spoken_character_count(chunk, source_type))
        total_spoken += spoken
        chunks.append(ChunkDraft(
            sequence=sequence,
            text=chunk,
            character_count=visible_character_count(chunk),
            estimated_seconds=max(1, math.ceil(spoken * 60 / chars_per_minute)),
            boundary_type=("complete" if mode == "auto" and len(grouped) == 1
                           else "semantic" if mode == "auto"
                           else "paragraph" if mode == "paragraph" else "duration"),
        ))
    return {
        "source_text": normalized,
        "source_type": source_type,
        "character_count": visible_character_count(normalized),
        "spoken_character_count": total_spoken,
        "estimated_seconds": max(1, math.ceil(total_spoken * 60 / chars_per_minute)),
        "segmentation_mode": mode,
        "target_minutes": target_minutes if mode == "duration" else None,
        "chars_per_minute": chars_per_minute,
        "chunk_count": len(chunks),
        "chunks": [asdict(chunk) for chunk in chunks],
    }
