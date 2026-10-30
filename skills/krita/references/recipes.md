# Krita painting recipes (batched tool calls)

Each recipe is a `krita` tool call: one `commands` array, executed in order as a
single bridge round trip. Preview after a pass, not after every command:
`get_canvas` (writes `~/krita-mcp-output/<name>.png`) then `read_image` that
path. Keep 3–10 commands per call; smaller calls cost more round trips, larger
calls are harder to debug and return more JSON.

Conventions used below:

- Canvas coordinates are document pixels. Decide the composition first and
  write coordinates down; guessing per command wastes calls.
- Work on named layers. `create_layer` puts the new layer on top and it becomes
  active (live-verified); still call `select_layer` when moving to an existing
  layer or after any doubt about the active node.
- `stroke` paints the current foreground color; `set_color` first.
- Soft = low `hardness` (0–0.35) + large `size`; hard = `hardness` 0.85–1.
- The pipeline that keeps quality high: **block-in → lineart → flat → shade →
  highlight → review → fix → final**. Never skip the review exports.

## 1. Start a document and block in the pose

```json
{"commands":[
  {"action":"new_canvas","params":{"width":1600,"height":1000,"name":"study","background":"#f3efe6"}},
  {"action":"create_layer","params":{"name":"bg wash","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"bg wash"}},
  {"action":"set_color","params":{"color":"#e8dfcc"}},
  {"action":"stroke","params":{"points":[[0,120],[400,80],[900,130],[1300,90],[1600,140]],"size":220,"hardness":0.15,"opacity":0.5}},
  {"action":"create_layer","params":{"name":"blockin","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"blockin"}},
  {"action":"set_brush","params":{"size":42}},
  {"action":"set_color","params":{"color":"#6f5a4d"}},
  {"action":"stroke","params":{"points":[[520,300],[600,280],[700,320],[760,420],[740,560],[660,650],[560,620],[500,500],[520,300]],"size":34,"hardness":0.35}}
]}
```

Block-in goals: silhouette, big proportions, no detail. Use 15–40 points per
stroke and 2–4 strokes per call, not 100.

## 2. Sketch pass (loose underdrawing)

```json
{"commands":[
  {"action":"create_layer","params":{"name":"sketch","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"sketch"}},
  {"action":"set_color","params":{"color":"#3a3a46"}},
  {"action":"stroke","params":{"points":[[420,260],[520,240],[620,250],[700,300]],"size":5,"hardness":0.7,"opacity":0.7}},
  {"action":"stroke","params":{"points":[[500,420],[560,400],[640,430],[690,500],[650,590]],"size":5,"hardness":0.7,"opacity":0.7}},
  {"action":"stroke","params":{"points":[[430,300],[400,420],[410,540],[440,640]],"size":5,"hardness":0.7,"opacity":0.7}}
]}
```

Sketch loops are where batching pays: put 6–12 short strokes in one call after
the coordinates are decided. Re-check with an export before committing.

## 3. Lineart / refine

```json
{"commands":[
  {"action":"create_layer","params":{"name":"lineart","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"lineart"}},
  {"action":"set_color","params":{"color":"#20202a"}},
  {"action":"set_brush","params":{"size":4}},
  {"action":"stroke","params":{"points":[[418,262],[470,250],[520,244],[580,246],[630,255],[690,292]],"size":4,"hardness":0.95}},
  {"action":"stroke","params":{"points":[[505,415],[545,402],[590,408],[640,432],[676,486],[668,552],[638,596]],"size":4,"hardness":0.95}}
]}
```

- Line weight varies with `size`; opacity 1 for ink.
- If lineart goes wrong, delete the layer and redo it (one call: `delete_layer`
  + `create_layer` + `select_layer`), instead of hoping `undo` reverts raw pixel
  writes.
- Flat shapes can be outlined with `draw_shape` + `stroke:true` when geometry is
  regular (frames, panels, borders).

## 4. Flat color (selection + fill)

The reliable fill path is: make a selection, `set_color`, then trigger the
`fill_selection_foreground_color` QAction. (`fill_selection` itself is broken on
5.3.4.1: `Document.fillSelection` does not exist.)

```json
{"commands":[
  {"action":"create_layer","params":{"name":"flat","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"flat"}},
  {"action":"set_color","params":{"color":"#d98e73"}},
  {"action":"select_rect","params":{"x":430,"y":300,"width":330,"height":330}},
  {"action":"action","params":{"id":"fill_selection_foreground_color"}},
  {"action":"deselect"},
  {"action":"set_color","params":{"color":"#6b7fa8"}},
  {"action":"select_rect","params":{"x":440,"y":620,"width":320,"height":180}},
  {"action":"action","params":{"id":"fill_selection_foreground_color"}},
  {"action":"deselect"}
]}
```

