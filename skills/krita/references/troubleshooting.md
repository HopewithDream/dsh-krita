# Troubleshooting

Start every investigation with the host `status` action — it is local, cheap and
tells you whether Krita runs and whether the bridge answers.

```json
{"action":"status"}
```

Expected up: `{ok:true,status:"running",health:{plugin:"kritamcp",version:"1.1.0",protocol_version:"1.1.0",krita_version:"..."},info:{...}}`.

## Triage table

| symptom | likely cause | fix |
|---|---|---|
| `status` → `down`, `krita_running:false` | Krita closed | `{"action":"start"}` (waits up to 120 s), then `status` |
| `status` → `down`, `krita_running:true` | bridge plugin not loaded in this Krita session | `{"action":"setup"}`, then restart Krita and `status` |
| `DeepSeek Messages stream: tool input is invalid JSON` (turn dies before the bridge is called) | the model emitted structurally invalid tool-call JSON — usually a long `py` script with quotes/braces embedded in `commands` | do not retry the same giant inline `code`: write a `.py` file and use `py` `{"file":...}`; keep each call small; install the `extras/llm-malformed-retry` profile bundle and retry the step |
| `BRIDGE_UNREACHABLE` on a paint call | bridge not listening (Krita closed/plugin not enabled) or wrong port | run `status`; if down, `setup`/`start`, or ask the user to restart Krita |
| `BRIDGE_TIMEOUT` / "timed out after N ms" | bridge request exceeded `timeoutMs` (default 30 s) | retry the whole call with `timeoutMs:120000`; split huge commands |
| `status` ok but every document action fails `NO_ACTIVE_DOCUMENT` | no document open | `new_canvas` or `open_file`, then `doc_activate` |
| `NO_ACTIVE_LAYER` | no active node (empty doc, group active, mask deleted) | `list_layers`, `select_layer` a paintlayer |
| `NO_ACTIVE_VIEW` | Krita has no active window/view (minimized-to-tray, startup race) | bring Krita window up, or `start`; retry |
| `ACTION_NOT_FOUND` | QAction id differs in this build | `{"action":"actions","params":{"q":"..."}}`, then trigger the exact id |
| `FILTER_NOT_FOUND` | filter name not in this build | `{"action":"filters","params":{"q":"blur"}}` and use the returned internal name |
| `RATE_LIMIT_EXCEEDED` (HTTP 429) | > 600 bridge requests/min | wait a minute; send larger batches; check `get_security_status` |
| `PAYLOAD_TOO_LARGE` (413) | request body > 10 MB | split the call; reduce point counts; move big data to a file read inside `py` |
| result ends with `…[truncated; narrow the query...]` | tool JSON cap (16000 chars) | request fewer fields/limits, smaller batches, `q` filters, `limit` |
| `PYTHON_ERROR` | traceback in `error.message` | read the last lines, fix, re-run the same `py` |
| layer looks invisible after `set_layer_opacity` | 0–1 vs 0–255 scale bug | `py`: `doc.nodeByName("name").setOpacity(128)` |
| `Grow not supported` / selection modifier errors | selection radius arity | `grow_selection`/`border_selection` work; `shrink_selection` needs 3 args → `py`: `sel.shrink(4,4,True)` |
| `select_ellipse` / `select_polygon` returns `supported:false` | Krita 5.3 has no `selectEllipse`/`selectPolygon` | `py` QImage mask + `Selection.setPixelData` |
| saved selection vanishes / only a rectangle loads | channels store bounds only; `save_selection_channel`/`list_selection_channels` are broken on 5.3.4.1 | dump the mask with `py` (`selection.pixelData` → QImage) and reload with `load_selection` |
| `SAVE_FAILED` from `doc_save` | non-`.kra` path, missing permission, or `.kra` open read-only | use a writable `.kra` path; `save` for PNG export |
| `UNSAVED_CHANGES` from `doc_close` | modified document, `save:false` | `doc_save` first, or `doc_close {"save":true}` |
| `save` returns `ok:true` but no file / `read_image` fails | parent dir missing or Krita export refused | create the parent directory or use `get_canvas`; the installed bridge now checks the file, but always verify with `read_image` |
| bridge stops answering mid-session; Krita's main thread is blocked (a modal dialog is open, or the window seems frozen) | a blocking libkis call — `doc.close()`/`saveAs` on a modified document, flatten/merge on a modified document, a `QFileDialog`, or long `time.sleep` | **user must close and reopen Krita** (unsaved work is lost). Prevent: host `doc_save`/`doc_close {save:true}`, no UI/modal calls in `py` (`Document.setBatchmode` does not exist on 5.3) |
| `FILTER_FAILED` / `FILTER_CONFIG_FAILED` / `UNSUPPORTED` from `filter` | wrong property name/type, filter cannot expose a config (e.g. `halftone`), or the layer type rejects it | run `filter_config` and pass only the returned keys/types; keep a duplicate layer; apply with defaults or use `py` |
| `fill_selection` returns an error | `Document.fillSelection` does not exist on 5.3.4.1 | trigger the `fill_selection_foreground_color` QAction |
| `shrink_selection` / `transform_selection` / `combine_selections` / selection channels fail | 5.3.4.1 `Selection` lacks `transform`/`pixelSelected`, channels use legacy annotations | do mask math in `py` from `selection.pixelData`; use `grow`/`border` (they work) |
| paint does not stay inside the selection | raw pixel writes ignore selections | fill the selection with the QAction, or composite a mask in `py` |
| nothing repaints on screen but JSON says ok | projection not refreshed | call `py` with `doc.refreshProjection()`, or `get_canvas` to check actual pixels |

