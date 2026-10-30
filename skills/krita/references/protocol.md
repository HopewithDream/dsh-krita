# Krita bridge protocol and complete action reference (v1.1.0)

Source of truth: `dsh-krita/PROTOCOL.md` + the vendored bridge
`krita-plugin/kritamcp/__init__.py` (plugin version 1.1.0, Krita 5.3.4.1).
Facts marked **(verify)** were not confirmed against the live bridge/install.

## How a tool call reaches Krita

One model-facing tool: `krita({commands:[{action,params}, ...], timeoutMs?})`.

- `commands`: 1–32 per call (host cap). Consecutive non-host commands are sent to
  the bridge in one `seq` request, so batching costs one round trip.
- `timeoutMs`: per bridge request; default 30000, min 500, max 600000. Exporting,
  big filters, `select_by_color` and `py` pixel loops may need 120000+.
- `status`, `start`, `setup` are executed by the Host, not sent to Krita.
- Do **not** send `seq` yourself (the host rejects it); just pass several
  commands. `batch`/`rollback` are raw-bridge actions with special snapshot
  semantics and are rejected inside `seq` — use them only when you need that
  snapshot, otherwise let the tool batch normally.

### Result shape

The bridge replies with `{"status":"ok", ...fields}` or
`{"error":{"code","message","recoverable"}}`. The host flattens each command
result to:

```json
{"action":"stroke","ok":true,"points_count":12,"hardness":0.5}
{"action":"fill","ok":false,"error":"No active layer","code":"NO_ACTIVE_LAYER"}
```

- `status` is removed; `ok` is added (`ok:false` when the bridge status was
  `"error"` or an `error` object was returned).
- The returned JSON string is capped (default 16000 chars) and ends with
  `…[truncated; narrow the query or request fewer fields]` when cut.
- If a bridge request dies, the whole rest of that call is skipped:
  `{"ok":false,"results":[...],"skipped":N}`.
- Within one `seq`, a failed sub-command does not abort the others, unless the
  bridge reports the whole sequence as `error` (no successes at all).

## Host actions (never sent to Krita)

| action | params | returns |
|---|---|---|
| `status` | — | up: `{ok:true,status:"running",bridge,health:{plugin,version,protocol_version,krita_version,python_version},info}`; down: `{ok:false,status:"down",bridge,error,krita_running,hint}` |
| `start` | — | `{ok:true,status:"running",launched:true,pid,health}`; if already up: `already_running:true`. Waits up to `startTimeoutMs` (default 120000). |
| `setup` | — | `{ok:true,installed_to,desktop_file,config,enabled:"enable_kritamcp=true",restart_required,bridge_running,hint}` — copies the plugin to `%APPDATA%\krita\pykrita\kritamcp` and enables it in `%LOCALAPPDATA%\kritarc` |

```json
{"action":"status"}
{"action":"setup"}
{"action":"start"}
```

`status` is the cheapest connectivity check (2 s health timeout). Call it first
when a paint call fails with `BRIDGE_UNREACHABLE`.

## Canvas, documents, preview export

**`new_canvas`** · `width`=800 (1–8192), `height`=600, `name`="New Canvas", `background`="#1a1a2e" · → `{width,height,name}`
Creates RGBA/U8/120 dpi document, shows it, adds a paint layer named `paint`
filled with `background`. The first layer is active.
`{"action":"new_canvas","params":{"width":1600,"height":1000,"name":"Study","background":"#ffffff"}}`

**`open_file`** · `path` (absolute; contains no `..`) · → `{path,name,width,height}`
Opens any Krita-supported file and adds a view. Does not import into an existing
document.
`{"action":"open_file","params":{"path":"C:/art/original.kra"}}`

**`docs`** · — · → `{count,docs:[{index,name,path,width,height,active,modified}]}`
`index` is the order to pass to `doc_activate`.
`{"action":"docs"}`

**`doc_save`** · `path` (optional; must end in `.kra` or have no extension, then
`.kra` is appended) · → `{path}`
Native save via `saveAs`; the Host creates parent directories. Without `path`,
saves to the document's current file. Refuses non-`.kra` targets
(`INVALID_PARAMETERS`). Live-verified on 5.3.4.1.
`{"action":"doc_save","params":{"path":"C:/art/2026-10-30_session01.kra"}}`

