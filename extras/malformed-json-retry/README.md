# Malformed tool-call JSON retry

DeepSeek Messages occasionally streams tool-call arguments that are not valid
JSON (for example one missing `}` at a command boundary in a long inline `py`
call). The adapter reports `MALFORMED_RESPONSE`; DSH's default DeepSeek retry
policy does not include that code, so the whole turn ends.

This profile plugin listens on `agent/request-error` and retries the failed step
up to **2 times per turn/step** for `MALFORMED_RESPONSE` only, then delegates to
the normal retry policy. It is global and can be installed live; already-open
sessions also receive the listener.

Installed with:

```powershell
plugin_manager install_bundle target="D:\DSH默认工作区\dsh-krita\extras\malformed-json-retry"
```

The Krita side also gained a `py` **file** mode: write a long script with the
normal `write` tool and call `py` with `{"file":"<path>"}`, so the tool-call JSON
stays short. That prevents most malformed-JSON cases instead of only retrying
them.
