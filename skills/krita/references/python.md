# Krita Python API cheatsheet for the `py` action

Environment: Krita 5.3.4.1, embedded Python 3.13, PyQt5. The `py` action runs
inside Krita's main thread with a namespace that persists for the Krita session.

Verified against the Krita libkis API docs (`apidoc.krita.maou-maou.fr`,
Krita 5.2/master pages) and the vendored bridge source. Items marked **(verify)**
are not confirmed on this build; test them with `eval` before relying on them in
a long `exec`.

## Calling it

```json
{"action":"py","params":{"mode":"exec","code":"print(doc.name())"}}
{"action":"py","params":{"mode":"eval","code":"[d.name() for d in app.documents()]"}}
{"action":"py","params":{"file":"D:/krita-scripts/gradient.py"}}
```

Response: `{stdout, truncated, repr, result?, repr_truncated?}`. `eval` returns
`result` only when JSON-serializable (str/int/float/bool/list/dict/None).
Tracebacks come back as `error.code = "PYTHON_ERROR"` with the full traceback in
`error.message`, plus captured `stdout`. Caps: stdout 64 KB, repr 8 KB.
Missing `file` -> `PY_FILE_NOT_FOUND`. File mode binds `__file__`.

Rules:

- This is the **full-power** escape hatch. Do only what the wrapped actions
  cannot do; keep code short and deterministic.
- **For scripts longer than a short snippet, write a `.py` file and use `file`**;
  do not embed long multi-line `code` in the tool-call JSON. A missing brace in
  that JSON aborts the whole DeepSeek turn before the bridge is called. `write`
  the script, then pass only its path.
- **Never make a blocking call.** `doc.close()`, `doc.saveAs`/`save` on a
  modified document that may prompt, flatten/merge on a modified document,
  `QFileDialog`/message boxes and `time.sleep` hold Krita's main thread and the
  GIL; the bridge then stops answering (live-confirmed on this install).
  Recovery needs the user to close and reopen Krita, losing unsaved work. Use
  the host actions `doc_save` / `doc_close {save:true}` for document lifecycle;
  never open UI.
- Do not show modal dialogs (they block the bridge and the tool call).
- Never dump raw pixels into the result: 1600×1000 RGBA is 6.4 MB of base64
  noise. Print `len(pixel_data)` or a few sampled bytes instead; preview by
  saving a file and using `read_image`.
- Palette variables persist across calls, but `doc`/`layer`/`selection` are
  refreshed at the start of every call (active document/layer at that moment).
  Re-fetch anything else (`other = app.activeDocument()`) inside the same call.
- 1–2 s is a cheap `exec`; multi-second pixel loops should be split per region
  or replaced with QImage/numpy operations.
- `QImage`/`QPainter` are the fast path for gradients, masks, text and
  compositing. For numpy, the sampled bytes are `BGRA` (U8 RGBA documents).

## Pre-bound names

| name | value |
|---|---|
| `app` | `Krita.instance()` |
| `doc` | active `Document` or `None` |
| `window` | `app.activeWindow()` or `None` |
| `view` | `window.activeView()` or `None` |
| `layer` | `doc.activeNode()` or `None` |
| `selection` | `doc.selection()` or `None` |
| `krita` | the `krita` module |
| `Krita`, `Document`, `Node`, `Selection`, `ManagedColor`, `InfoObject` | libkis classes |
| `QColor`, `QImage`, `QPoint`, `QPointF`, `QRect`, `QPolygon`, `QTransform` | PyQt5 classes |
| `Extension`, `View`, `Window` | libkis classes (present on 5.3) |

Anything else: `from PyQt5.QtGui import QPainter, QLinearGradient` etc. Use
`krita.Palette`, `krita.Filter` only if the bridge namespace lacks the name.

## Krita (application)