**`doc_close`** · `save`=false · → `{name}`
Closes the **active** document. Safety guard (live-verified): a modified
document with `save:false` is rejected with `UNSAVED_CHANGES`; save first or pass
`save:true`. `save:true` saves to the document's existing file (fails if it has
none). This is the safe host-side close; do not call `doc.close()` from `py` on a
modified document — a modal save prompt wedges Krita's main thread and the
bridge.
`{"action":"doc_close","params":{"save":true}}`

**`doc_activate`** · `index` or `name` (exact document name/path/basename,
case-insensitive) · → `{index,name,activated}`
`{"action":"doc_activate","params":{"index":1}}`

**`get_canvas`** · `filename`="canvas.png" (no `..`) · → `{path,size}`
Exports the active document to `~/krita-mcp-output/<filename>` (always `.png`;
directory shown as `capture_dir` in `info`), creating the directory and verifying
the written file. This is the preview path: call it, then `read_image` the
returned path.
`{"action":"get_canvas","params":{"filename":"iter03.png"}}`

**`get_canvas_info`** · — · → `{name,width,height,color_model,color_depth,resolution}`
`{"action":"get_canvas_info"}`

**`info`** · — · → `{plugin,display_name,version,protocol_version,krita_version,python_version,document_count,active_document,active_layer,foreground_color,background_color,brush:{preset,size,opacity},has_window,capture_dir}`
`active_document` is a `_doc_summary`; `active_layer` is `{name,type}`.
`{"action":"info"}`

**`save`** · `path` (no `..`) · → `{path,size}`
`exportImage` to any file extension (PNG/JPG/…), default export config. **Not**
a `.kra` save. The installed bridge creates parent directories, checks
`exportImage()`'s return value and verifies the file (live-verified), returning
`SAVE_FAILED` on failure. Still confirm the image with `read_image`.
`{"action":"save","params":{"path":"C:/art/final.png"}}`

**`clear`** · `color`="#1a1a2e" · → `{color}`
Overwrites the **whole active layer** with an opaque color (default dark blue).
Destructive; check `list_layers` first.
`{"action":"clear","params":{"color":"#ffffff"}}`

**`undo`** / **`redo`** · — · → `{}`
Triggers `edit_undo` / `edit_redo`. Undo coverage of the bridge's own raw pixel
writes is uncertain — treat `stroke`/`fill`/`draw_shape`/`clear` as not undoable
and re-check with a preview export **(verify)**.
`{"action":"undo"}`

**`get_color_at`** · `x`, `y` · → `{color,r,g,b,a}` (hex + channels from the
document projection, 8-bit RGBA)
`{"action":"get_color_at","params":{"x":640,"y":360}}`

**`get_command_history`** · `limit`=20 (1–500) · → `{history:[{action,params,timestamp,status,duration_ms,error}],count}`
`{"action":"get_command_history","params":{"limit":10}}`

## Painting (pixel-level, foreground color)

**`set_color`** · `color` (hex `#rrggbb` or `#rrggbbaa`) · → `{color}`
`{"action":"set_color","params":{"color":"#2b2b3a"}}`

**`set_brush`** · `preset` (case-insensitive substring), `size` (1–5000),
`opacity` (0–1) · → `{}`
Preset match is first-substring; size sets the view brush size and becomes the
default for later `stroke` calls. `opacity` is stored but **not applied** to the
view (the `stroke` action takes its own `opacity`).
`{"action":"set_brush","params":{"preset":"ink","size":8}}`

**`list_brushes`** · `filter`="", `limit`=50 · → `{brushes:[name],count}`
`{"action":"list_brushes","params":{"filter":"basic","limit":10}}`

**`stroke`** · `points`=[[x,y],…] (≥2), `size`=last set size (default 20),
`hardness`=0.5 (0–1), `opacity`=1.0 (0–1), `pressure`=1.0 · → `{points_count,hardness,clipped_by_selection?}`
Stamps soft circles along the polyline in the foreground color. If `hardness` is
omitted, `pressure` is used as hardness. Coordinates are document pixels.
`{"action":"stroke","params":{"points":[[120,200],[240,180],[310,260]],"size":6,"hardness":0.9,"opacity":1}}`

**`fill`** · `x`, `y`, `radius`=50 · → `{x,y,radius}`
Hard-edged filled **circle** in the foreground color (not a flood fill).
`{"action":"fill","params":{"x":400,"y":300,"radius":120}}`

