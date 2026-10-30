# Krita QActions — search and trigger

Every menu item, toolbar button, docker toggle and tool in Krita 5.3.4.1 is a
`QAction` registered in the main window. The bridge exposes all of them, so you
are never limited to the wrapped action list in `protocol.md`.

Use this file for **legacy/advanced UI operations** (dialogs, tool switching,
animation, reference images, snapshots). Prefer wrapped actions
(`set_color`, `stroke`, `select_rect`, `filter`, `doc_save`, ...) whenever one
exists: they take JSON params, return structured results and are safe to batch.

## Search vs. trigger

| Action | Params | Returns | Notes |
|---|---|---|---|
| `actions` | `q` (str, optional; case-insensitive substring of id/text), `limit` (int, default 100) | `{status:"ok", total, actions:[{id,text,shortcut}]}` | Read-only. Search instead of memorising ids. |
| `action` | `id` (str) | `{status:"ok", id}` or error `ACTION_NOT_FOUND` | Triggers the QAction immediately. No params, no dialog result. |

Rule: **search first, then trigger**. IDs change between Krita versions and
some are locale-dependent (menu text is translated; `id` is not).

```json
{"action":"actions","params":{"q":"export"}}
{"action":"action","params":{"id":"file_export_file"}}
```

Behavior and limits:

- Live-verified on this install: **688 QActions**; `text` is **localized**
  (Chinese here) while `id` stays English, so search by an English id fragment
  (e.g. `undo`, `filter_gaussian`, `layer`) rather than by menu wording.
- Actions that open a dialog (Export, Image Size, Filter gallery, Preferences,
  Layer Style, …) return as soon as the action fires. The dialog stays open; the
  call does **not** wait for or operate the dialog. For scriptable versions use
  the wrapped actions (`doc_save`, `filter`, `py`).
- Some actions need an active document/view; if there is none the trigger may
  be a silent no-op. Check `docs` first.
- IDs containing spaces are legal (`krita_filter_gaussian blur`); pass the exact
  string, no escaping.
- The same id can be a menu group (`blur_filters`) or a real command
  (`krita_filter_blur`). Group ids just open submenus.
- If an action id is missing in this build, list `actions` and pick the nearest
  text match rather than guessing a variant.

## Core wrapped actions you should not re-derive

| Need | Use instead |
|---|---|
| Undo / redo | `undo` / `redo` (wraps `edit_undo` / `edit_redo`) |
| Save `.kra` | `doc_save` (native save), `save` (export image) |
| New document | `new_canvas` |
| Open file | `open_file` |
| Layer add/delete/rename/opacity | `create_layer`, `delete_layer`, `rename_layer`, `set_layer_*` |
| Selection | `select_rect`, `select_by_*`, or `py` masks (`select_ellipse`/`select_polygon` are broken on 5.3.4.1) |
| Fill a selection | QAction `fill_selection_foreground_color` (`fill_selection` is broken) |
| Apply a filter | `filter` (returns status; no dialog) |
| Close/activate document | `doc_close`, `doc_activate` |
| Any Python API call | `py` |

## Curated action ids by menu

All ids below were read from this install's
`share/krita/actions/kritamenu.action`, `krita.action`, `tools.action`, so they
are real for Krita 5.3.4.1. Shortcuts are shown because they are stable in the
UI, but you normally trigger by id.

### File
| id | text |
|---|---|
| `file_new` | New... |
| `file_open` | Open... |
| `file_save` | Save |
| `file_save_as` | Save As... |
| `save_incremental_version` | Save Incremental Version |
| `file_export_file` | Export... (dialog) |
| `file_export_advanced` | Export Advanced... (dialog) |
| `file_import_file` | Open existing Document as Untitled... |
| `render_animation` | Render Animation... (dialog) |
| `file_close` | Close |
| `file_close_all` | Close All |
| `file_quit` | Quit (never trigger from a tool call) |

### Edit
| id | text |
|---|---|
| `edit_undo` | Undo |
| `edit_redo` | Redo |
| `edit_cut` / `edit_copy` / `edit_paste` | Cut / Copy / Paste |
| `paste_into` | Paste into Active Layer |
| `clear` | Clear (selection contents) |
| `fill_selection_foreground_color` | Fill with Foreground Color |
| `fill_selection_background_color` | Fill with Background Color |
| `stroke_selection` | Stroke Selection... (dialog) |

### View
| id | text |
|---|---|
| `view_zoom_in` / `view_zoom_out` / `zoom_to_100pct` / `zoom_to_fit` | Zoom controls |
| `rotate_canvas_right` / `rotate_canvas_left` / `reset_canvas_rotation` | Canvas rotation (display only) |
| `mirror_canvas` | Mirror view (display only) |
| `view_show_canvas_only` | Show Canvas Only |
| `view_pixel_grid` / `view_grid` | Pixel grid / grid toggles |
| `view_toggle_reference_images` | Show Reference Images |
| `fullscreen` | Full Screen Mode |

