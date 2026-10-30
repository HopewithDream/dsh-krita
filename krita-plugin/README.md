# DSH Krita Bridge (`kritamcp` 1.1.0)

A Krita Python plugin that exposes a local HTTP bridge on `127.0.0.1:5678`,
letting the DSH Host plugin (and any agent) draw, inspect and script inside a
running Krita. It is a **vendored and extended copy** of the MIT-licensed
`krita-mcp` plugin from [edithatogo/krita-cli](https://github.com/edithatogo/krita-cli)
(module name kept as `kritamcp`; see [`THIRD-PARTY.md`](THIRD-PARTY.md)).

- Plugin version: **1.1.0**
- Protocol version: **1.1.0**
- Verified on: **Krita 5.3.4.1** (Qt 5.15.7, bundled Python 3.13.5, PyQt5), Windows
- Contract: [`../PROTOCOL.md`](../PROTOCOL.md)

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok","plugin":"kritamcp","display_name":"DSH Krita Bridge","version":"1.1.0","protocol_version":"1.1.0","krita_version":"5.3.4.1 (git bd6e8d0)","python_version":"3.13.5"}` |
| GET | `/info` | health fields + `canvas_dir` + `commands` (action list) |
| POST | `/` | body `{"action":"<name>","params":{...}}` → `{"status":"ok",...}` or `{"error":{"code":"...","message":"...","recoverable":true}}` |

Every command runs on Krita's main thread through the original QTimer queue;
the HTTP server does not touch Krita objects directly.

## Actions

The original 52 bridge actions are kept (`new_canvas`, `open_file`, `save`,
`get_canvas`, `clear`, `undo`, `redo`, `set_color`, `set_brush`, `stroke`,
`fill`, `draw_shape`, `batch`, `rollback`, layers, selections, meta, ...).
With the 14 v1.1 actions the bridge exposes 66 actions total. (Upstream's "54"
counted MCP tool declarations, not bridge actions.)

New in 1.1.0:

- **`seq`** – ordered batch without a snapshot, max 64 commands. Nested
  `seq`/`batch`/`rollback` are rejected per sub-command (`NESTED_NOT_ALLOWED`).
  Response: `{status, count, results:[{action,status,result|error}]}`.
- **`py`** – `exec`/`eval` Python on the main thread with a persistent
  namespace. Pre-bound: `krita`, `Krita`, `Document`, `InfoObject`, `QColor`,
  `QPoint`, `QImage`, `app`, `doc`, `window`, `layer` (plus `view`, `selection`,
  `Node`, `Selection`, `ManagedColor`, `QRect`, `QPointF`, `QTransform`,
  `QPolygon`). Captures stdout (capped 64 KB); tracebacks return
  `code:"PYTHON_ERROR"` (capped 8 KB). `eval` includes `result` when JSON-safe.
  Long scripts can be executed from a UTF-8 `.py` file with `{"file":"..."}`
  instead of embedding `code`; `__file__` is bound and the tool-call JSON stays
  short (live-verified).
- **`actions` / `action`** – enumerate 688 QActions (`{id,text,shortcut}`, search
  by id or localized text, case-insensitive) / trigger one by id.
- **`filters` / `filter_config` / `filter`** – list 52 libkis filters;
  `filter_config` returns the filter's editable `InfoObject` properties;
  `filter` applies with defaults or with a `config` object (and optional
  `seed`). Live-verified: configured `blur` (soft edge) and `hsvadjustment`
  (hue shift). Filter names are **internal lowercase ids** (`blur`,
  `gaussian blur`, `invert`, ...), not display names.
- **`docs` / `doc_save` / `doc_close` / `doc_activate`** – document listing,
  native `.kra` save, safe close (rejects unsaved docs), activation by index/name.
- **`layer`** – best-effort ops `duplicate`, `merge_down`, `flatten`, `group`,
  `ungroup`, `blend`, `move` (see limitations below).
- **`resources`** – `preset|pattern|gradient|palette|symbol|workspace`
  (`symbol` is empty on this Krita build; `gradient` = 19 presets).
- **`info`** – versions, `document_count`, active document/layer, foreground /
  background color, brush preset/size.

The default rate limit is 600 requests/min (was 60) so DSH sketch loops are safe;
the HTTP server binds `127.0.0.1` explicitly.

## Install

1. Quit Krita.
2. Copy `kritamcp/` and `kritamcp.desktop` into
   `%APPDATA%\krita\pykrita\` (so `...\pykrita\kritamcp\__init__.py` exists).
3. Ensure `%LOCALAPPDATA%\kritarc` contains:

   ```ini
   [python]
   enable_kritamcp=true
   ```

4. Start Krita and verify:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:5678/health
   ```

Or run [`../scripts/install-krita-plugin.ps1`](../scripts/install-krita-plugin.ps1)
(installs the files and edits `kritarc` while preserving its contents; add
`-Restart` to restart Krita and wait for `/health`). The DSH Host plugin's
`setup` action performs the same steps in JS.

## Live test

[`../tests/krita/e2e.ps1`](../tests/krita/e2e.ps1) is the reproducible acceptance
test (60 checks; writes only to `dsh-krita/tests/out/`). With Krita running:

```powershell
powershell -ExecutionPolicy Bypass -File ..\tests\krita\e2e.ps1
```

It covers health/info, 640x480 canvas, `seq` drawing, layers, selection,
undo/redo, `py` introspection + QPainter gradient escape hatch, PNG export,
native `.kra` save, filter apply, configured filters (`filter_config` + blur +
HSV adjustment), actions, layer ops, `seq` error handling and document
activate/close. Last run: **60/60 passed** on Krita 5.3.4.1; artifacts:
`tests/out/e2e-drawing.png` (89,896 B, 640x480), `tests/out/e2e-drawing.kra`,
`tests/krita/e2e-report.json`. Configured-filter checks are in
`tests/krita/verify-filter.mjs` and `verify-filter-adjust.mjs`.

## Verified behaviour & limitations on Krita 5.3.4.1

- **`filter_config`** returns the editable properties for a filter; **`filter`
  config/seed is supported** by copying those property names into a `config`
  object. `Filter.setConfiguration()` stores an `InfoObject` pointer, so the
  bridge keeps the configured objects alive (bounded) to avoid the upstream
  libkis GC bug. Some filters cannot expose a config on 5.3 (e.g. `halftone`
  raises a KoColor conversion error) — those return `UNSUPPORTED`; invalid
  property values can make a filter fail, so use names/types from
  `filter_config`.
- **Layer ops** (real API mapping): `duplicate` → `Node.duplicate()`;
  `merge_down` → `Node.mergeDown()`; `flatten` → `Document.flatten()`;
  `blend` → `Node.setBlendingMode()` (accepts Krita ids / common names);
  `group`/`ungroup` use the `create_quick_group`/`quick_ungroup` QActions;
  `move` supports pixel offsets (`x`,`y`) and stack `direction:"up"|"down"`
  (via `move_layer_up`/`move_layer_down`); `parent`/`index` stack reordering has
  no libkis API and returns `UNSUPPORTED`.
- **Selection**: Krita 5.3's `Selection` has no `pixelSelected()`/`bounds()`.
  `select_rect`/`select_area` create the selection when none exists and commit
  it with `Document.setSelection()`; `selection_info`/`selection_stats` use the
  one-byte-per-pixel `Selection.pixelData()` mask and `x()/y()/width()/height()`.
  `select_ellipse`/`select_polygon` report `supported:false` (APIs absent) – use
  `py` if needed.
- **Saving**: `doc_save` writes native `.kra` only (creates parent directories,
  verifies the file exists). `save`/`get_canvas` export images, also create
  parent directories and now verify `exportImage()` actually wrote a file.
  Krita 5.3 has no `Document.setBatchmode()`; all calls are guarded.
- **`doc_close`** refuses to close a document with unsaved changes
  (`UNSAVED_CHANGES`): `Document.close()` on a modified document opens a modal
  save dialog that blocks Krita's main thread and wedges the bridge. Save first
  (`doc_save`) or pass `save:true`.
- **`py` is full-power but can wedge the bridge** if the executed code blocks in
  a modal/blocking Krita call (e.g. closing a modified document). There is no
  timeout/watchdog; prefer the dedicated actions and keep `py` short.
- **`save_selection` / `load_selection` round-trip fixed**: the grayscale mask
  now writes `qRgb(255,255,255)` / `qRgb(0,0,0)`; plain `255` on
  `Format_Grayscale8` stored gray 39, so reloaded masks were empty. Live-verified
  (400 selected pixels -> 0 after deselect -> 400 after load).
- Selection channels (`save_selection_channel` etc.) use legacy annotation and
  `pixelSelected` APIs that do not match Krita 5.3 – treat as upstream quirks
  and use `py`.
- `set_layer_opacity` keeps upstream semantics (pass the float 0–1 / int 0–255
  value libkis expects); `set_brush`'s `opacity` parameter is stored but not
  applied to the view – both are pre-existing upstream issues, not regressions.

## Files

```
krita-plugin/
  kritamcp/__init__.py        # bridge + v1.1 actions (~3.6k lines)
  kritamcp/{history_store,payload_validator,rate_limiter,snapshot_store}.py
  kritamcp.desktop            # Name/Comment = "DSH Krita Bridge", X-KDE-Library=kritamcp
  LICENSE                     # upstream MIT license
  THIRD-PARTY.md              # attribution + list of modifications
```
