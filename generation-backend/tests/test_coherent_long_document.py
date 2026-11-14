from app.integrations.contracts import GeneratedScript
from app.integrations.local_llm import (
    CoherentLongDocumentScriptGenerator,
    LocalLLMScriptGenerator,
    script_generator_for_snapshot,
)


CONFIG = {
    "provider": "local_http",
    "base_url": "http://127.0.0.1:8002",
    "model_id": "test-model",
    "timeout_seconds": 30,
    "max_new_tokens": 1536,
}


class FakeClient:
    def __init__(self):
        self.calls = []

    def generate(self, source_text, system_prompt, roles, **options):
        self.calls.append({"source": source_text, "prompt": system_prompt,
                           "roles": roles, **options})
        if roles[0]["role_key"] == "memory":
            return GeneratedScript(title="内容结构", summary="统一概要",
                sentences=[{"role_key": "memory", "text": "人物甲、概念乙、核心观点和章节关系。"}])
        if "统一润色" in system_prompt:
            return GeneratedScript(title="完整节目", summary="连贯的最终脚本", sentences=[
                {"role_key": role["role_key"], "text": f"{role['name']}的统一台词。"}
                for role in roles
            ])
        return GeneratedScript(title="分节草稿", summary="本节已经讲到核心观点", sentences=[
            {"role_key": roles[0]["role_key"], "text": "承接前文并引出下一节的台词。"},
        ])


def snapshot(source_text):
    return {
        "source_text": source_text,
        "source_chunks": [
            {"sequence": 1, "text": "甲" * 3000},
            {"sequence": 2, "text": "乙" * 3000},
        ],
        "roles": [
            {"role_key": "host", "name": "主持人", "description": "负责串联"},
            {"role_key": "guest", "name": "嘉宾", "description": "负责解释"},
        ],
        "prompt": "直接脚本提示",
        "llm_config": CONFIG,
        "generation_preferences": {
            "target_minutes": 5,
            "target_characters": 1200,
            "style": "克制、准确",
        },
    }


def test_long_document_uses_global_memory_rolling_context_and_final_refinement():
    client = FakeClient()
    progress = []
    generator = CoherentLongDocumentScriptGenerator(CONFIG, lambda stage, value: progress.append((stage, value)), client)

    result = generator.generate(snapshot("甲" * 3000 + "乙" * 3001))

    assert result.title == "完整节目"
    assert {line.role_key for line in result.sentences} == {"host", "guest"}
    assert sum("阶段：分段分析" in call["prompt"] for call in client.calls) == 2
    assert sum("阶段：建立全局大纲" in call["prompt"] for call in client.calls) == 1
    section_calls = [call for call in client.calls if "阶段：分节生成脚本" in call["prompt"]]
    assert len(section_calls) == 2
    assert "全局共享记忆" in section_calls[0]["prompt"]
    assert "尚未生成前文" in section_calls[0]["prompt"]
    assert "本节已经讲到核心观点" in section_calls[1]["prompt"]
    assert "下一节提示" in section_calls[0]["prompt"]
    assert client.calls[-1]["require_all_roles"] is True
    assert {stage for stage, _ in progress} == {
        "analyzing_source", "planning_script", "drafting_sections", "refining_script",
    }


def test_factory_keeps_short_text_on_single_request_path():
    assert isinstance(script_generator_for_snapshot(snapshot("短文")), LocalLLMScriptGenerator)
    assert isinstance(script_generator_for_snapshot(snapshot("长" * 5001)), CoherentLongDocumentScriptGenerator)
