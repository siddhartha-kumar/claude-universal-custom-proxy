from __future__ import annotations

import json
from collections.abc import AsyncIterator

import pytest

from llm_proxy_gateway.core.anthropic_translator import (
    anthropic_request_to_openai,
    openai_response_to_anthropic,
    openai_stream_to_anthropic_stream,
)
from llm_proxy_gateway.core.errors import RequestValidationError


def test_request_translates_simple_user_message() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 64,
            "messages": [{"role": "user", "content": "hello"}],
        }
    )
    assert result["model"] == "claude-sonnet"
    assert result["max_tokens"] == 64
    assert result["messages"] == [{"role": "user", "content": "hello"}]


def test_request_prepends_system_message() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 32,
            "system": "Be concise.",
            "messages": [{"role": "user", "content": "hi"}],
        }
    )
    assert result["messages"][0] == {"role": "system", "content": "Be concise."}
    assert result["messages"][1] == {"role": "user", "content": "hi"}


def test_request_handles_system_as_block_array() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 32,
            "system": [
                {"type": "text", "text": "Persona: "},
                {"type": "text", "text": "concise."},
            ],
            "messages": [{"role": "user", "content": "hi"}],
        }
    )
    assert result["messages"][0] == {"role": "system", "content": "Persona: concise."}


def test_request_converts_image_block_to_data_url() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 32,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "describe"},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": "AAA",
                            },
                        },
                    ],
                }
            ],
        }
    )
    parts = result["messages"][0]["content"]
    assert parts[0] == {"type": "text", "text": "describe"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_request_translates_assistant_tool_use_and_user_tool_result() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 32,
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "checking"},
                        {
                            "type": "tool_use",
                            "id": "call_1",
                            "name": "get_weather",
                            "input": {"city": "Paris"},
                        },
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_1",
                            "content": "sunny",
                        }
                    ],
                },
            ],
        }
    )
    assert result["messages"][0] == {"role": "user", "content": "weather?"}
    assistant = result["messages"][1]
    assert assistant["role"] == "assistant"
    assert assistant["content"] == "checking"
    assert assistant["tool_calls"][0]["function"]["name"] == "get_weather"
    assert json.loads(assistant["tool_calls"][0]["function"]["arguments"]) == {"city": "Paris"}
    assert result["messages"][2] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "sunny",
    }


def test_request_translates_stop_sequences_and_tools() -> None:
    result = anthropic_request_to_openai(
        {
            "model": "claude-sonnet",
            "max_tokens": 32,
            "stop_sequences": ["END"],
            "tools": [
                {
                    "name": "lookup",
                    "description": "look something up",
                    "input_schema": {"type": "object"},
                }
            ],
            "tool_choice": {"type": "tool", "name": "lookup"},
            "messages": [{"role": "user", "content": "x"}],
        }
    )
    assert result["stop"] == ["END"]
    assert result["tools"][0]["function"]["name"] == "lookup"
    assert result["tool_choice"]["function"]["name"] == "lookup"


def test_request_rejects_unknown_role() -> None:
    with pytest.raises(RequestValidationError, match="role must be"):
        anthropic_request_to_openai(
            {
                "model": "claude-sonnet",
                "max_tokens": 32,
                "messages": [{"role": "system", "content": "x"}],
            }
        )


def test_request_rejects_missing_model() -> None:
    with pytest.raises(RequestValidationError, match="model is required"):
        anthropic_request_to_openai({"messages": [{"role": "user", "content": "x"}]})


def test_request_rejects_empty_messages() -> None:
    with pytest.raises(RequestValidationError, match="messages must"):
        anthropic_request_to_openai({"model": "x", "messages": []})


def test_response_translates_text_only() -> None:
    upstream = {
        "id": "chatcmpl-abc",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "hi there"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
    }
    result = openai_response_to_anthropic(upstream, requested_model="claude-sonnet")
    assert result["type"] == "message"
    assert result["role"] == "assistant"
    assert result["model"] == "claude-sonnet"
    assert result["content"] == [{"type": "text", "text": "hi there"}]
    assert result["stop_reason"] == "end_turn"
    assert result["usage"] == {"input_tokens": 3, "output_tokens": 5}
    assert result["id"].startswith("msg_")


def test_response_translates_tool_calls() -> None:
    upstream = {
        "id": "chatcmpl-1",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_42",
                            "type": "function",
                            "function": {
                                "name": "lookup",
                                "arguments": '{"q":"hi"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }
    result = openai_response_to_anthropic(upstream, requested_model="claude-sonnet")
    assert result["stop_reason"] == "tool_use"
    assert len(result["content"]) == 1
    block = result["content"][0]
    assert block["type"] == "tool_use"
    assert block["name"] == "lookup"
    assert block["id"] == "call_42"
    assert block["input"] == {"q": "hi"}


def test_response_maps_finish_reasons() -> None:
    for finish, expected in [
        ("stop", "end_turn"),
        ("length", "max_tokens"),
        ("tool_calls", "tool_use"),
        ("function_call", "tool_use"),
        (None, "end_turn"),
    ]:
        result = openai_response_to_anthropic(
            {
                "id": "x",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": finish,
                    }
                ],
            },
            requested_model="m",
        )
        assert result["stop_reason"] == expected


def test_response_rejects_missing_choices() -> None:
    with pytest.raises(RequestValidationError):
        openai_response_to_anthropic({"id": "x"}, requested_model="m")


@pytest.mark.asyncio
async def test_stream_emits_anthropic_event_sequence() -> None:
    async def openai_chunks() -> AsyncIterator[bytes]:
        yield (
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},'
            b'"finish_reason":null}]}\n\n'
        )
        yield (
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"He"},'
            b'"finish_reason":null}]}\n\n'
        )
        yield (
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"llo"},'
            b'"finish_reason":null}]}\n\n'
        )
        yield (
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{},'
            b'"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'
        )
        yield b"data: [DONE]\n\n"

    output = b""
    async for chunk in openai_stream_to_anthropic_stream(
        openai_chunks(), requested_model="claude-sonnet"
    ):
        output += chunk
    text = output.decode("utf-8")
    assert "event: message_start" in text
    assert "event: content_block_start" in text
    assert '"text":"He"' in text
    assert '"text":"llo"' in text
    assert "event: content_block_stop" in text
    assert "event: message_delta" in text
    assert '"stop_reason":"end_turn"' in text
    assert "event: message_stop" in text


@pytest.mark.asyncio
async def test_stream_handles_immediately_closed_upstream() -> None:
    async def empty_chunks() -> AsyncIterator[bytes]:
        if False:
            yield b""

    output = b""
    async for chunk in openai_stream_to_anthropic_stream(
        empty_chunks(), requested_model="claude-sonnet"
    ):
        output += chunk
    text = output.decode("utf-8")
    # Even with no upstream events, we still emit a valid start + delta + stop.
    assert "event: message_start" in text
    assert "event: message_delta" in text
    assert "event: message_stop" in text