### Image
| id | text |
|---|---|
| `image_properties` | Properties... (dialog) |
| `imagesize` | Scale Image To New Size... (dialog) |
| `canvassize` | Resize Canvas... (dialog) |
| `rotateimage` | Rotate Image... (dialog) |
| `rotateImageCW90` / `rotateImageCCW90` / `rotateImage180` | Rotate image 90° right / 90° left / 180° |
| `mirrorImageHorizontal` / `mirrorImageVertical` | Mirror image |
| `trim_to_image` | Trim to Image Size |
| `resizeimagetoselection` | Trim to Selection |
| `resizeimagetolayer` | Trim to Current Layer |
| `image_color` | Image Background Color and Transparency... |
| `imagecolorspaceconversion` | Convert Image Color Space... |
| `purge_unused_image_data` | Purge Unused Image Data |

### Layer
| id | text |
|---|---|
| `add_new_paint_layer` | Add Paint Layer (`Insert`) |
| `add_new_group_layer` | Add Group Layer |
| `add_new_shape_layer` | Add Vector Layer (`Shift+Insert`) |
| `add_new_fill_layer` | Add Fill Layer... (dialog) |
| `add_new_adjustment_layer` | Add Filter Layer... (dialog) |
| `add_new_transparency_mask` | Add Transparency Mask |
| `add_new_filter_mask` | Add Filter Mask... |
| `add_new_selection_mask` | Add Local Selection |
| `add_new_transform_mask` | Add Transform Mask |
| `add_new_clone_layer` | Add Clone Layer |
| `duplicatelayer` | Duplicate Layer or Mask (`Ctrl+J`) |
| `copy_selection_to_new_layer` | Copy Selection to New Layer |
| `cut_selection_to_new_layer` | Cut Selection to New Layer |
| `new_from_visible` | New Layer From Visible |
| `merge_layer` | Merge with Layer Below (`Ctrl+E`) |
| `flatten_layer` | Flatten Layer |
| `flatten_image` | Flatten image (`Ctrl+Shift+E`) |
| `remove_layer` | Remove Layer (`Shift+Delete`) |
| `RenameCurrentLayer` | Rename current layer (`F2`) |
| `layer_properties` | Properties... (`F3`) |
| `toggle_layer_visibility` / `toggle_layer_lock` / `toggle_layer_alpha_lock` | Layer toggles |
| `select_all_layers` / `select_visible_layers` / `select_locked_layers` | Layer selection |
| `move_layer_up` / `move_layer_down` | Move Layer or Mask Up/Down |
| `create_quick_group` / `quick_ungroup` | Quick Group (`Ctrl+G`) / Quick Ungroup |
| `convert_to_paint_layer` | Convert to Paint Layer |
| `save_node_as_image` | Save Layer/Mask... |
| `rotatelayer` / `layersize` / `offsetlayer` | Rotate / Scale / Offset Layers (dialogs) |
| `rotateLayerCW90` / `rotateLayerCCW90` / `rotateLayer180` | Rotate layers 90° right / 90° left / 180° |
| `mirrorNodeX` / `mirrorNodeY` | Mirror layers horizontally / vertically |
| `layer_style` | Layer Style... (dialog) |
| `histogram` | Histogram... |

### Select
| id | text |
|---|---|
| `select_all` | Select All (`Ctrl+A`) |
| `deselect` | Deselect (`Ctrl+Shift+A`) |
| `reselect` | Reselect (`Ctrl+Shift+D`) |
| `invert_selection` | Invert Selection (`Ctrl+Shift+I`) |
| `edit_selection` | Edit Selection |
| `featherselection` | Feather Selection... (`Shift+F6`) |
| `growselection` / `shrinkselection` / `borderselection` | Grow / Shrink / Border Selection... |
| `selectionscale` | Scale Selection... |
| `colorrange` | Select from Color Range... |
| `selectopaque` | Select Opaque (Replace) |
| `selectopaque_add` / `selectopaque_subtract` / `selectopaque_intersect` | Select Opaque variants |
| `smoothselection` | Smooth selection |
| `convert_to_raster_selection` / `convert_to_vector_selection` | Selection conversion |
| `toggle_display_selection` | Display Selection (`Ctrl+H`) |

### Filter
| id | text |
|---|---|
| `filter_apply_again` | Apply Filter Again (`Ctrl+F`) |
| `filter_apply_reprompt` | Apply Filter Again (Reprompt) |
| `blur_filters` / `artistic_filters` / `adjust_filters` / `color_filters` / `edge_filters` / `enhance_filters` / `emboss_filters` / `map_filters` / `other_filters` | Filter submenus |
| `QMic` | Start G'MIC-Qt (dialog) |

