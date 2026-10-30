# DSH-Krita bridge protocol (v1.1)

Transport: HTTP on loopback. Default `http://127.0.0.1:5678`.
The Krita-side bridge is a vendored and extended copy of the MIT-licensed
`krita-mcp` Krita plugin (`refs/krita-cli/krita-plugin/kritamcp`).

- `GET /health` -> `{"status":"ok","plugin":"kritamcp","version":"...","protocol_version":"1.1.0","krita_version":"..."}`
- `POST /` body `{"action":"<name>","params":{...}}` -> JSON

Success envelope follows the existing plugin convention:

```json
{"status":"ok", "...": "action-specific fields"}
```

Failure envelope:

```json
{"error":{"message":"...","code":"...","recoverable":true}}
```

The DSH Host plugin sends bridge commands through the `seq` action (one HTTP
round trip per tool call) and handles `start` / `setup` / `status` locally.

## Existing actions (kept, do not rename)

Canvas / paint:
`new_canvas`, `open_file`, `save`, `get_canvas`, `get_canvas_info`,
`clear`, `undo`, `redo`, `get_color_at`, `set_color`, `set_brush`,
`list_brushes`, `stroke`, `fill`, `draw_shape`, `batch`, `rollback`,
`get_command_history`.

Layers:
`list_layers`, `create_layer`, `select_layer`, `delete_layer`,
`rename_layer`, `set_layer_opacity`, `set_layer_visibility`.

Selection:
`select_rect`, `select_ellipse`, `select_polygon`, `select_area`,
`select_by_color`, `select_by_alpha`, `selection_info`, `selection_stats`,
`clear_selection`, `deselect`, `invert_selection`, `fill_selection`,
`grow_selection`, `shrink_selection`, `border_selection`,
`combine_selections`, `transform_selection`,
`save_selection`, `load_selection`,
`save_selection_channel`, `load_selection_channel`,
`list_selection_channels`, `delete_selection_channel`.

Meta:
`get_current_color`, `get_current_brush`, `get_capabilities`, `get_security_status`.

Note: the upstream bridge exposes 52 actions; the old "54" figure counted the
MCP tool declarations, not bridge actions. This build adds 14 v1.1 actions, for
66 total.

## New actions (v1.1)

### `seq` - fast ordered batch, no snapshot

```json
{"commands":[{"action":"stroke","params":{...}}, ...], "stop_on_error": false}
```

Returns:

```json
{"status":"ok|partial|error","count":2,"results":[
  {"action":"stroke","status":"ok","result":{...}},
  {"action":"fill","status":"error","error":{"message":"...","code":"..."}}
]}
```

- Max 64 commands; nested `seq` / `batch` / `rollback` are rejected.
- No pre-batch snapshot (unlike `batch`), so it is cheap for sketch loops.
- Each sub-result keeps the full sub-action result object under `result`.

### `py` - run Python inside Krita's main thread

```json
{"code":"...", "mode":"exec|eval", "capture":true}
{"file":"C:/path/to/script.py", "mode":"exec"}
```

Use `file` for any long script or any script containing many quotes/braces.
The Host/agent writes the `.py` with the normal `write` tool, then sends only the
short path. This keeps tool-call JSON small and avoids the model producing
malformed JSON while escaping a long inline `code` string. `file` and `code` are
mutually exclusive; file-based runs bind `__file__` to the path.

Pre-bound names in the persistent namespace:
`krita` (module), `Krita`, `Document`, `InfoObject`, `QColor`, `QPoint`,
`QImage`, `app` (`Krita.instance()`), `doc` (active document or `None`),
`window` (`app.activeWindow()`), `layer` (`doc.activeNode()` or `None`).

Returns:

```json
{"status":"ok","result": <JSON-safe value, eval only, optional>,
 "repr":"...", "stdout":"...", "truncated": false}
```

- `exec` runs statements; variables persist across `py` calls until Krita exits.
- `eval` evaluates one expression and returns a JSON-safe value when possible,
  otherwise `repr`.
- `stdout` is captured and capped; tracebacks are returned as a normal error
  with `code:"PYTHON_ERROR"`.
- Missing file -> `code:"PY_FILE_NOT_FOUND"`.
- This is the full-power escape hatch: every Krita Python API is reachable.

### `actions` / `action` - enumerate or trigger any Krita QAction

```json
{"q":"filter blur", "limit":100}
```

