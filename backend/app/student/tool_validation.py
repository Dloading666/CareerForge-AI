from __future__ import annotations

import json
from typing import Any, Optional


def parse_tool_arguments(
    raw_arguments: Any,
    input_schema: Optional[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    if isinstance(raw_arguments, dict):
        arguments = raw_arguments
    else:
        try:
            arguments = json.loads(str(raw_arguments or "{}"))
        except json.JSONDecodeError as exc:
            return {}, [f"参数不是合法 JSON：{exc.msg}"]

    if not isinstance(arguments, dict):
        return {}, ["工具参数必须是 JSON 对象"]
    if not input_schema:
        return arguments, []
    return arguments, validate_tool_arguments(arguments, input_schema)


def validate_tool_arguments(arguments: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = schema.get("required") or []
    properties = schema.get("properties") or {}

    for field in required:
        if field not in arguments:
            errors.append(f"缺少必填参数「{field}」")
            continue
        value = arguments[field]
        if isinstance(value, str) and not value.strip():
            errors.append(f"必填参数「{field}」不能为空")

    for field, value in arguments.items():
        field_schema = properties.get(field)
        if not isinstance(field_schema, dict):
            continue
        expected = field_schema.get("type")
        if expected and not _matches_json_type(value, expected):
            errors.append(f"参数「{field}」应为 {_json_type_label(expected)}")
            continue
        if expected == "string":
            min_length = field_schema.get("minLength")
            max_length = field_schema.get("maxLength")
            if isinstance(min_length, int) and len(value) < min_length:
                errors.append(f"参数「{field}」长度不能少于 {min_length}")
            if isinstance(max_length, int) and len(value) > max_length:
                errors.append(f"参数「{field}」长度不能超过 {max_length}")
        if "enum" in field_schema and value not in field_schema["enum"]:
            errors.append(f"参数「{field}」必须是 {field_schema['enum']} 之一")
    return errors


def _matches_json_type(value: Any, expected: str) -> bool:
    type_checks = {
        "string": lambda item: isinstance(item, str),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
        "boolean": lambda item: isinstance(item, bool),
        "array": lambda item: isinstance(item, list),
        "object": lambda item: isinstance(item, dict),
        "null": lambda item: item is None,
    }
    checker = type_checks.get(expected)
    return checker(value) if checker else True


def _json_type_label(expected: str) -> str:
    return {
        "string": "字符串",
        "integer": "整数",
        "number": "数字",
        "boolean": "布尔值",
        "array": "数组",
        "object": "对象",
        "null": "空值",
    }.get(expected, expected)
