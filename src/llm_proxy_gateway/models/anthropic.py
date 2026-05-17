"""Pydantic models for the Anthropic Messages API request and response shapes.

These mirror the public Anthropic Messages API so the gateway can accept
requests from Claude Code, Claude Desktop, and any other Anthropic-shape
client. The models accept extra fields so newer Anthropic features pass
through transparently and tolerate older clients that omit optional
fields.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AnthropicTextBlock(BaseModel):
    type: Literal["text"]
    text: str

    model_config = ConfigDict(extra="allow")


class AnthropicImageSource(BaseModel):
    type: Literal["base64", "url"]
    media_type: str | None = None
    data: str | None = None
    url: str | None = None

    model_config = ConfigDict(extra="allow")


class AnthropicImageBlock(BaseModel):
    type: Literal["image"]
    source: AnthropicImageSource

    model_config = ConfigDict(extra="allow")


class AnthropicToolUseBlock(BaseModel):
    type: Literal["tool_use"]
    id: str
    name: str
    input: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="allow")


class AnthropicToolResultBlock(BaseModel):
    type: Literal["tool_result"]
    tool_use_id: str
    content: Any = ""
    is_error: bool | None = None

    model_config = ConfigDict(extra="allow")


class AnthropicMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Any

    model_config = ConfigDict(extra="allow")


class AnthropicTool(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="allow")


class AnthropicMessagesRequest(BaseModel):
    model: str
    messages: list[AnthropicMessage]
    max_tokens: int = Field(default=1024, ge=1)
    system: Any = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0)
    stop_sequences: list[str] | None = None
    stream: bool = False
    tools: list[AnthropicTool] | None = None
    tool_choice: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None

    model_config = ConfigDict(extra="allow")

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not value.strip() or len(value) > 256:
            raise ValueError("model must be a non-empty string no longer than 256 characters")
        return value

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, value: list[AnthropicMessage]) -> list[AnthropicMessage]:
        if not value:
            raise ValueError("messages must contain at least one item")
        return value