## The bridge is down

1. `{"action":"status"}` — note `krita_running`.
2. If Krita is closed: `{"action":"start"}`, then `status`. `start` only waits for
   `/health`; it does not click through Krita dialogs.
3. If Krita is running: the Python plugin was installed **after** Krita started.
   Run `{"action":"setup"}` — it copies `krita-plugin/kritamcp` to
   `%APPDATA%\krita\pykrita\kritamcp`, copies `kritamcp.desktop`, and writes
   `[python] enable_kritamcp=true` in `%LOCALAPPDATA%\kritarc`. `setup` returns
   `restart_required:true` when Krita is running. **Krita must be restarted
   once**; do not close it yourself if the user has unsaved work — ask.
4. On a manual install, enable **Settings → Configure Krita → Python Plugin
   Manager → DSH Krita Bridge** (or the "Krita MCP Bridge" entry) and restart.
5. Verify the install:
   - `%APPDATA%\krita\pykrita\kritamcp\__init__.py` exists (with `PLUGIN_VERSION
     = "1.1.0"`)
   - `%APPDATA%\krita\pykrita\kritamcp.desktop` exists
   - `%LOCALAPPDATA%\kritarc` has `[python]` and `enable_kritamcp=true`
6. If `/health` still never appears, read Krita's plugin log:
   `~/kritamcp_startup.log` (also `~/kritamcp_diag.log` on older builds). A
   missing log usually means the plugin never loaded (not enabled, wrong path,
   desktop file missing).
7. Check a raw endpoint manually: `GET http://127.0.0.1:5678/health` or the `/info`
   endpoint. The host bridge default URL is `http://127.0.0.1:5678`.

## Port busy

Symptom: bridge never answers while Krita is clearly running and enabled, and
the startup log contains `HTTP server failed on port 5678: [WinError 10048]` /
"address already in use".

- Another Krita instance, an old `kritamcp` plugin, or another process holds
  5678. Only one can bind it. Check with
  `netstat -ano | findstr :5678` (Windows), then close the stale process **with
  the user's consent**.
- To use another port, set `port` in `~/.krita-cli/config.json` (plugin reads it
  at startup) and configure the same port in the DSH preset (`port` in the
  `dsh-krita-painter` tool config). Restart both.
- `start` refuses to launch a second Krita while one is running (the second
  process cannot own the same port). Close/reopen the running instance instead.

## Rate limit and command flow

- 600 bridge requests/minute per Krita process (sliding 60 s window). One tool
  call is one bridge request regardless of 1–32 commands, so **batching is the
  fix**. `get_security_status` shows `current_usage`.
- HTTP 429 → the bridge rejects the request before doing any work; wait ~60 s or
  reduce call frequency. Never retry a 429 in a tight loop.
- Large point lists make the HTTP body big (10 MB cap). A stroke with thousands
  of points is both slow and expensive; sample a curve into 30–120 points.

## No document / no layer / no view

- `NO_ACTIVE_DOCUMENT`: `new_canvas`, `open_file` or `doc_activate`.
- `NO_ACTIVE_LAYER`: `list_layers` then `select_layer`; masks and groups can be
  active nodes — select a `paintlayer` before painting.
- `NO_ACTIVE_VIEW`: a document can exist without a view (created by a script and
  not added to the window). `new_canvas`/`open_file` add a view; for a raw
  `app.createDocument` in `py`, call `app.activeWindow().addView(doc)`.
- Active layer type matters: `setPixelData` silently does nothing on group,
  file and clone layers. `create_layer` adds and activates a new layer;
  `list_layers` + `select_layer` switches to an existing one.

## `py` traceback handling

A failed `py` returns a normal error object, so the tool call is `ok:false`:

