"""Bidirectional translation between Anthropic's Messages API and OpenAI's
Chat Completions API.

The gateway exposes both shapes on top of the same provider adapters. This
module is the single source of truth for the request/response/stream
conversion logic so adapters never need to know which client protocol
called them.
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Mapping
from typing import Any
from uuid import uuid4

from llm_proxy_gateway.core.errors import RequestValidationError

_ANTHROPIC_FINISH_MAP: dict[str | None, str] = {
    "stop": "end_turn",
    "length": "max_tokens",
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "content_filter": "end_turn",
    None: "end_turn",
}


def anthropic_request_to_openai(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Translate an Anthropic Messages API request into an OpenAI Chat
    Completions request the gateway's existing adapters understand.
    """
    if not isinstance(payload, Mapping):
        raise RequestValidationError("request body must be a JSON object")
    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        raise RequestValidationError("model is required")
    messages_in = payload.get("messages")
    if not isinstance(messages_in, list) or not messages_in:
        raise RequestValidationError("messages must be a non-empty array")

    openai_messages: list[dict[str, Any]] = []
    system = payload.get("system")
    if system is not None:
        text = _flatten_text_blocks(system)
        if text:
            openai_messages.append({"role": "system", "content": text})

    for message in messages_in:
        if not isinstance(message, Mapping):
            raise RequestValidationError("each message must be a JSON object")
        role = message.get("role")
        if role not in {"user", "assistant"}:
            raise RequestValidationError("message role must be 'user' or 'assistant'")
        openai_messages.extend(_translate_message(role, message.get("content", "")))

    request: dict[str, Any] = {
        "model": model,
        "messages": openai_messages,
    }
    if (max_tokens := payload.get("max_tokens")) is not None:
        request["max_tokens"] = max_tokens
    if (temperature := payload.get("temperature")) is not None:
        request["temperature"] = temperature
    if (top_p := payload.get("top_p")) is not None:
        request["top_p"] = top_p
    if (stop := payload.get("stop_sequences")) is not None:
        request["stop"] = stop
    if (stream := payload.get("stream")) is not None:
        request["stream"] = bool(stream)
    if (tools := payload.get("tools")) is not None:
        request["tools"] = _translate_tools(tools)
    if (tool_choice := payload.get("tool_choice")) is not None:
        request["tool_choice"] = _translate_tool_choice(tool_choice)
    return request


def openai_response_to_anthropic(
    response: Mapping[str, Any], *, requested_model: str
) -> dict[str, Any]:
    """Translate an OpenAI chat completion response into an Anthropic message.

    The ``requested_model`` is the model name the client originally sent.
    """
    if not isinstance(response, Mapping):
        raise RequestValidationError("upstream response must be a JSON object")
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RequestValidationError("upstream response missing choices")
    choice = choices[0]
    if not isinstance(choice, Mapping):
        raise RequestValidationError("upstream choice malformed")
    message = choice.get("message") if isinstance(choice, Mapping) else None
    if not isinstance(message, Mapping):
        raise RequestValidationError("upstream message missing")

    content_blocks: list[dict[str, Any]] = []
    text = message.get("content")
    if isinstance(text, str) and text:
        content_blocks.append({"type": "text", "text": text})
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list):
        for call in tool_calls:
            if not isinstance(call, Mapping):
                continue
            function = call.get("function") if isinstance(call, Mapping) else None
            name = function.get("name") if isinstance(function, Mapping) else None
            arguments_raw = function.get("arguments") if isinstance(function, Mapping) else None
            tool_input: dict[str, Any] = {}
            if isinstance(arguments_raw, str):
                try:
                    parsed = json.loads(arguments_raw)
                except ValueError:
                    parsed = {}
                if isinstance(parsed, dict):
                    tool_input = parsed
            elif isinstance(arguments_raw, dict):
                tool_input = dict(arguments_raw)
            if isinstance(name, str):
                content_blocks.append(
                    {
                        "type": "tool_use",
                        "id": str(call.get("id") or f"toolu_{uuid4().hex}"),
                        "name": name,
                        "input": tool_input,
                    }
                )

    usage = response.get("usage")
    input_tokens = 0
    output_tokens = 0
    if isinstance(usage, Mapping):
        input_tokens = _safe_int(usage.get("prompt_tokens"))
        output_tokens = _safe_int(usage.get("completion_tokens"))

    return {
        "id": _anthropic_id(response.get("id")),
        "type": "message",
        "role": "assistant",
        "model": requested_model,
        "content": content_blocks,
        "stop_reason": _ANTHROPIC_FINISH_MAP.get(choice.get("finish_reason"), "end_turn"),
        "stop_sequence": None,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        },
    }


