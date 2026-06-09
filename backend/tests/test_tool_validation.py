import unittest

from app.student.tool_validation import parse_tool_arguments


SCHEMA = {
    "type": "object",
    "properties": {
        "task": {"type": "string", "minLength": 1},
        "limit": {"type": "integer"},
        "mode": {"type": "string", "enum": ["fast", "deep"]},
    },
    "required": ["task"],
}


class ToolArgumentValidationTests(unittest.TestCase):
    def test_accepts_valid_arguments(self):
        arguments, errors = parse_tool_arguments(
            '{"task":"优化简历","limit":3,"mode":"deep"}',
            SCHEMA,
        )

        self.assertEqual(arguments["limit"], 3)
        self.assertEqual(errors, [])

    def test_rejects_malformed_json(self):
        arguments, errors = parse_tool_arguments('{"task":', SCHEMA)

        self.assertEqual(arguments, {})
        self.assertIn("参数不是合法 JSON", errors[0])

    def test_rejects_missing_and_wrong_types(self):
        _, errors = parse_tool_arguments('{"limit":true,"mode":"other"}', SCHEMA)

        self.assertIn("缺少必填参数「task」", errors)
        self.assertIn("参数「limit」应为 整数", errors)
        self.assertTrue(any("参数「mode」必须是" in error for error in errors))

    def test_requires_an_object(self):
        arguments, errors = parse_tool_arguments('["not-an-object"]', SCHEMA)

        self.assertEqual(arguments, {})
        self.assertEqual(errors, ["工具参数必须是 JSON 对象"])


if __name__ == "__main__":
    unittest.main()