**`draw_shape`** · `shape`=rectangle|ellipse|line, `x`, `y`, `width`=100,
`height`=100, `fill`=true, `stroke`=false, `x2`?, `y2`?, `line_width`=2 · →
`{shape,clipped_by_selection?}`
Hard-edged, writes alpha 255 (overwrites, no alpha blending). `line` uses
`x2`/`y2` (defaults `x+width`, `y+height`). `ellipse` fits the x/y/w/h box.
`{"action":"draw_shape","params":{"shape":"rectangle","x":40,"y":40,"width":300,"height":200,"fill":false,"stroke":true}}`

**`get_current_color`** · — · → `{foreground,background}` (hex)
`{"action":"get_current_color"}`

**`get_current_brush`** · — · → `{preset,size,opacity}`
`{"action":"get_current_brush"}`

Painting notes:

- All paint writes are raw `Node.setPixelData` on the active layer; selections do
  not mask them. The `clipped_by_selection` field is informational only. For
  masked painting, fill the selection with the
  `fill_selection_foreground_color` QAction, or composite a mask in `py`.
- Pixel writes ignore layer alpha-lock/inherit-alpha and are not color-managed
  beyond the document color space. Expect hard edges; refine with soft
  `stroke` (hardness 0–0.4) and many short segments.
- Layer must be paintable (paintlayer, fill/transparency masks) — groups, file
  layers, clone layers silently reject `setPixelData` **(verify)**.

## Layers

**`list_layers`** · — · → `{layers:[{name,type,visible,opacity,locked}],count}`
Recursive, bottom-to-top order; `opacity` is reported normalized ~0–1.
`{"action":"list_layers"}`

**`create_layer`** · `name`="New Layer", `layer_type`="paintlayer" · → `{name,type}`
Node types: `paintlayer`, `grouplayer`, `vectorlayer`, `filllayer`,
`filterlayer`, `clonelayer`, `filelayer`, `transparencymask`, `filtermask`,
`transformmask`, `selectionmask`. The new layer is added on top and **becomes the
active layer** (live-verified). `delete_layer`/`select_layer` afterwards.
`{"action":"create_layer","params":{"name":"lineart","layer_type":"paintlayer"}}`

**`select_layer`** · `name` (first exact match anywhere in the tree) · → `{name}`
`{"action":"select_layer","params":{"name":"lineart"}}`

**`delete_layer`** · `name` · → `{name}`
`{"action":"delete_layer","params":{"name":"scratch"}}`

**`rename_layer`** · `old_name`, `new_name` · → `{old_name,new_name}`
`{"action":"rename_layer","params":{"old_name":"Layer 2","new_name":"shading"}}`

**`set_layer_opacity`** · `name`, `opacity` 0.0–1.0 · → `{name,opacity}`
**Bug**: the bridge passes 0.0–1.0 to `Node.setOpacity(value: int)`, which takes
0–255 (live-verified signature), so a requested 0.35 may become an almost
invisible layer. Verify with `list_layers`; prefer `py`:
`layer.setOpacity(int(op*255))`.
`{"action":"set_layer_opacity","params":{"name":"shading","opacity":0.35}}`

**`set_layer_visibility`** · `name`, `visible`=true · → `{name,visible}`
`{"action":"set_layer_visibility","params":{"name":"grid","visible":false}}`

**`layer`** · `op`=duplicate|merge_down|flatten|group|ungroup|blend|move,
`name` (default active layer), `mode`, `x`, `y`, `direction` · → op-specific
Live-verified mapping (see `krita-plugin/README.md`):

- `duplicate` · → `{op,name}` via `Node.duplicate()` (inserted above the source).
- `merge_down` · → `{op,name}` via `Node.mergeDown()` (needs a visible layer below).
- `flatten` · → `{op,via}` via `Document.flatten()` (or the `flatten_image` QAction
  fallback). Destructive; not tested on modified documents.
- `group` · → `{op,via:"action:create_quick_group",grouped,group}` — sets the node
  active, then triggers Krita's Quick Group QAction.
- `ungroup` · → `{op,via:"action:quick_ungroup"}` (QAction fallback).
- `blend` · → `{op,mode,requested}` via `Node.setBlendingMode()`; use Krita ids
  `normal,multiply,screen,overlay,darken,lighten,hard_light,soft_light,
  difference,exclusion,hue,saturation,color,luminosity,dodge,burn,plus,minus,
  divide,erase,behind,destination-in,xor`. Aliases `addition`→`plus`,
  `subtract`→`minus` work. Prefer `dodge`/`burn` over `color dodge`/`color burn`
  (the bridge maps the latter to `color_dodge`/`color_burn`, which may not be a
  valid Krita id) **(verify)**.