async def openai_stream_to_anthropic_stream(
    chunks: AsyncIterator[bytes], *, requested_model: str
) -> AsyncIterator[bytes]:
    """Convert an OpenAI-style SSE byte stream into an Anthropic Messages
    SSE event stream.

    Only text content blocks are emitted. Tool-call streaming events are
    intentionally not produced because Anthropic's tool-call streaming
    contract is more elaborate and rarely needed by Claude Code in
    practice. Tool calls do appear correctly in the non-streaming path.
    """
    message_id = f"msg_{uuid4().hex}"
    upstream_id: str | None = None
    text_block_open = False
    block_index = 0
    output_tokens = 0
    input_tokens = 0
    stop_reason: str = "end_turn"
    started = False
    buffer = b""

    async def emit_start() -> bytes:
        return _sse_event(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": message_id,
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": requested_model,
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 0, "output_tokens": 0},
                },
            },
        )

    try:
        async for raw in chunks:
            buffer += raw
            while b"\n\n" in buffer:
                event_bytes, buffer = buffer.split(b"\n\n", 1)
                text_line = event_bytes.decode("utf-8", errors="replace").strip()
                if not text_line:
                    continue
                payload_lines = [
                    line[6:] for line in text_line.splitlines() if line.startswith("data: ")
                ]
                if not payload_lines:
                    continue
                data = "\n".join(payload_lines).strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if not isinstance(chunk, dict):
                    continue
                if not started:
                    started = True
                    yield await emit_start()
                upstream_id = upstream_id or (
                    chunk.get("id") if isinstance(chunk.get("id"), str) else None
                )
                usage = chunk.get("usage")
                if isinstance(usage, Mapping):
                    output_tokens = _safe_int(usage.get("completion_tokens"), default=output_tokens)
                    input_tokens = _safe_int(usage.get("prompt_tokens"), default=input_tokens)
                choices = chunk.get("choices")
                if not isinstance(choices, list) or not choices:
                    continue
                choice = choices[0]
                if not isinstance(choice, Mapping):
                    continue
                delta = choice.get("delta") if isinstance(choice, Mapping) else None
                if isinstance(delta, Mapping):
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        if not text_block_open:
                            yield _sse_event(
                                "content_block_start",
                                {
                                    "type": "content_block_start",
                                    "index": block_index,
                                    "content_block": {"type": "text", "text": ""},
                                },
                            )
                            text_block_open = True
                        yield _sse_event(
                            "content_block_delta",
                            {
                                "type": "content_block_delta",
                                "index": block_index,
                                "delta": {"type": "text_delta", "text": content},
                            },
                        )
                finish_reason = choice.get("finish_reason")
                if finish_reason:
                    stop_reason = _ANTHROPIC_FINISH_MAP.get(str(finish_reason), "end_turn")
    finally:
        if not started:
            yield await emit_start()
        if text_block_open:
            yield _sse_event(
                "content_block_stop",
                {"type": "content_block_stop", "index": block_index},
            )
        yield _sse_event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                "usage": {"output_tokens": output_tokens, "input_tokens": input_tokens},
            },
        )
        yield _sse_event("message_stop", {"type": "message_stop"})