For non-rectangular regions use a `py` mask (recipe 5 in `python.md`) or
`select_by_color`/`select_by_alpha` (slow), then the same fill QAction. For quick
rounded blobs, `fill` (circle) is cheap:

```json
{"commands":[
  {"action":"set_color","params":{"color":"#c46b5a"}},
  {"action":"fill","params":{"x":600,"y":450,"radius":140}},
  {"action":"fill","params":{"x":760,"y":450,"radius":120}}
]}
```

## 5. Shading (multiply layer, soft strokes)

```json
{"commands":[
  {"action":"create_layer","params":{"name":"shade","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"shade"}},
  {"action":"layer","params":{"op":"blend","name":"shade","mode":"multiply"}},
  {"action":"set_layer_opacity","params":{"name":"shade","opacity":0.45}},
  {"action":"set_color","params":{"color":"#8f6a92"}},
  {"action":"stroke","params":{"points":[[560,470],[600,520],[650,560],[700,590]],"size":90,"hardness":0.1,"opacity":0.6}},
  {"action":"stroke","params":{"points":[[470,340],[500,390],[540,430]],"size":70,"hardness":0.15,"opacity":0.5}}
]}
```

Rules: one shadow hue for the whole piece, multiply (or `linear_burn` for deep
shadow), 30–55% layer opacity, soft large strokes. Build shadow from the
light direction, then a second "occlusion" pass with a smaller darker brush.

If `set_layer_opacity` misbehaves (value scale), fall back to `py`:
`layer.setOpacity(115)`.

## 6. Highlight / rim light (screen or overlay layer)

```json
{"commands":[
  {"action":"create_layer","params":{"name":"highlight","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"highlight"}},
  {"action":"layer","params":{"op":"blend","name":"highlight","mode":"screen"}},
  {"action":"set_color","params":{"color":"#ffe3b0"}},
  {"action":"stroke","params":{"points":[[530,270],[590,258],[650,270],[690,300]],"size":26,"hardness":0.3,"opacity":0.85}},
  {"action":"stroke","params":{"points":[[700,430],[722,470],[720,520]],"size":18,"hardness":0.35,"opacity":0.7}}
]}
```

Keep highlights to 1–2 small areas and a consistent light source. Lower the
layer opacity to 60–80% after review with `set_layer_opacity`.

## 7. Selections and masking

Select and fill (the QAction is the working fill path on 5.3.4.1):

```json
{"commands":[
  {"action":"deselect"},
  {"action":"select_rect","params":{"x":300,"y":200,"width":500,"height":400}},
  {"action":"set_color","params":{"color":"#2f3a4a"}},
  {"action":"action","params":{"id":"fill_selection_foreground_color"}},
  {"action":"deselect"}
]}
```

Invert, then fill everything outside a region:

```json
{"commands":[
  {"action":"select_rect","params":{"x":200,"y":150,"width":600,"height":500}},
  {"action":"invert_selection"},
  {"action":"set_color","params":{"color":"#101018"}},
  {"action":"action","params":{"id":"fill_selection_foreground_color"}},
  {"action":"deselect"}
]}
```

Persist a mask to disk and reuse it. `save_selection` works on this build
(converts the 1-byte mask to a grayscale PNG, but it is O(pixels) and slow), or
dump the mask with `py` for odd masks:

```json
{"commands":[
  {"action":"select_rect","params":{"x":250,"y":180,"width":640,"height":520}},
  {"action":"py","params":{"mode":"exec","code":"from PyQt5.QtGui import QImage\nw,h=doc.width(),doc.height()\ndata=bytes(doc.selection().pixelData(0,0,w,h))\nimg=QImage(data,w,h,w,QImage.Format_Grayscale8).copy()\nimg.save('C:/art/masks/body.png','PNG')\nprint('mask saved',img.width(),img.height())"}},
  {"action":"deselect"}
]}
```

`load_selection` works (brightness >127 = selected), so reuse the file:

```json
{"commands":[
  {"action":"load_selection","params":{"path":"C:/art/masks/body.png"}},
  {"action":"set_color","params":{"color":"#9a4f43"}},
  {"action":"action","params":{"id":"fill_selection_foreground_color"}},
  {"action":"deselect"}
]}
```