- `move` · `x`,`y` → `{op,name,x,y}` pixel offset via `Node.move(x,y)`; or
  `direction:"up"|"down"` → `{op,name,via}` via `move_layer_up`/`move_layer_down`.
  Stack reordering with `parent`/`index` has no libkis API → `UNSUPPORTED`.
`{"action":"layer","params":{"op":"blend","name":"shading","mode":"multiply"}}`
`{"action":"layer","params":{"op":"group","name":"shade"}}`
`{"action":"layer","params":{"op":"move","name":"lineart","direction":"up"}}`

## Selection

Live-verified on Krita 5.3.4.1: the libkis Selection wrapper has
`select`, `selectAll`, `pixelData`, `setPixelData`, `clear`, `invert`, `grow`,
`shrink`, `border`, `feather`, `smooth`, `contract`, `move`, `resize`, `add`,
`subtract`, `intersect`, `replace`, `copy`, `cut`, `paste`, `x/y/width/height` —
but **no** `selectEllipse`, `selectPolygon`, `bounds`, `transform` or
`pixelSelected`.

- Working: `select_rect`/`select_area` (create the selection if none exists),
  `selection_info`, `selection_stats`, `grow_selection`, `border_selection`,
  `load_selection`, `save_selection`, `clear_selection`, `invert_selection`,
  `select_by_color`, `select_by_alpha`, `deselect`, `load_selection_channel`,
  `delete_selection_channel`.
- Unsupported/broken: `select_ellipse`, `select_polygon` (`supported:false`),
  `shrink_selection` (5.3 requires `shrink(x,y,edgeLock)`),
  `transform_selection`, `combine_selections`, `fill_selection`,
  `save_selection_channel`, `list_selection_channels`.

For any shaped or soft mask use a `py` mask: build a tightly packed `w*h` byte
mask (255 = selected), `Selection.setPixelData`, `doc.setSelection`,
`refreshProjection`. See `python.md` recipes 5–6.

Selection state is document-global and persists until replaced or deselected.
Call `deselect` first when you want a fresh selection.

**`select_rect`** / **`select_area`** · `x`, `y`, `width`, `height` (x,y≥0,
w,h≥1, required) · → `{x,y,width,height}`
Creates a selection when none is active and commits it.
`{"action":"select_rect","params":{"x":100,"y":80,"width":400,"height":300}}`

**`select_ellipse`** · `cx`, `cy`, `rx`, `ry` · → `{cx,cy,rx,ry}`
**Unsupported on 5.3.4.1**: Selection has no `selectEllipse`; returns
`{status:"error",supported:false,...}` (live-verified capability gate).
Use a `py` QImage mask.
`{"action":"select_ellipse","params":{"cx":400,"cy":300,"rx":120,"ry":80}}`

**`select_polygon`** · `points`=[[x,y],…] (≥3) · → `{points}`
**Unsupported on 5.3.4.1** (no `selectPolygon`); same workaround.
`{"action":"select_polygon","params":{"points":[[100,100],[300,120],[250,320],[120,280]]}}`

**`selection_info`** · — · → `{has_selection,bounds:{x,y,width,height}|null}`
`bounds` comes from `x()/y()/width()/height()` (the selection mask extent), with
a `bounds()` fallback for newer builds.
`{"action":"selection_info"}`

**`selection_stats`** · — · → `{has_selection,pixel_count,area_percentage,centroid,bounds}`
Works: reads the 1-byte-per-pixel mask (BGRA fallback) and computes count,
centroid and bbox. O(width×height) Python loop — slow on large canvases.
`{"action":"selection_stats"}`

**`clear_selection`** · — · → `{}`
Empties the current selection mask (nothing selected); it does **not** erase
pixels. To erase selection contents use the `edit_cut` QAction or `py` with
`selection.cut(layer)`.
`{"action":"clear_selection"}`

**`invert_selection`** · — · → `{}`
`{"action":"invert_selection"}`

**`fill_selection`** · — · → `{}`
**Broken on 5.3.4.1**: `Document.fillSelection` does not exist (live-verified).
Use the QAction instead (fills the selection with the current foreground color):

```json
{"action":"action","params":{"id":"fill_selection_foreground_color"}}
```

`fill_selection_background_color` and `fill_selection_foreground_color_opacity`
are also available. `{"action":"fill_selection"}` → `INTERNAL_ERROR`.