Returns `{"status":"ok","total":123,"actions":[{"id":"...","text":"...","shortcut":"..."}]}`.
Filter matches action id or text, case-insensitive.

`{"id":"edit_undo"}` triggers the action (no params) and returns
`{"status":"ok","id":"edit_undo"}`. Actions that open dialogs are asynchronous:
the action is only triggered, the dialog is not awaited.
Unknown id fails with `code:"ACTION_NOT_FOUND"`.

### `filters` / `filter_config` / `filter` - list, inspect, or apply filters

`{"q":"blur","limit":100}` ->
`{"status":"ok","total":52,"filters":[{"name":"blur"}]}`.

`{"name":"blur"}` -> `{"status":"ok","name":"blur","properties":{"halfHeight":5,"halfWidth":5,"lockAspect":true,"rotate":0,"shape":0,"strength":0}}`.
`filter_config` reads the filter's `InfoObject` properties without applying it;
use those exact names/types in `filter.config`.

```json
{"name":"blur","layer":"paint","x":0,"y":0,"w":800,"h":600,
 "config":{"halfWidth":18,"halfHeight":18,"strength":100}}
```

Applies the filter to the named or active layer with defaults or the supplied
`config` (and optional `seed`, merged into the properties), then returns
`{"status":"ok","name":...,"layer":...,"configured":true,"config":{...}}`.
`x/y/w/h` default to the whole document. Krita's `Filter.setConfiguration()`
keeps an `InfoObject` pointer, so the bridge retains configured objects to
avoid the upstream GC bug. Some filters cannot expose a config on 5.3 (e.g.
`halftone`) and return `code:"UNSUPPORTED"`; invalid property names/values can
make a filter fail (`FILTER_FAILED`). Live-verified: configured `blur` and
`hsvadjustment` (`{"h":120}` turns red into green).

### `docs` / `doc_save` / `doc_close` / `doc_activate`

- `docs` -> `{"status":"ok","count":2,"docs":[{"index":0,"name":"a.kra","path":"C:/...","width":800,"height":600,"active":true,"modified":false}]}`
- `doc_save {"path":"C:/.../a.kra"}` -> native `.kra` save; without `path`, saves
  to the document's current file name. Returns `{"status":"ok","path":"..."}`.
- `doc_close {"save":false}` -> close the active document. A modified document
  is refused with `code:"UNSAVED_CHANGES"` because closing it would open a modal
  save prompt that blocks Krita's main thread; save first or pass `save:true`.
- `doc_activate {"index":0}` or `{"name":"a.kra"}` -> activate a document.

### `layer` - extra layer operations

```json
{"op":"duplicate|merge_down|flatten|group|ungroup|blend|move",
 "name":"...", "x":0, "y":0, "direction":"up|down", "mode":"normal"}
```

`duplicate`, `merge_down`, `flatten`, `group`, `ungroup`, `blend` and pixel/stack
`move` are implemented; stack reordering by `parent`/`index` has no libkis API
and returns `code:"UNSUPPORTED"`. Details are verified on the installed Krita
build by the bridge tests.

### `resources`

```json
{"type":"preset|pattern|gradient|palette|symbol|workspace","q":"ink","limit":50}
```

Returns `{"status":"ok","total":n,"resources":[{"name":"..."}]}`.

### `info`

Rich status: Krita/plugin/protocol versions, active document summary, active
layer name, foreground color, current brush preset and open document count.

## Host-side pseudo-actions (never sent to Krita)

The DSH `krita` tool accepts these action names and implements them in the Host
plugin (same JSON shape as the other tool commands):

- `start` -> if the bridge is already up, returns
  `{"ok":true,"status":"running","already_running":true,...}`; otherwise launches
  the configured `kritaPath`, waits for `/health`, and returns
  `{"ok":true,"status":"running","launched":true,"pid":...,"health":{...}}`.
  It refuses to launch a second instance when Krita is already running.
- `setup` -> copy `krita-plugin/kritamcp` + `kritamcp.desktop` into
  `%APPDATA%/krita/pykrita` and set `[python] enable_kritamcp=true` in
  `%LOCALAPPDATA%/kritarc`; returns
  `{"ok":true,"installed_to":"...","restart_required":true|false,"bridge_running":true|false,...}`.
- `status` -> `GET /health` plus `info`; returns a compact merged object (or a
  down result with `krita_running` and a recovery `hint`).