def _translate_message(role: str, content: Any) -> list[dict[str, Any]]:
    """Translate a single Anthropic message into one or more OpenAI messages.

    Tool result blocks become standalone ``role="tool"`` messages because
    OpenAI keeps tool results out of the user-turn body.
    """
    if isinstance(content, str):
        return [{"role": role, "content": content}]
    if not isinstance(content, list):
        raise RequestValidationError("message content must be a string or list of blocks")

    text_parts: list[dict[str, Any]] = []
    tool_calls: list[dict[str, Any]] = []
    tool_messages: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, Mapping):
            raise RequestValidationError("content blocks must be JSON objects")
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text", "")
            if isinstance(text, str):
                text_parts.append({"type": "text", "text": text})
        elif block_type == "image":
            source = block.get("source")
            if isinstance(source, Mapping):
                url = _image_url_from_anthropic(source)
                if url:
                    text_parts.append({"type": "image_url", "image_url": {"url": url}})
        elif block_type == "tool_use" and role == "assistant":
            tool_id = block.get("id")
            name = block.get("name")
            tool_input = block.get("input", {})
            if isinstance(tool_id, str) and isinstance(name, str):
                tool_calls.append(
                    {
                        "id": tool_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": json.dumps(tool_input)
                            if isinstance(tool_input, (dict, list))
                            else "{}",
                        },
                    }
                )
        elif block_type == "tool_result" and role == "user":
            tool_use_id = block.get("tool_use_id")
            result_content = block.get("content", "")
            text = _flatten_text_blocks(result_content)
            if isinstance(tool_use_id, str):
                tool_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_use_id,
                        "content": text,
                    }
                )

    result: list[dict[str, Any]] = []
    if role == "user":
        # User messages can have a text/image body and any number of
        # tool_result blocks; emit the body as a user message and each
        # tool_result as its own tool message preceding the next user turn.
        result.extend(tool_messages)
        if text_parts:
            if len(text_parts) == 1 and text_parts[0]["type"] == "text":
                result.append({"role": "user", "content": text_parts[0]["text"]})
            else:
                result.append({"role": "user", "content": text_parts})
    else:  # assistant
        message: dict[str, Any] = {"role": "assistant"}
        if text_parts:
            message["content"] = (
                text_parts[0]["text"]
                if len(text_parts) == 1 and text_parts[0]["type"] == "text"
                else text_parts
            )
        else:
            message["content"] = None
        if tool_calls:
            message["tool_calls"] = tool_calls
        result.append(message)
    return result


def _flatten_text_blocks(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        pieces: list[str] = []
        for entry in value:
            if isinstance(entry, Mapping) and entry.get("type") == "text":
                text = entry.get("text", "")
                if isinstance(text, str):
                    pieces.append(text)
            elif isinstance(entry, str):
                pieces.append(entry)
        return "".join(pieces)
    return ""


def _translate_tools(tools: Any) -> list[dict[str, Any]]:
    translated: list[dict[str, Any]] = []
    if not isinstance(tools, list):
        return translated
    for tool in tools:
        if not isinstance(tool, Mapping):
            continue
        name = tool.get("name")
        if not isinstance(name, str):
            continue
        translated.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.get("description") or "",
                    "parameters": tool.get("input_schema") or {},
                },
            }
        )
    return translated


def _translate_tool_choice(tool_choice: Mapping[str, Any]) -> Any:
    if not isinstance(tool_choice, Mapping):
        return "auto"
    choice_type = tool_choice.get("type")
    if choice_type == "any":
        return "required"
    if choice_type == "auto":
        return "auto"
    if choice_type == "tool":
        name = tool_choice.get("name")
        if isinstance(name, str):
            return {"type": "function", "function": {"name": name}}
    return "auto"


def _image_url_from_anthropic(source: Mapping[str, Any]) -> str | None:
    if source.get("type") == "url":
        url = source.get("url")
        return url if isinstance(url, str) else None
    if source.get("type") == "base64":
        media_type = source.get("media_type", "image/png")
        data = source.get("data")
        if isinstance(data, str):
            return f"data:{media_type};base64,{data}"
    return None


def _safe_int(value: Any, *, default: int = 0) -> int:
    return value if isinstance(value, int) else default


def _anthropic_id(upstream_id: Any) -> str:
    if isinstance(upstream_id, str) and upstream_id:
        cleaned = re.sub(r"^chatcmpl[-_]?", "", upstream_id)
        return f"msg_{cleaned}"
    return f"msg_{uuid4().hex}"


def _sse_event(event: str, data: Mapping[str, Any]) -> bytes:
    body = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {body}\n\n".encode()


__all__ = [
    "anthropic_request_to_openai",
    "openai_response_to_anthropic",
    "openai_stream_to_anthropic_stream",
]
