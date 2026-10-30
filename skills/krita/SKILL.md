---
name: krita
description: "Draw, paint, sketch, color, and edit artwork in the running Krita 5.3 desktop app (Krita 画画/绘画, digital painting, lineart, layers, selections, filters, export) through one `krita` tool; includes the action reference and painting workflow."
whenToUse: "Use when the user asks to draw or edit Krita artwork (sketch, lineart, flat color, shading, highlights, text/vector, animation frames), manage Krita documents/layers/selections, apply Krita filters, trigger Krita menu actions, or run Krita Python. Not for editing non-Krita images; use the built-in image tools for that."
---

# Krita

Draw and edit in the running Krita desktop app through one tool:
`krita({commands:[{action, params}, ...], timeoutMs?})`.

## Critical constraints

- **Krita must be running with the DSH Krita Bridge.** First call `status`. If
  down: `start` when Krita is closed, `setup` when the plugin is missing.
  `setup` needs a Krita restart — never restart or close Krita yourself if the
  user may have unsaved work; ask.
- **Never overwrite a user's existing `.kra`.** `doc_save` to a new versioned
  path; PNG export (`save`, `get_canvas`) never touches the original.
- **Always preview with `get_canvas` + `read_image` before claiming a pass is
  good.** Coordinates and canvas state are not visible to you otherwise.
- **Never dump pixel data or long lists into the conversation.** Ask for counts,
  sample a few values, or use `limit`/`q` filters.
- **Raw pixel writes:** `stroke`/`fill`/`draw_shape`/`clear` bypass selections
  and may not be undoable. Keep passes on separate layers, save versions, verify
  `undo` with an export, and never apply destructive ops to a layer's only copy.
- **Never make a blocking libkis call in `py`.** `doc.close()`, a save/export
  call that opens a dialog, flatten/merge on a modified document, or any modal
  UI call can wedge Krita's main thread and stop the whole bridge (the GIL stays
  held; unsaved work may be lost). Use host `doc_save` / `doc_close {save:true}`
  instead, and if the bridge wedges the user must close and reopen Krita.
- **Keep `py` tool-call JSON short.** For anything beyond a short snippet, or any
  script with many quotes/braces, write a `.py` file with the normal `write` tool
  and call `py` with `{"file":"<path>"}`. Long inline `code` is what makes the
  model emit malformed JSON and kills the entire run before the tool executes.
- **5.3.4.1 quirks:** `select_ellipse`/`select_polygon`, `shrink_selection`,
  `transform_selection`, `combine_selections`, `fill_selection` and the selection
  channels are broken; use `py` masks, `grow_selection`/`border_selection`, and
  the `fill_selection_foreground_color` QAction.
- **Filter configs work**: call `filter_config` first, then pass a `config`
  object with those exact property names (`blur`: `halfWidth`/`halfHeight`/
  `strength`; `hsvadjustment`: `h`/`s`/`v`; both live-verified). Some filters
  expose no config on 5.3 (e.g. `halftone`) and return `UNSUPPORTED`; invalid
  names/values fail with `FILTER_CONFIG_FAILED`/`FILTER_FAILED`.
- `save`/`get_canvas` can still report a path that looks fine while the image is
  wrong or empty; confirm every export with `read_image`.

## How calls behave

- 1–32 commands per call; **3–10 is the sweet spot**. Commands run in order in
  one bridge round trip, so batch a whole painting pass.
- Result: `{"ok":true,"results":[{"action":"stroke","ok":true,...}, ...]}`;
  failures are `{"action":"fill","ok":false,"error":"...","code":"..."}`. If the
  bridge request dies the remaining commands are skipped (`skipped`).
- `timeoutMs`: 30000 default, 600000 max. Use 120000 for exports, filters,
  selection scans and `py` pixel loops. `status`/`start`/`setup` are host actions.
- The tool batches automatically. Don't send `seq`; `batch`/`rollback` only when
  you specifically need snapshot+rollback semantics (raw-bridge only).

## Connect and set up

```json
{"commands":[{"action":"status"}]}
```
- `status.ok:true` → bridge is live; the `info` field has the active document,
  layer, foreground color and brush.
- `status.ok:false, krita_running:true` → run `{"action":"setup"}`, then ask the
  user to restart Krita once; call `status` again.
- `status.ok:false, krita_running:false` → `{"action":"start"}`, then `status`.

## First canvas

```json
{"commands":[
  {"action":"new_canvas","params":{"width":1200,"height":800,"name":"study","background":"#f4f1ea"}},
  {"action":"create_layer","params":{"name":"sketch"}},
  {"action":"set_color","params":{"color":"#2c2c34"}},
  {"action":"stroke","params":{"points":[[300,420],[520,360],[700,430]],"size":5,"hardness":0.8}},
  {"action":"get_canvas","params":{"filename":"first.png"}}
]}
```
Then `read_image` the returned `path`. `create_layer` adds the layer on top and
it becomes active (live-verified); use `select_layer` to switch to existing layers.