**`deselect`** · — · → `{}`
`{"action":"deselect"}`

**`select_by_color`** · `tolerance`=0.1 (0–1), `contiguous`=true, `x`, `y`
(optional sample point; without one the current foreground color is the target)
· → `{selected_count,method,tolerance}`
Per-pixel Python loop — very slow above ~1 MP; prefer a `py` mask.
`{"action":"select_by_color","params":{"x":200,"y":200,"tolerance":0.15,"contiguous":true}}`

**`select_by_alpha`** · `min_alpha`=1, `max_alpha`=255 · → `{selected_count,min_alpha,max_alpha}`
Also O(pixels).
`{"action":"select_by_alpha","params":{"min_alpha":1,"max_alpha":255}}`

**`grow_selection`** / **`border_selection`** · `pixels`=1 · → `{pixels}`
Work: the bridge calls the two-radius form (`grow(p,p)` / `border(p,p)`) with a
one-arg fallback and commits the result.
`{"action":"grow_selection","params":{"pixels":4}}`

**`shrink_selection`** · `pixels`=1 · → `{pixels}`
**Still broken**: 5.3 needs `shrink(xRadius,yRadius,edgeLock)`; the bridge's
2-arg call raises `TypeError` → `INTERNAL_ERROR`. Use `py`:
`sel.shrink(4,4,True)`.
`{"action":"shrink_selection","params":{"pixels":4}}`

**`combine_selections`** · `operation`=union|intersect|subtract, `mask_path`
(PNG mask, brightness >127 = selected) · → `{operation,mask_path,selected_count}`
**Broken**: uses `selection.pixelSelected()` (absent) → `INTERNAL_ERROR`.
Combine masks in `py` with bytes/`Selection.setPixelData`.
`{"action":"combine_selections","params":{"operation":"intersect","mask_path":"C:/art/mask.png"}}`

**`transform_selection`** · `dx`=0, `dy`=0, `angle`=0.0 (degrees), `scale_x`=1.0,
`scale_y`=1.0 · → `{dx,dy,angle,scale_x,scale_y}`
**Broken**: `Selection.transform` does not exist (live-verified) →
`"Transform not supported"`. Transform the mask bytes in `py` (QImage/QTransform)
and reload with `setPixelData`.
`{"action":"transform_selection","params":{"dx":40,"dy":-20,"angle":5,"scale_x":1.1,"scale_y":1.1}}`

**`save_selection`** · `path`, `format`="png" · → `{path,format,pixel_count}`
Works: converts the selection mask (1 byte/pixel, BGRA fallback) into a grayscale
PNG, threshold >0. O(width×height) Python loops — slow on large canvases.
`{"action":"save_selection","params":{"path":"C:/art/sel.png"}}`

**`load_selection`** · `path` · → `{path,loaded_pixels}`
Works: loads a mask image and selects every pixel with brightness >127 (soft
edges are quantized). Slow: one `select()` call per pixel.
`{"action":"load_selection","params":{"path":"C:/art/sel.png"}}`

**`save_selection_channel`** · `name` · → `{channel,message}`
**Broken**: needs `selection.bounds()` (absent) and calls 2-argument
`setAnnotation` where 5.3 requires `setAnnotation(type, description, data)`
(live-verified signatures). Write the annotation yourself in `py`.
`{"action":"save_selection_channel","params":{"name":"head"}}`

**`load_selection_channel`** · `name` · → `{channel,message}`
Reads `doc.annotation(type)` (single-arg API, verified) and restores a
**rectangle equal to the stored bounds**, not the original shape.
`{"action":"load_selection_channel","params":{"name":"head"}}`

**`list_selection_channels`** · — · → `{channels:[{name,bounds}],count}`
**Broken**: uses `doc.annotations()`; 5.3 only has `annotationTypes()`
(live-verified) → `INTERNAL_ERROR`. List `doc.annotationTypes()` in `py`.
`{"action":"list_selection_channels"}`

**`delete_selection_channel`** · `name` · → `{channel,message}`
`{"action":"delete_selection_channel","params":{"name":"head"}}`

## Filters (`filters` / `filter_config` / `filter`, non-interactive)

**`filters`** · `q`="", `limit`=100 (max 1000) · → `{total,filters:[{name}]}`
Live-verified: 52 filters on this build, names are libkis **internal lowercase
ids** (`blur`, `gaussian blur`, `lens blur`, `motion blur`, `invert`, `levels`,
`unsharp`, …), not display names.
`{"action":"filters","params":{"q":"blur"}}`