Caveats (live-verified on 5.3.4.1): `grow_selection` and `border_selection` work;
`shrink_selection` needs a third `edgeLock` argument and fails — use `py`
`sel.shrink(4,4,True)`. `transform_selection`, `combine_selections`,
`fill_selection` and the selection channels are broken; do mask math and fills
with `py`/QActions. `select_ellipse`/`select_polygon` are unsupported; build a
mask with QPainter (`python.md` recipe 5).

## 8. Gradient background (py, 2 commands)

```json
{"commands":[
  {"action":"py","params":{"mode":"exec","code":"from PyQt5.QtGui import QImage, QPainter, QLinearGradient, QColor\nfrom PyQt5.QtCore import QPointF\nw,h=doc.width(),doc.height()\nimg=QImage(w,h,QImage.Format_ARGB32)\np=QPainter(img)\ng=QLinearGradient(QPointF(0,0),QPointF(w,h))\ng.setColorAt(0.0,QColor('#101a2e'))\ng.setColorAt(0.6,QColor('#354a6e'))\ng.setColorAt(1.0,QColor('#e0a86b'))\np.fillRect(0,0,w,h,g)\np.end()\nn=doc.createNode('gradient','paintlayer')\ndoc.rootNode().addChildNode(n,None)\nn.setPixelData(img.constBits().asstring(img.byteCount()),0,0,w,h)\ndoc.setActiveNode(n)\ndoc.refreshProjection()\nprint('ok')"}},
  {"action":"get_canvas","params":{"filename":"gradient_check.png"}}
]}
```

Or drop a gradient as a multiply layer over the flats for a lighting wash; keep
the gradient layer above `flat` and below `shade`.

## 9. Filter pass (non-interactive, with settings)

```json
{"commands":[
  {"action":"filters","params":{"q":"blur"}},
  {"action":"filter_config","params":{"name":"blur"}},
  {"action":"filter","params":{"name":"blur","layer":"lineart","config":{"halfWidth":4,"halfHeight":4,"strength":60}}},
  {"action":"get_canvas","params":{"filename":"after_blur.png"}}
]}
```

Rules: apply filters to a duplicate layer you can delete
(`layer` op `duplicate`), never to the only copy of lineart. Use `filters` to get
the exact internal lowercase name, then `filter_config` for the real property
names/types; pass only those keys in `config` (optional `seed` is merged into the
properties). Verified examples: `blur` softens edges with
`{"halfWidth":16,"halfHeight":16,"strength":100}`, and
`hsvadjustment {"h":120}` turns red green. Some filters cannot expose a config
on 5.3 (e.g. `halftone`) → `UNSUPPORTED`; apply those with defaults or use `py`.
Filter results are previewed only by exporting afterwards.

## 10. Layer groups and blend modes

Grouping and stacking now work through QActions. `group` groups the active layer
into a Quick Group; `move` with `direction:"up"|"down"` reorders via
`move_layer_up`/`move_layer_down`. Blend modes are safe:

```json
{"commands":[
  {"action":"select_layer","params":{"name":"shade"}},
  {"action":"layer","params":{"op":"group","name":"shade"}},
  {"action":"layer","params":{"op":"blend","name":"shade","mode":"multiply"}},
  {"action":"layer","params":{"op":"blend","name":"highlight","mode":"screen"}},
  {"action":"set_layer_visibility","params":{"name":"sketch","visible":false}},
  {"action":"get_canvas","params":{"filename":"with_lighting.png"}}
]}
```

For precise group membership (multiple layers, chosen parent), do it in `py`:

```python
g = doc.createGroupLayer("lighting")
root = doc.rootNode()
root.addChildNode(g, None)
for name in ("shade", "highlight"):
    n = doc.nodeByName(name)
    root.removeChildNode(n)
    g.addChildNode(n, None)
doc.refreshProjection()
```

`layer move` with `parent`/`index` returns `UNSUPPORTED` (no libkis stack-reorder
API); use `direction` or `py`.

Blend modes that read well: `multiply` shadows, `screen` highlights,
`overlay`/`soft light` for color washes, `normal` for lineart and flats.

## 11. Text or vector shapes (py)

```json
{"commands":[
  {"action":"py","params":{"mode":"exec","code":"w,h=doc.width(),doc.height()\nsvg='<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"%d\"><rect x=\"80\" y=\"760\" width=\"520\" height=\"160\" fill=\"#f2c14e\"/><text x=\"120\" y=\"870\" font-family=\"DejaVu Sans\" font-size=\"92\" fill=\"#222222\">Chapter 1</text></svg>'%(w,h)\nvl=doc.createVectorLayer('title')\ndoc.rootNode().addChildNode(vl,None)\nvl.addShapesFromSvg(svg)\ndoc.setActiveNode(vl)\ndoc.refreshProjection()\nprint('vector ok')"}},
  {"action":"get_canvas","params":{"filename":"title_check.png"}}
]}
```