Individual filters use ids of the form `krita_filter_<lowercase name>`, with
spaces allowed: `krita_filter_gaussian blur`, `krita_filter_blur`,
`krita_filter_invert`, `krita_filter_levels`, `krita_filter_unsharp`,
`krita_filter_autocontrast`, `krita_filter_desaturate`,
`krita_filter_posterize`, `krita_filter_noise`, `krita_filter_wave`,
`krita_filter_pixelize`, `krita_filter_sharpen`, `krita_filter_hsvadjustment`,
`krita_filter_colorbalance`, `krita_filter_perchannel`,
`krita_filter_colortoalpha`, `krita_filter_roundcorners`,
`krita_filter_motion blur`, `krita_filter_gaussiannoisereducer`.
These open their dialogs. To apply non-interactively use the `filter` action.

### Tools
| id | text |
|---|---|
| `KritaShape/KisToolBrush` | Freehand Brush Tool |
| `KritaShape/KisToolLine` | Line Tool |
| `KritaShape/KisToolRectangle` | Rectangle Tool |
| `KritaShape/KisToolEllipse` | Ellipse Tool |
| `KritaFill/KisToolFill` | Fill Tool |
| `KritaFill/KisToolGradient` | Gradient Tool |
| `KritaShape/KisToolDyna` | Dynamic Brush Tool |
| `KritaShape/KisToolMultiBrush` | Multibrush Tool |
| `KritaShape/KisToolLazyBrush` | Colorize Mask Tool |
| `KritaTransform/KisToolMove` | Move Tool |
| `KisToolTransform` | Transform Tool |
| `KritaShape/KisToolMeasure` | Measurement Tool |
| `KritaSelected/KisToolColorSampler` | Color Sampler |
| `PanTool` / `ZoomTool` | Pan / Zoom |
| `InteractionTool` | Select Shapes Tool |
| `PathTool` | Edit Shapes Tool |
| `SvgTextTool` | Text Tool |
| `ToolReferenceImages` | Reference Images Tool |

Selecting a tool only changes the active tool; it does not paint. The bridge's
`stroke`/`fill` actions paint directly and do not depend on the active tool.

### Painting / color
| id | text |
|---|---|
| `toggle_fg_bg` | Swap Foreground/Background colors (`X`) |
| `reset_fg_bg` | Reset to black/white (`D`) |
| `chooseForegroundColor` | Choose Foreground Color (dialog) |
| `chooseBackgroundColor` | Choose Background Color (dialog) |
| `increase_brush_size` / `decrease_brush_size` | Brush size (`]` / `[`) |
| `erase_action` | Set eraser mode (`E`) |
| `preserve_alpha` | Preserve Alpha |
| `selection_tool_mode_add` / `_subtract` / `_intersect` / `_replace` | Selection tool modes |
| `show_brush_presets` | Show Brush Presets (`F6`) |
| `show_brush_editor` | Show Brush Editor (`F5`) |
| `show_tool_options` | Show Tool Options |

### Animation
| id | text |
|---|---|
| `previous_frame` / `next_frame` | Previous / next frame |
| `first_frame` / `last_frame` | First / last frame |
| `toggle_playback` / `stop_playback` | Play-pause / stop |
| `add_blank_frame` / `add_duplicate_frame` | Create blank / duplicate frame |
| `insert_keyframe_left` / `insert_keyframe_right` | Insert keyframe left / right |
| `remove_frames` | Remove keyframe |
| `toggle_onion_skin` | Toggle onion skin |
| `set_start_time` / `set_end_time` / `update_playback_range` | Playback range |

### Settings / Help
| id | text |
|---|---|
| `options_configure` | Configure Krita... (dialog) |
| `manage_resources` | Manage Resources... (dialog) |
| `options_configure_keybinding` | Configure Shortcuts... |
| `help_contents` | Krita Handbook |

## Pattern: find and trigger without guessing

```json
{"action":"actions","params":{"q":"reference image"}}
```
Then, once the id is confirmed:

```json
{"action":"action","params":{"id":"view_toggle_reference_images"}}
```

## Pattern: use an action when no wrapped action exists

```json
{"action":"action","params":{"id":"imagesize"}}
```
This opens the Scale Image dialog. If the goal is scriptable, do it in `py`
instead (`doc.scaleImage(w, h, xres, yres, "Bicubic")`) or ask the user.

## Failure modes

| Symptom | Meaning |
|---|---|
| `ACTION_NOT_FOUND` | id does not exist in this build (search again) |
| `ok` but nothing visibly changed | action needs a document, selection, or view; or it only opened a dialog |
| dialog is now open | expected for dialog actions; do not trigger it twice |
| trigger blocks/does nothing useful in background | use `py` for the equivalent API instead |