**`filter_config`** · `name` (internal id from `filters`) ·
→ `{name,properties:{...}}`
Returns the filter's editable InfoObject properties without applying it. Use the
exact keys/types in `filter.config`. Live-verified examples:
- `blur` → `{halfHeight,halfWidth,lockAspect,rotate,shape,strength}`
- `hsvadjustment` → `{colorize,compatibilityMode,h,s,type,v}`
- `noise` → `{grayscale,level,opacity,seedBlue,seedGreen,seedRed,seedThreshold}`
Some filters cannot expose a config on 5.3 (e.g. `halftone`) → `UNSUPPORTED`.
`{"action":"filter_config","params":{"name":"blur"}}`

**`filter`** · `name`, `layer` (optional; default active layer), `x`=0, `y`=0,
`w`, `h` (default: whole document from x/y), `config` (object), `seed` (int) ·
→ `{name,layer,bounds,signature,configured,config,result}`
Applies one filter to one layer without a dialog. Live-verified:
`Filter.apply(node,x,y,w,h)`; configured blur softens an edge and
`hsvadjustment {"h":120}` turns red into green. The bridge keeps the
`InfoObject` alive (bounded) because Krita stores a raw pointer.
Errors: `FILTER_NOT_FOUND`, `FILTER_CONFIG_FAILED`, `FILTER_FAILED`,
`UNSUPPORTED`, `INVALID_PARAMETERS`.
`{"action":"filter","params":{"name":"blur","layer":"bg","x":0,"y":0,"w":1600,"h":1000}}`
`{"action":"filter","params":{"name":"blur","config":{"halfWidth":18,"halfHeight":18,"strength":100}}}`
`{"action":"filter","params":{"name":"hsvadjustment","config":{"h":120}}}`

## QActions (`actions` / `action`)

**`actions`** · `q`="", `limit`=100 (max 1000) · → `{total,actions:[{id,text,shortcut}]}`
Live-verified: 688 QActions on this build; `text` is **localized** (Chinese on
this install), ids stay English. Matching is a case-insensitive substring on id
or text; the cache is built at first use. Search by an English id fragment. See
`actions.md` for curated ids.
`{"action":"actions","params":{"q":"edit_undo"}}`

**`action`** · `id` · → `{id}`
Triggers the QAction (exact id, case-insensitive; falls back to exact text).
Dialog actions only fire — they are never awaited, and a modal dialog blocks
Krita until the user closes it. Errors: `ACTION_NOT_FOUND`, `ACTION_FAILED`.
`{"action":"action","params":{"id":"edit_undo"}}`

## Python escape hatch (`py`)

**`py`** · `code` (short snippet) **or** `file` (path to a UTF-8 `.py`),
`mode`="exec" (`exec`|`eval`), `capture`=true ·
→ `{stdout,truncated,repr,result?,repr_truncated?}`
- **Prefer `file` for long scripts / many quotes/braces.** Write the `.py` with
  the normal `write` tool, then pass only the path. This keeps the tool-call JSON
  short and prevents malformed-JSON run failures (the model does not need to
  escape the whole script). `file` and `code` are mutually exclusive; `__file__`
  is bound to the path. Missing file → `PY_FILE_NOT_FOUND`.
- `exec`: statements; `result` omitted; `repr` is `""`.
- `eval`: expression; `result` present only if JSON-serializable, plus `repr`.
- Namespace persists across calls for the Krita session.
- Pre-bound: `app` (`Krita.instance()`), `doc`, `window`, `view`, `layer`
  (active node), `selection`, plus `krita`, `Krita`, `Document`, `InfoObject`,
  `Node`, `Selection`, `ManagedColor`, `QColor`, `QImage`, `QPoint`, `QPointF`,
  `QRect`, `QTransform`, `QPolygon`.
- `stdout` is captured only while the code runs; cap 64 KB, `repr` 8 KB,
  traceback 8 KB. On error: `{error:{code:"PYTHON_ERROR",message:"Type: msg\n\n<traceback>"},stdout,truncated}`.
- Runs on Krita's main thread. **Any blocking call wedges Krita**: a modal save
  prompt (`doc.close()` on a modified document, `doc.saveAs` with dialogs),
  flatten/merge on a modified document, a `QFileDialog`/message box, or `time.sleep`
  will hold the GIL and stop the whole bridge (live-confirmed). Use host
  `doc_save` / `doc_close {save:true}` for document lifecycle, and never open UI
  from `py`. If Krita wedges, the user must close and reopen it (unsaved work is lost).
