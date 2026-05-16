from __future__ import annotations

from time import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatMessage(BaseModel):
    role: str
    content: Any
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None

    model_config = ConfigDict(extra="allow")


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    max_tokens: int | None = Field(default=None, gt=0)
    user: str | None = Field(default=None, max_length=256)

    model_config = ConfigDict(extra="allow")

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not value.strip() or len(value) > 256:
            raise ValueError("model must be a non-empty string no longer than 256 characters")
        return value

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, value: list[ChatMessage]) -> list[ChatMessage]:
        if not value:
            raise ValueError("messages must contain at least one item")
        return value


class ImageGenerationRequest(BaseModel):
    model: str
    prompt: str = Field(min_length=1, max_length=8000)
    n: int | None = Field(default=1, ge=1, le=10)
    size: str | None = Field(default=None, max_length=32)
    response_format: Literal["url", "b64_json"] | None = None
    user: str | None = Field(default=None, max_length=256)

    model_config = ConfigDict(extra="allow")


class ModelCard(BaseModel):
    id: str
    object: Literal["model"] = "model"
    created: int = Field(default_factory=lambda: int(time()))
    owned_by: str

    model_config = ConfigDict(extra="allow")


class ModelListResponse(BaseModel):
    object: Literal["list"] = "list"
    data: list[ModelCard]
