"""Smoke test for the bridge's file-based `py` path.

The file deliberately contains quotes, braces, and newlines. The agent writes
scripts like this with the `write` tool and passes only `{"file": path}` in the
tool-call JSON, avoiding fragile escaping inside `commands`.
"""
import os

payload = {"braces": "{ }", "quotes": "\"quoted\""}
py_file_value = len(payload)
print("file_mode_ok", os.path.basename(__file__))
print("value", py_file_value)