Text stays editable as vector. If the font falls back, check with a preview and
switch `font-family` to an installed font.

## 12. Transform a painted layer (py)

```json
{"commands":[
  {"action":"py","params":{"mode":"exec","code":"n=doc.activeNode()\nd=n.duplicate()\nn.parentNode().addChildNode(d,n)\nd.setName(n.name()+'_small')\nd.scaleNode(QPointF(0,0),int(doc.width()*0.5),int(doc.height()*0.5),'Bicubic')\nd.move(120,60)\ndoc.setActiveNode(d)\ndoc.refreshProjection()\nprint('transformed')"}},
  {"action":"get_canvas","params":{"filename":"transform_check.png"}}
]}
```

`Node.move(x,y)` moves pixels; `scaleNode(origin,w,h,strategy)` and
`rotateNode(radians)` change the layer itself. For non-destructive work add a
transform mask via `doc.createTransformMask("transform")` and edit it with the
Transform tool actions **(verify)**.

## 13. Animation frames (experimental)

Krita animation scripting is thin in libkis. The practical route: make one
animated paint layer, then for each frame set the time, stamp pixels, export a
PNG, and assemble outside Krita.

```json
{"commands":[
  {"action":"layer","params":{"op":"duplicate","name":"flat"}},
  {"action":"py","params":{"mode":"exec","code":"n=doc.activeNode()\nif hasattr(n,'enableAnimation'): n.enableAnimation()\nfor f in (0,1,2,3):\n    doc.setCurrentTime(f)\n    doc.refreshProjection()\n    doc.projection().save('C:/art/frames/f%02d.png'%f)\nprint('frames',doc.currentTime())"}},
  {"action":"actions","params":{"q":"frame"}}
]}
```

Prefer QActions for frame management (`add_blank_frame`, `add_duplicate_frame`,
`next_frame`, `toggle_playback`). Painting per-frame with `stroke` only works if
raw pixel writes land on the current frame — verify frame 0 and 1 differ before
committing. Rendering a final animation needs Krita's Render Animation dialog
(`render_animation`) or an external compositor.

## 14. Export iterations and review loop

After each meaningful pass:

```json
{"commands":[
  {"action":"get_canvas","params":{"filename":"2026-10-30_04_shading.png"}},
  {"action":"info"}
]}
```

Then `read_image` the returned path. For versioned native saves:

```json
{"commands":[
  {"action":"doc_save","params":{"path":"C:/art/wip/study_04_shading.kra"}},
  {"action":"save","params":{"path":"C:/art/wip/study_04_shading.png"}},
  {"action":"info"}
]}
```

Naming: `<subject>_<pass number>_<pass name>.png`. Overwrite the same iteration
filename while fixing, and increment the number when the change is accepted.
Both `get_canvas` and `save` re-render the whole document; give them
`timeoutMs` 120000 for >4 MP canvases.

## 15. Fixing mistakes

| mistake | cheapest fix |
|---|---|
| a pass on its own layer is bad | `delete_layer` that layer, `create_layer` again — one call |
| a few strokes are wrong on a layer you keep | undo (verify it actually reverts bridge pixel writes); otherwise paint over with the layer's base color, or reload the last saved iteration |
| whole composition drifted | reopen the last versioned `.kra` via `doc_activate` (if open) or `open_file`, export a fresh working file |
| selection mask is wrong | `deselect`, rebuild; do not trust `grow_selection` on this build |
| filter wrecked a layer | filters have no preview: keep a duplicate, `delete_layer` the wrecked one |
| document unusable | save a copy if it matters, then close it from the Krita UI; the bridge refuses `doc_close {"save":false}` on modified docs (`UNSAVED_CHANGES`) to avoid a modal-dialog deadlock. Never overwrite the user's only `.kra`. |

Undo call: `{"action":"undo"}`. Redo: `{"action":"redo"}`. The bridge's pixel
writes are not guaranteed to be on Krita's undo stack, so verify with a preview
export before continuing. The legacy `batch`+`rollback` path snapshots the whole
canvas before a batch but restores it as a new layer on top and cannot be used
inside a normal batched call; versioned saves are more predictable.

Recovery pattern when reviewing an iteration:

```json
{"commands":[
  {"action":"get_canvas","params":{"filename":"check_before_fix.png"}},
  {"action":"delete_layer","params":{"name":"shade_bad"}},
  {"action":"create_layer","params":{"name":"shade","layer_type":"paintlayer"}},
  {"action":"select_layer","params":{"name":"shade"}}
]}
```
