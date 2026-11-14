import pytest

from app.services.source_segmentation import (
    MAX_SOURCE_CHARACTERS,
    normalize_source,
    segment_source,
    spoken_character_count,
)


def test_normalizes_line_endings_and_control_characters():
    assert normalize_source("\ufeff第一段\r\n\r\n第二\x00段\r") == "第一段\n\n第二段"


def test_paragraph_mode_preserves_natural_paragraph_order():
    result = segment_source("第一自然段。\n\n第二自然段！\n\n第三自然段？", mode="paragraph")
    assert [item["text"] for item in result["chunks"]] == [
        "第一自然段。", "第二自然段！", "第三自然段？",
    ]
    assert result["chunk_count"] == 3
    assert all(item["estimated_seconds"] > 0 for item in result["chunks"])


def test_duration_mode_packs_paragraphs_without_reordering():
    text = "\n\n".join(["甲" * 120, "乙" * 120, "丙" * 120])
    result = segment_source(text, mode="duration", target_minutes=1, chars_per_minute=240)
    assert result["chunk_count"] == 2
    assert result["chunks"][0]["text"] == "甲" * 120 + "\n\n" + "乙" * 120
    assert result["chunks"][1]["text"] == "丙" * 120


def test_oversized_paragraph_splits_at_sentences_then_hard_limit():
    sentence = "文" * 2400 + "。"
    result = segment_source(sentence * 3, mode="paragraph")
    assert result["chunk_count"] == 2
    assert all(item["character_count"] <= 5000 for item in result["chunks"])
    assert "".join(item["text"] for item in result["chunks"]) == sentence * 3


def test_markdown_keeps_heading_with_following_block_and_estimates_spoken_text():
    text = "# 标题\n\n这是[链接文字](https://example.com)和**重点**。\n\n## 下一节\n\n- 第一项\n- 第二项"
    result = segment_source(text, source_type="markdown", mode="paragraph")
    assert result["chunk_count"] == 2
    assert result["chunks"][0]["text"].startswith("# 标题\n\n这是")
    assert result["chunks"][1]["text"].startswith("## 下一节")
    assert spoken_character_count("[链接文字](https://example.com)", "markdown") == 4


def test_markdown_fenced_code_with_blank_lines_stays_in_one_block():
    text = "# 示例\n\n```python\nprint('a')\n\nprint('b')\n```"
    result = segment_source(text, source_type="markdown")
    assert result["chunk_count"] == 1
    assert "print('a')\n\nprint('b')" in result["chunks"][0]["text"]


def test_auto_mode_keeps_ordinary_text_intact_even_with_many_paragraphs():
    text = "\n\n".join(["甲" * 1000, "乙" * 1000, "丙" * 1000, "丁" * 900])
    result = segment_source(text)
    assert result["chunk_count"] == 1
    assert result["chunks"][0]["text"] == text
    assert result["chunks"][0]["boundary_type"] == "complete"


def test_auto_mode_only_splits_long_text_at_semantic_boundaries():
    paragraphs = [character * 1800 for character in "甲乙丙丁"]
    text = "\n\n".join(paragraphs)
    result = segment_source(text)
    assert result["chunk_count"] == 4
    assert [item["text"] for item in result["chunks"]] == paragraphs
    assert all(item["boundary_type"] == "semantic" for item in result["chunks"])
    assert all(item["character_count"] <= 3500 for item in result["chunks"])


def test_rejects_empty_invalid_options_and_oversized_source():
    with pytest.raises(ValueError, match="不能为空"):
        segment_source("  \n")
    with pytest.raises(ValueError, match="不能超过"):
        segment_source("文" * (MAX_SOURCE_CHARACTERS + 1))
    with pytest.raises(ValueError, match="分段方式"):
        segment_source("内容", mode="unknown")
    with pytest.raises(ValueError, match="分段数量"):
        segment_source("\n\n".join(["段"] * 2001), mode="paragraph")