| call | returns |
|---|---|
| `Krita.instance()` / `app` | singleton |
| `app.version()` | version string |
| `app.activeDocument()` / `activeWindow()` | current objects or `None` |
| `app.documents()` / `windows()` | lists |
| `app.openDocument(path)` | Document (use `open_file` action instead) |
| `app.setActiveDocument(doc)` | activate (use `doc_activate`) |
| `app.createDocument(w,h,name,"RGBA","U8","",resolution)` | new Document |
| `app.action(id)` | QAction or None (use `action` action) |
| `app.actions()` | all main-window QActions |
| `app.filters()` | list of internal filter names (strings) |
| `app.filter(name)` | Filter with default config, or None |
| `app.resources(type)` | dict name → Resource; types: `preset`, `pattern`, `gradient`, `palette`, `symbol`, `workspace` |
| `app.resource(type, name)` | Resource or None **(verify)** |
| `app.readSetting(group, name, default)` / `writeSetting(group, name, value)` | kritarc access |
| `app.setBatchmode(bool)` | (verify) global batch mode; `Document.setBatchmode` is absent on Krita 5.3, the bridge guards it |

## Document

| call | notes |
|---|---|
| `doc.width()` / `height()` / `resolution()` | int / int / float dpi |
| `doc.name()` / `setName(str)` | title, not filename |
| `doc.fileName()` / `setFileName(str)` | full path or `""` |
| `doc.colorModel()` / `colorDepth()` | e.g. `"RGBA"` / `"U8"` |
| `doc.rootNode()` | invisible root group |
| `doc.activeNode()` / `setActiveNode(node)` | active layer |
| `doc.nodeByName(name)` | first exact node |
| `doc.topLevelNodes()` | list of root children |
| `doc.createNode(name, type)` | type: paintlayer, grouplayer, vectorlayer, filllayer, filterlayer, clonelayer, filelayer, transparencymask, filtermask, transformmask, selectionmask |
| `doc.createGroupLayer(name)` | GroupLayer |
| `doc.createVectorLayer(name)` | VectorLayer |
| `doc.createFilterLayer(name, filter, selection)` | FilterLayer |
| `doc.createFilterMask(name, filter, node)` | FilterMask |
| `doc.createFillLayer(name, generator, InfoObject, selection)` | FillLayer |
| `doc.createTransparencyMask(name)` / `createSelectionMask(name)` / `createTransformMask(name)` | mask nodes |
| `doc.removeNode(node)` | delete node |
| `doc.flatten()` / `mergeNode(node)` | merge helpers |
| `doc.selection()` / `setSelection(sel)` | global selection |
| `doc.projection(x=0,y=0,w=0,h=0)` | QImage of the rendered image (**fast preview**) |
| `doc.pixelData(x,y,w,h)` | QByteArray of the projection (BGRA for U8 RGBA) |
| `doc.exportImage(path, InfoObject)` | bool; no URL change |
| `doc.save()` / `saveAs(path)` | native `.kra` save; **blocking risk** — prefer host `doc_save`, and set batchmode |
| `doc.setBatchmode(bool)` | absent on Krita 5.3 (the bridge guards it); `exportImage` works without it |
| `doc.refreshProjection()` | recomposite/redraw after pixel edits |
| `doc.waitForDone()` | wait for internal jobs |
| `doc.annotation(type)` / `setAnnotation(type, description, data)` / `annotationTypes()` / `removeAnnotation(type)` | Krita 5 annotation API (QByteArray data) |
| `doc.modified()` / `setModified(bool)` | dirty flag |
| `doc.crop(x,y,w,h)` / `resizeImage(...)` / `scaleImage(w,h,xres,yres,strategy)` / `rotateImage(rad)` | canvas ops |
| `doc.thumbnail(w,h)` | QImage preview |
| `doc.close()` | **blocking hazard**: prompts on a modified doc — never call from `py`; use host `doc_close` |

## Node (layer / mask)