`{"action":"py","params":{"mode":"eval","code":"[d.name() for d in app.documents()]"}}`
`{"action":"py","params":{"file":"D:/krita-scripts/gradient.py"}}`

## Resources

**`resources`** · `type`=preset|pattern|gradient|palette|symbol|workspace (default
`preset`), `q`="", `limit`=50 (max 1000) · → `{type,total,resources:[{name}]}`
Live-verified totals on this install: preset 144, gradient 19, symbol 0 (accepted,
empty — the build has no symbol resources). Resource names can be localized.
`{"action":"resources","params":{"type":"gradient","q":"warm","limit":20}}`

## Meta and security

**`get_capabilities`** · — · → `{capabilities:{select_ellipse,select_polygon,selection_bounds,krita_version},selection_tools:[],unsupported_apis}`
Live-verified on 5.3.4.1: `select_ellipse` and `select_polygon` are `false`
(APIs absent), `selection_bounds` is `true` (via `Selection.x/y/width/height`),
and `unsupported_apis` explains the two false entries. This is how you can check
whether this install supports the ellipse/polygon actions.
`{"action":"get_capabilities"}`

**`get_security_status`** · — · → `{rate_limit:{max_commands_per_minute,window_seconds,current_usage},payload_limit,batch_size_limit,max_canvas_dim,max_layers}`
`{"action":"get_security_status"}`

## Raw-bridge actions (not for normal tool use)

**`batch`** · `commands` (1–50), `stop_on_error`=false · → `{status,count,results:[{action,status,result|error}],batch_id?}`
Takes a PNG snapshot of the document before running, then executes sequentially.
Use it only when you need the snapshot/rollback pair; for normal work the tool's
implicit batching is enough. Rejected inside `seq`, so it only works as a lone
command.
`{"action":"batch","params":{"commands":[{"action":"set_color","params":{"color":"#fff"}},{"action":"fill","params":{"x":10,"y":10,"radius":5}}]}}`

**`rollback`** · `batch_id` · → `{message}`
Restores the pre-batch image as a new layer `Rollback_<id8>` on top; original
layers remain underneath. Fails if the canvas size changed or the snapshot is
gone (snapshots are in-memory/on disk under `~/…`, lost when Krita restarts).
`{"action":"rollback","params":{"batch_id":"..."}}`

**`seq`** (bridge-internal) · `commands` (1–64), `stop_on_error`=false ·
→ `{status:"ok"|"error"|"partial",count,results:[{action,status:"ok",result:{...}}|{action,status:"error",error:{...}}]}`
The host generates this for any call with 2+ bridge commands. Nested
`seq`/`batch`/`rollback` produce per-item `NESTED_NOT_ALLOWED`.

## Error codes