```text
{"action":"py","params":{"mode":"exec","code":"doc.nope()"}}
→ {"action":"py","ok":false,"code":"PYTHON_ERROR",
   "error":"AttributeError: 'Document' object has no attribute 'nope'\n\nTraceback ..."}
```

Process it like a normal Python error:

1. Read the **last** line of the traceback first (`AttributeError`, `TypeError`,
   `NameError`, `RuntimeError`).
2. Common causes:
   - `NameError` — the name is not pre-bound (e.g. `QPainter`, `Qt`, `np`); add
     the import inside the code.
   - `AttributeError` — the API does not exist on this Krita build. Check the
     cheatsheet's "uncertain" list; inspect with
     `eval("hasattr(layer,'ungroup')")`.
   - `TypeError` / arity mismatches — Krita changed a signature; print
     `help(fn)` or try the documented variant.
   - `RuntimeError: no active document` — check `doc is not None`.
3. `py` state persists: a variable assigned before the failing line still exists,
   but a half-finished pixel write may be visible. Preview with `get_canvas`.
4. Do not wrap a traceback in another `py`; the message is already returned.
5. If a dialog is open in Krita (from an `action` trigger), the bridge main-thread
   loop can be blocked until the user closes it — this looks like a timeout. Ask
   the user to close the dialog, or avoid dialog actions.
6. A `py` call that blocks (modal save prompt, `doc.close()` on a modified
   document, `doc.saveAs` with a dialog, flatten/merge on a modified document)
   wedges Krita's main thread **and holds the GIL**, so the whole bridge stops
   answering. The host then shows `BRIDGE_UNREACHABLE`/timeouts although Krita's
   window is still open. Recovery is manual: the user must close and reopen
   Krita (unsaved changes may be lost). Prevention: use `doc_save` and
   `doc_close {save:true}` instead of Python document lifecycle calls, set
   `doc.setBatchmode(True)` around save/export, never open UI, never sleep.

## Undo, rollback and recovery

- `undo`/`redo` trigger Krita's `edit_undo`/`edit_redo`. They reliably cover
  Krita-native operations, but the bridge's `stroke`/`fill`/`draw_shape`/`clear`
  write pixels directly and may not be on the undo stack. **Verify with a
  preview export** instead of assuming.
- `batch` + `rollback`: `batch` snapshots the whole canvas before running; the
  `batch_id` it returns can be passed to `rollback`, which creates a
  `Rollback_<id8>` layer containing the pre-batch image — original layers stay
  underneath. It fails if the canvas size changed, and snapshots disappear when
  Krita restarts.
- Both are legacy/raw-bridge paths: `batch`/`rollback` are rejected inside `seq`,
  and the DSH tool always sends multi-command calls through `seq`. Do not plan a
  workflow around them.
- Practical recovery: versioned `.kra` files (`doc_save` to
  `..._pass03.kra`), PNG previews (`get_canvas`), and delete/recreate the layer
  that went wrong. Never overwrite the user's original `.kra`; save a new file
  or ask first.

## Version mismatch

- `status.health` shows the truth: `plugin`, `version`, `protocol_version`,
  `krita_version`. The DSH plugin expects protocol **1.1.0**. A 1.0.0 plugin does
  not implement `seq`, `py`, `actions`, `filters`, `docs`, `layer`, `resources`,
  `info` — calls with >1 command fail on the missing `seq`.
- Fix: run `setup` (copies the vendored 1.1.0 plugin), restart Krita once, check
  `status` again. If a stale older `kritamcp` is still installed elsewhere (e.g.
  `%APPDATA%\krita\pykrita` from another tool), remove/disable it — two copies
  conflict.
- Krita 5.3.4.1-specific behavior: selections and some layer ops are imperfect
  (see "Known limitations" at the end of `protocol.md`). Use `py` for the
  documented workarounds rather than fighting the wrapper.
- If `/health` reports a `krita_version` other than 5.3.4.1, re-read
  `protocol.md` caveats before trusting `select_*`, `layer` and `filter`.

## Tool output and cost

- Large `list_layers`/`actions`/`resources` responses are cut at 16000 chars.
  Use `q` and `limit`, or ask `py` for a count.
- Prefer `get_color_at` over reading pixels into the result.
- `select_by_color` and `select_by_alpha` loop per pixel in Python; `load_selection`
  does too. On a 4000×3000 canvas they can take minutes and exceed the bridge
  queue timeout. Use `py` masks instead. `combine_selections` and the selection
  channels are broken on 5.3.4.1. `selection_stats` is live-verified working;
  `save_selection`/`load_selection` are fixed in 1.1.0 (binary mask verified
  400 -> 0 -> 400) but remain O(pixels).