| call | notes |
|---|---|
| `node.name()` / `setName()` | |
| `node.type()` | `paintlayer`, `grouplayer`, `vectorlayer`, … |
| `node.visible()` / `setVisible(bool)` | |
| `node.opacity()` / `setOpacity(int 0–255)` | **int 0–255**, not 0–1 |
| `node.blendingMode()` / `setBlendingMode(str)` | internal mode ids, e.g. `"normal"`, `"multiply"`, `"screen"`, `"overlay"` |
| `node.locked()` / `setLocked()` | |
| `node.alphaLocked()` / `setAlphaLocked()` | |
| `node.inheritAlpha()` / `setInheritAlpha()` | clipping mask |
| `node.bounds()` | QRect of non-transparent pixels |
| `node.position()` | top-left of the paint device |
| `node.childNodes()` | bottom-up, direct children |
| `node.parentNode()` | parent group or root |
| `node.addChildNode(child, above)` | insert above `above` (None = top) |
| `node.removeChildNode(child)` | detach |
| `node.setChildNodes([nodes])` | replace children, bottom-up |
| `node.duplicate()` | copy not inserted |
| `node.mergeDown()` | merge with visible layer below |
| `node.move(x,y)` | move pixel contents in image coords |
| `node.rotateNode(radians)` / `scaleNode(QPointF origin,w,h,strategy)` / `shearNode(ax,ay)` | transform pixels |
| `node.cropNode(x,y,w,h)` / `node.remove()` | |
| `node.pixelData(x,y,w,h)` | layer pixels (or mask data for masks) |
| `node.pixelDataAtTime(x,y,w,h,frame)` | animated layers |
| `node.projectionPixelData(x,y,w,h)` | after sub-nodes/masks applied |
| `node.setPixelData(bytes,x,y,w,h)` | paint layer/mask only; groups/file layers silently ignore |
| `node.findChildNodes(name="",recursive=False,partialMatch=False,type="",colorLabelIndex=0)` | search |
| `node.save(path,xres,yres,InfoObject,exportRect)` | export single layer |
| `node.thumbnail(w,h)` | QImage |
| `node.uniqueId()` | QUuid |
| `node.setColorLabel(index)` / `setCollapsible` etc. | UI metadata |

Pixel format: for U8 RGBA documents `pixelData`/`setPixelData` use **BGRA**
order, 4 bytes/pixel, row-major, no row padding. Float RGBA documents use RGBA
order. Use `len(data) == w*h*4` for RGBA/U8.

## Selection

| call | notes |
|---|---|
| `Selection()` | new empty mask |
| `sel.select(x,y,w,h,value 0–255)` | set a rectangle |
| `sel.selectAll(node, value)` | whole layer |
| `sel.pixelData(x,y,w,h)` | 1 byte/pixel selectedness (verified) |
| `sel.setPixelData(bytes,x,y,w,h)` | load a mask, tightly packed `w*h` bytes — **fast path for any shape** (verified) |
| `sel.bounds()` | **not available** on 5.3.4.1 (verified); compute bbox from `pixelData` |
| `sel.pixelSelected(x,y)` | **not available** (verified); read `pixelData` instead |
| `sel.width()` / `height()` / `x()` / `y()` | extent/top-left |
| `sel.clear()` / `invert()` | empty / invert |
| `sel.grow(xr, yr)` / `sel.shrink(xr, yr, edgeLock)` / `sel.border(xr, yr)` | two radii (verified signatures) |
| `sel.feather(radius)` / `smooth()` / `contract(value)` | soften/expand |
| `sel.move(x,y)` / `resize(w,h)` | move/resize |
| `sel.transform(QTransform)` | **not available** on 5.3.4.1 (verified); transform the mask QImage instead |
| `sel.add(other)` / `subtract(other)` / `intersect(other)` / `replace(other)` | boolean ops |
| `sel.copy(node)` / `sel.cut(node)` / `sel.paste(node,x,y)` | clipboard ops |
| `doc.setSelection(sel)` then `doc.refreshProjection()` | commit; `setSelection(None)` deselects |

Krita 5.3.4.1 Selection has **no** `selectEllipse`, `selectPolygon`, `bounds`,
`transform` or `pixelSelected` (live-verified with `hasattr`). Build a QImage mask
and use `setPixelData` for every non-rectangular shape. `Document.fillSelection`
is also absent, so fill a selection by triggering the
`fill_selection_foreground_color` QAction (`app.action(...).trigger()`).

