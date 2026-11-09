from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class GeneratedSentence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role_key: str
    text: str = Field(min_length=1, max_length=1000)


class GeneratedScript(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100)
    summary: str
    sentences: list[GeneratedSentence] = Field(min_length=1)


@dataclass(frozen=True)
class GeneratedAudio:
    content: bytes
    duration_ms: int
    metadata: dict


class ScriptGenerator(Protocol):
    def generate(self, snapshot: dict) -> GeneratedScript: ...


class AudioGenerator(Protocol):
    def generate(self, snapshot: dict) -> GeneratedAudio: ...