## Core workflow

1. **Reference first.** `read_image` any supplied image; note palette,
   proportions, composition, then decide canvas size and layer plan.
2. **Canvas + layers.** `new_canvas`, then one layer per job: `bg`, `sketch`,
   `lineart`, `flat`, `shade`, `highlight`. Name them; you will switch by name.
3. **Block in.** 2–4 broad strokes (`stroke` with large `size`, low `hardness`,
   low `opacity`). Check the silhouette with an export.
4. **Sketch.** Many short strokes on the `sketch` layer; batch 6–12 per call.
   Correct by deleting/redrawing the layer rather than overpainting.
5. **Refine / lineart.** New layer on top, smaller `size`, `hardness` 0.9–1.
6. **Flat color.** Select a region (`select_rect`, or a `py` mask), `set_color`,
   then trigger the `fill_selection_foreground_color` QAction (`fill_selection`
   itself is broken on 5.3.4.1); `deselect` when done. Small blobs can use
   `fill` (circle) directly.
7. **Shade + highlight.** Duplicate/new layers, `layer` op `blend` (`multiply`
   for shade, `screen`/`overlay` for light), lower opacity, soft strokes.
8. **Review loop.** `get_canvas` with a numbered filename → `read_image` →
   change one thing → export again. Export only when you will actually look.
9. **Save + report.** `doc_save` a versioned `.kra` for a milestone; `save` a PNG
   for the user; never overwrite their original. Report what changed, which
   layers, and where the final file is.

## Action cheat sheet (most used)

| action | essential params | use |
|---|---|---|
| `status` | — | is the bridge up / what is active |
| `new_canvas` | `width`, `height`, `name`, `background` | new document (RGBA/U8, max 8192) |
| `open_file` / `docs` / `doc_activate` | `path` / — / `index`\|`name` | documents |
| `doc_save` | `path` (`.kra`) | native versioned save |
| `get_canvas` | `filename` | export preview PNG, returns path |
| `save` | `path` | export PNG/JPG anywhere |
| `info` | — | versions, active doc/layer/color/brush |
| `list_layers` | — | names, types, visibility, opacity |
| `create_layer` / `select_layer` | `name`, `layer_type`="paintlayer" / `name` | layer setup |
| `set_layer_opacity` / `set_layer_visibility` | `name`, `opacity` 0–1 / `visible` | layer state |
| `delete_layer` / `rename_layer` | `name` / `old_name`,`new_name` | layer lifecycle |
| `set_color` | `color`="#rrggbb" | foreground color |
| `set_brush` | `preset` (substring), `size` | brush size/preset |
| `stroke` | `points`=[[x,y],…], `size`, `hardness` 0–1, `opacity` 0–1 | paint lines |
| `fill` | `x`, `y`, `radius` | filled circle (not flood fill) |
| `draw_shape` | `shape`, `x`,`y`,`width`,`height`,`fill`,`stroke` | hard rectangles/ellipses/lines |
| `select_rect` / `action` | `x,y,width,height` / `id:"fill_selection_foreground_color"` | select + fill a region |
| `filter_config` / `filter` | `name`; then `name`, `config`, `layer`, `x,y,w,h` | inspect settings; apply with defaults or `config` |
| `actions` / `action` | `q` / `id` | find/trigger any Krita menu action |
| `py` | `code` short snippet, or `file`=path to a written `.py`; `mode` | full Krita Python API |
| `undo` / `redo` | — | undo (verify it covers pixel writes) |

Full params, responses and every action: `references/protocol.md`.

## Token rules

- Batch aggressively: one call = one round trip and one result block. Three
  previews cost more than one 10-command painting call, and compact actions
  (`set_color`, `stroke`, `select_layer`) return `{}` or a few fields.
- Never paste a full `list_layers`/`actions`/`resources` dump; filter with
  `q`/`limit` and summarize. Filter `references/actions.md` hits too.
- Never return image bytes or pixel arrays. Save a PNG (`get_canvas`) and
  `read_image` it; if you must inspect pixels, sample 1–3 point colors with
  `get_color_at`.
- Use `py` for work that would otherwise need dozens of commands (gradient,
  mask, per-frame loop); it is one command with one short result. Load only the
  reference file you need, at the moment you need it.

## References — read on demand

| file | read when | contents |
|---|---|---|
| `references/protocol.md` | you need exact params/response/error for any action | all 66 bridge actions, 3 host actions, limits, known limitations |
| `references/recipes.md` | you are planning a painting pass | batched sketch/line/flat/shade/selection/gradient/filter/group/text/transform/animation/export recipes |
| `references/python.md` | an action is missing, broken, or you need real Krita API | libkis cheatsheet + 10 copy-paste `py` recipes |
| `references/actions.md` | you need a menu/tool/dialog that is not a bridge action | how to search/trigger QActions, curated ids per menu |
| `references/troubleshooting.md` | a call fails, times out, or Krita/bridge state is unclear | triage table, setup/restart, port/rate/timeout, traceback handling |