## Filter

| call | notes |
|---|---|
| `app.filters()` | internal names, e.g. `gaussian blur`, `levels`, `unsharp`, `invert` (returns strings) |
| `app.filter(name)` | Filter with default configuration |
| `filt.name()` / `setName()` | name |
| `filt.configuration()` / `setConfiguration(InfoObject)` | settings map; keep the InfoObject alive while using it |
| `filt.apply(node,x,y,w,h)` | bool; run on writable paint device (verified signature) |
| `filt.startFilter(node,x,y,w,h)` | async variant |

Live-verified traps:

- `app.filter("gaussian blur").configuration().properties()` chained in one
  expression raised `RuntimeError: wrapped C/C++ object of type InfoObject has
  been deleted`. Bind the Filter first:
  `f = app.filter("gaussian blur"); c = f.configuration(); c.properties()`.
- `setConfiguration` requires an **InfoObject**; a plain dict raises `TypeError`
  (live-verified).
- Configured filters work with the exact pattern below (live-verified with
  `blur` and `hsvadjustment`). `Filter` stores a raw pointer to the InfoObject,
  so keep `c` referenced through `apply`:
  ```python
  f = app.filter("blur")
  c = f.configuration()
  c.setProperties({"halfWidth": 18, "halfHeight": 18, "strength": 100})
  f.setConfiguration(c)
  f.apply(layer, 0, 0, doc.width(), doc.height())
  doc.refreshProjection()
  ```
  The bridge `filter` action does the same and keeps a bounded reference list;
  use `filter_config` to read valid keys first. A few filters cannot expose a
  config (e.g. `halftone`) and raise on `configuration()`.
- `apply(node, x, y, w, h)` is the 5-arg form (verified); the 7-arg/rect variants
  fail.
- Gaussian blur's default keys are `horizRadius`, `vertRadius`, `lockAspect`;
  plain blur uses `halfWidth`/`halfHeight`/`strength`; `invert`, `desaturate`,
  `normalize` need no config.

## InfoObject and export settings

`InfoObject` wraps a property map: `setProperty(key, value)`, `property(key)`,
`properties()`, `setProperties(dict)`. (There is no `getProperty`.)

PNG export keys: `alpha` bool, `compression` int 1–9, `forceSRGB` bool,
`indexed` bool, `interlaced` bool, `saveSRGBProfile` bool,
`transparencyFillcolor` [r,g,b].

JPEG keys: `quality` int 0–100, `optimize` bool, `progressive` bool,
`subsampling` int 0–3, `baseline` bool, `saveProfile` bool, `exif` bool,
`iptc` bool, `xmp` bool, `forceSRGB` bool, `is_sRGB` bool, `filters` list.

## Color

- `QColor("#rrggbb")` is enough for sRGB work.
- `view.foregroundColor()` / `setForeGroundColor(ManagedColor)`; convert with
  `ManagedColor.fromQColor(qcolor, view.canvas())` and
  `mc.colorForCanvas(view.canvas())`.
- `ManagedColor(model, depth, profile)` + `components()`/`setComponents([floats 0–1])`
  for non-sRGB spaces; `toXML()` / `fromXML()` for serialization.
- For raw pixel writes use the document's actual color space: U8 RGBA is BGRA.

## Recipes (copy into `py` code)

### 1. Gradient fill on a new layer
```python
from PyQt5.QtGui import QImage, QPainter, QLinearGradient, QColor
from PyQt5.QtCore import QPointF
w, h = doc.width(), doc.height()
img = QImage(w, h, QImage.Format_ARGB32)
p = QPainter(img)
g = QLinearGradient(QPointF(0, 0), QPointF(0, h))
g.setColorAt(0.0, QColor("#0b1020"))
g.setColorAt(0.55, QColor("#5b4bd6"))
g.setColorAt(1.0, QColor("#ffd166"))
p.fillRect(0, 0, w, h, g)
p.end()
buf = img.constBits().asstring(img.byteCount())
new = doc.createNode("gradient bg", "paintlayer")
doc.rootNode().addChildNode(new, None)
new.setPixelData(buf, 0, 0, w, h)
doc.setActiveNode(new)
doc.refreshProjection()
print("gradient", new.name(), w, h)
```