| code | meaning / fix |
|---|---|
| `NO_ACTIVE_DOCUMENT` | no document open or active; `new_canvas`/`open_file`/`doc_activate` |
| `NO_ACTIVE_LAYER` | document has no active node; `list_layers` + `select_layer` |
| `NO_ACTIVE_VIEW` | no Krita window/view (headless state); restart or `start` |
| `LAYER_NOT_FOUND` | `select_layer`/`delete_layer`/`filter`/`layer` name mismatch (exact, case-sensitive) |
| `BRUSH_NOT_FOUND` | `set_brush.preset` substring matched nothing — `list_brushes` first |
| `INVALID_PARAMETERS` | missing/out-of-range param; often bad hex color, w/h ≤ 0, unknown op |
| `INVALID_SHAPE` | `draw_shape.shape` not rectangle/ellipse/line |
| `CANVAS_TOO_LARGE` | > 8192×8192 or > 8192² pixels for `clear` |
| `PATH_TRAVERSAL_BLOCKED` | `save`/`open_file` path contains `..` |
| `FILE_NOT_FOUND` | `open_file`/mask path missing |
| `ACTION_NOT_FOUND` / `ACTION_FAILED` | QAction id wrong or trigger raised — search `actions` |
| `FILTER_CONFIG_FAILED` | `filter_config` property name/type wrong or filter cannot be configured — inspect with `filter_config`, use valid values |
| `FILTER_FAILED` | filter ran but reported failure / invalid layer type — duplicate the layer, apply with defaults, or use `py` |
| `UNSUPPORTED` | optional API absent on this Krita build (e.g. filter config unavailable) — use `py` |
| `FILTER_NOT_FOUND` | filter name not in `filters` list |
| `RATE_LIMIT_EXCEEDED` | HTTP 429; default 600 requests/min/proc — wait or raise `max_commands_per_minute` |
| `PAYLOAD_TOO_LARGE` | request > 10 MB (mostly huge `py` code or point lists) |
| `BATCH_SIZE_EXCEEDED` / `SEQUENCE_TOO_LARGE` | more than 50 (batch) / 64 (seq) sub-commands |
| `NESTED_NOT_ALLOWED` | `seq`/`batch`/`rollback` inside `seq` |
| `LAYER_LIMIT_EXCEEDED` | 100 nodes per document |
| `COMMAND_TIMEOUT` | Krita did not answer in 120 s (bridge queue) |
| `PYTHON_ERROR` | traceback in `error.message`; fix and re-run |
| `SAVE_FAILED` / `CLOSE_FAILED` | `doc_save`/`doc_close` refused, export wrote no file, or path/permission problem |
| `UNSAVED_CHANGES` | `doc_close` refused because the document is modified; `doc_save` first or pass `save:true` |
| `INVALID_PARAMS` | channel-name variant of `INVALID_PARAMETERS` (same fix) |
| `ROLLBACK_NOT_POSSIBLE` / `BATCH_NOT_FOUND` | snapshot missing or canvas resized |
| `UNSUPPORTED` | optional API absent on this Krita build; use `py` |
| `BRIDGE_UNREACHABLE` / `BRIDGE_TIMEOUT` | host-side: bridge not listening / request timeout |

## Limits (defaults, 1.1.0)

| limit | value |
|---|---|
| tool commands per call | 32 (host), bridge `seq` accepts 64 |
| bridge `batch` commands | 50 |
| rate limit | 600 bridge requests/min; HTTP 429 |
| payload | 10 MB |
| canvas | 8192×8192 |
| layers per document | 100 |
| `py` stdout / repr / traceback | 64 KB / 8 KB / 8 KB |
| tool result JSON | 16000 chars, then truncated |
| bridge request timeout | 30 s default tool; 120 s internal queue; 600 s tool max |

## Known limitations of the 1.1.0 vendored bridge (live-verified on 5.3.4.1)

1. `set_layer_opacity` 0–1 vs `Node.setOpacity` 0–255: the scale is not
   normalized; use `py` `layer.setOpacity(int(op*255))` when opacity matters.
2. `select_ellipse` / `select_polygon` report `supported:false` — Krita 5.3's
   `Selection` has no `selectEllipse`/`selectPolygon`. Use a `py` QImage mask.
3. `shrink_selection` needs a third `edgeLock` argument in 5.3 → `INTERNAL_ERROR`;
   use `py` `sel.shrink(px,px,True)`. `grow_selection`/`border_selection` work.
4. `transform_selection` needs `Selection.transform()`, which 5.3.4.1 does not
   expose → `"Transform not supported"`.
5. `combine_selections` needs `Selection.pixelSelected()`, absent in 5.3.4.1.
6. `fill_selection` needs `Document.fillSelection()`, absent in 5.3.4.1. Use the
   `fill_selection_foreground_color` QAction.
7. Selection channels: `save_selection_channel` needs missing `bounds()` plus a
   3-arg `setAnnotation`; `list_selection_channels` uses `doc.annotations()`.
   `load/delete_selection_channel` work but restore only a bounding rectangle.
8. Filter `config`/`seed` is supported: read the real property names with
   `filter_config` first, then pass `config`. Some filters have no readable
   config (e.g. `halftone` → `UNSUPPORTED`); invalid values fail with
   `FILTER_CONFIG_FAILED`/`FILTER_FAILED`. Configured blur and HSV adjustment are
   live-verified. The bridge keeps the InfoObject alive to dodge Krita's
   `setConfiguration` GC bug.
9. `set_brush.opacity` is stored but never applied; pass `opacity` to `stroke`.
10. `stroke`/`fill`/`draw_shape`/`clear` write raw pixels: selections do not clip
    them and undo may not cover them.
11. `resources` accepts `symbol`; this build returns an empty list. Resource
    names can be localized.
12. `selection_stats`, `save_selection`, `load_selection` and `select_by_color`/
    `select_by_alpha` are O(width×height) Python loops — slow on large canvases.

The reliable escape hatch for every item above is the `py` action
(`references/python.md`).