### 2. Apply a filter (defaults or configured)
```python
f = app.filter("blur")              # keep the Filter object alive
c = f.configuration()               # InfoObject; bind it to a variable
c.setProperties({"halfWidth": 18, "halfHeight": 18, "strength": 100})
f.setConfiguration(c)               # Krita stores a raw pointer: keep c alive
ok = f.apply(layer, 0, 0, doc.width(), doc.height())
doc.refreshProjection()
print("applied", ok)
```
Configured applies are supported (live-verified with `blur` and
`hsvadjustment`); use the bridge's `filter_config` action to discover valid keys
and `filter` for the same thing without `py`. Keep `c` referenced through
`apply` — letting the InfoObject be garbage-collected can crash Krita. A few
filters cannot expose a config (e.g. `halftone`); use defaults for those.

### 3. Text or arbitrary vector art via SVG
```python
w, h = doc.width(), doc.height()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
       'viewBox="0 0 %d %d"><text x="120" y="360" font-family="DejaVu Sans" '
       'font-size="128" fill="#111111">Hello</text></svg>') % (w, h, w, h)
vl = doc.createVectorLayer("text")
doc.rootNode().addChildNode(vl, None)
shapes = vl.addShapesFromSvg(svg)
doc.setActiveNode(vl)
doc.refreshProjection()
print("shapes", len(shapes) if shapes else 0)
```
For a solid shape use `<rect>`, `<circle>`, `<path>` with `fill`/`stroke`.
Text shaping uses Krita's SVG engine; check a preview **(verify)**.

### 4. Transform / duplicate a layer
```python
node = doc.activeNode()
dup = node.duplicate()
node.parentNode().addChildNode(dup, node)
dup.setName(node.name() + " copy")
dup.scaleNode(QPointF(0, 0), doc.width() // 2, doc.height() // 2, "Bicubic")
dup.rotateNode(-0.05)          # radians
dup.move(40, 20)               # pixel offset in image space
doc.setActiveNode(dup)
doc.refreshProjection()
print(dup.name(), dup.bounds())
```

### 5. Elliptical / polygon / feathered selection (fast mask path)
```python
from PyQt5.QtGui import QImage, QPainter, QColor, QPolygonF
from PyQt5.QtCore import Qt, QRectF, QPointF
w, h = doc.width(), doc.height()
m = QImage(w, h, QImage.Format_Grayscale8)
m.fill(0)
p = QPainter(m)
p.setRenderHint(QPainter.Antialiasing, True)
p.setPen(Qt.NoPen)
p.setBrush(QColor(255, 255, 255))
p.drawEllipse(QRectF(300, 200, 400, 300))       # or p.drawPolygon(QPolygonF([...]))
p.end()
# Selection.setPixelData wants tightly packed bytes, but QImage pads each row
# to 4 bytes. Strip the padding (live-verified: w*h bytes, no stride).
stride = m.bytesPerLine()
raw = m.constBits().asstring(m.byteCount())
mask = bytearray(w * h)
for y in range(h):
    mask[y * w:(y + 1) * w] = raw[y * stride:y * stride + w]
sel = Selection()
sel.setPixelData(bytes(mask), 0, 0, w, h)
sel.feather(6)
doc.setSelection(sel)
doc.refreshProjection()
print("selected", w, h, stride)
```
Draw the mask with QPainter, or use `setPixel(x, y, qRgb(255,255,255))`: plain
`255` on `Format_Grayscale8` is interpreted as a color and wrote 39, not 255
(live-verified). QPainter white + stride stripping is the reliable path; the
bridge's `save_selection` now uses the `qRgb` form (fixed in 1.1.0).

### 6. Masked painting (fill selection with a color)
```python
view.setForeGroundColor(ManagedColor.fromQColor(QColor("#e85d75"), view.canvas()))
app.action("fill_selection_foreground_color").trigger()
doc.refreshProjection()
print("filled selection")
```
`Document.fillSelection` does not exist on 5.3.4.1; the QAction is the working
path (it uses the foreground color and the active selection). For a mask without
a Krita selection, composite the color into the pixels and `setPixelData`.

### 7. Palette and resource lookup
```python
palettes = app.resources("palette")
print(sorted(palettes)[:10])
res = palettes.get("Radiance") or next(iter(palettes.values()))
pal = krita.Palette(res)
out = []
for i in range(min(pal.numberOfEntries(), 12)):
    e = pal.colorSetEntryByIndex(i)       # 5.3 API
    out.append((e.name(), e.id()))
print(out)
print([n for n in app.resources("preset") if "ink" in n.lower()][:15])
```
`Swatch.color()` exists but is not in the 5.2 docs page **(verify)**; use
`pal.data()` (KPL XML) if you need raw colors.

### 8. Explicit export + cheap preview
```python
info = InfoObject()
info.setProperty("compression", 3)
info.setProperty("alpha", True)
info.setProperty("forceSRGB", False)
try:
    doc.setBatchmode(True)      # may be a no-op on 5.3
except Exception:
    pass
ok = doc.exportImage("C:/art/export.png", info)
try:
    doc.setBatchmode(False)
except Exception:
    pass
preview = doc.projection()          # QImage, no dialog
preview.save("C:/art/preview.png")
print("export", ok, "preview", preview.width(), preview.height())
```
Then `read_image` on `preview.png`/`export.png`.

### 9. Versioned save before a risky pass — use the host action
Preferred (no GIL/blocking risk; the tool batches it with your next commands):
```json
{"action":"doc_save","params":{"path":"C:/art/session01_pass03.kra"}}
```
If you must do it in Python, keep batchmode on and never call it when a dialog
could appear:
```python
path = "C:/art/session01_pass03.kra"
doc.setBatchmode(True)
try:
    ok = doc.saveAs(path)
finally:
    doc.setBatchmode(False)
print(ok, doc.fileName())
```
Never call `doc.close()` here; a modified document prompts and wedges Krita.
Use `{"action":"doc_close","params":{"save":true}}` from the host instead.

### 10. Custom selection channel that keeps its shape
```python
import json
sel = doc.selection()
w, h = doc.width(), doc.height()
mask = sel.pixelData(0, 0, w, h)
blob = json.dumps({"w": w, "h": h, "mask": list(mask)})
doc.setAnnotation("dsh/channel/head", "head selection", blob.encode())
print(len(doc.annotationTypes()))
```
Warning: `list(mask)` on a large canvas is huge; store the mask as a PNG file
instead (`sel` → QImage save) unless the mask is small.

## Verified absent on Krita 5.3.4.1 (live-checked with `hasattr`)

- `Selection.selectEllipse`, `Selection.selectPolygon`, `Selection.bounds`,
  `Selection.transform`, `Selection.pixelSelected` — use a QImage mask +
  `setPixelData`, and compute bboxes from `pixelData`.
- `Document.fillSelection` — fill via the `fill_selection_foreground_color`
  QAction.
- `Document.annotations()` — use `annotationTypes()`.
- `Document.startTransaction` — not available (the bridge's select_rect wrapper
  silently skips it; no undo entry is created for selections).
- `Node.ungroup` — ungroup via child list manipulation / QAction.
- `InfoObject.getProperty` — use `property()`.
- `Filter.setConfiguration(dict)` — pass a real `InfoObject`.
- `QAction` `trigger()` on dialog actions returns immediately; the dialog blocks
  Krita until the user closes it.

## Still uncertain (verify before relying)

- `Krita.resource(type, name)` singular — docs only document `resources(type)`.
- `Node.rotateNode`/`scaleNode`/`shearNode` exist per docs; not exercised here.
- `Swatch.color()` — palette swatch color accessor; the docs page is incomplete.
- `VectorLayer.addShapesFromSvg` text shaping quality/available fonts.
- `QImage.byteCount()` is Qt5 (correct here); on Qt6 use `sizeInBytes()`.
