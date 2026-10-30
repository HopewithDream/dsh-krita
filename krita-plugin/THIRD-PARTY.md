# Third-party attribution

The Krita-side bridge in this directory is a **vendored and extended copy** of
the Krita Python plugin from the `krita-cli` project. The upstream code is
licensed under the MIT License; the license text is reproduced verbatim in
[`LICENSE`](LICENSE).

## Upstream

- Project: **krita-cli** — <https://github.com/edithatogo/krita-cli>
- Vendored path: `krita-plugin/kritamcp`
- Commit: `8245fd4c92ed2b413cb975230891f4e8cda61d0a` (2026-04-19,
  "Implement full CLI/MCP parity for plugin-backed actions")
- Copyright: "Copyright (c) 2025" as stated in the upstream MIT `LICENSE`
  (no other copyright holder information is present upstream).
- License: **MIT** — see `LICENSE` in this directory.

## Vendored files (copied verbatim unless noted)

- `kritamcp/__init__.py` — extended for DSH v1.1 (see below)
- `kritamcp/history_store.py`
- `kritamcp/payload_validator.py`
- `kritamcp/rate_limiter.py`
- `kritamcp/snapshot_store.py`
- `kritamcp.desktop` — upstream file with display strings changed:
  `Name=DSH Krita Bridge`, updated `Comment`; `X-KDE-Library=kritamcp` kept.

## Modifications for DSH (protocol 1.1.0, plugin 1.1.0)

- Version bump: `PLUGIN_VERSION = 1.1.0`, `PROTOCOL_VERSION = 1.1.0`;
  `/health` now also reports `krita_version`, `display_name`, `python_version`.
- Raised default rate limit 60 → 600 requests/min; HTTP server binds
  `127.0.0.1` instead of `localhost`; payload/body handling hardened.
- New actions: `seq`, `py`, `actions`, `action`, `filters`, `filter`, `docs`,
  `doc_save`, `doc_close`, `doc_activate`, `layer`, `resources`, `info`.
- Fixed Krita 5.3 compatibility bugs in the upstream bridge:
  `Document.setBatchmode()` no longer exists (guarded, and `save`/`get_canvas`
  now create parent directories and verify the exported file really exists);
  `app.filters()` returns strings not objects; `Selection` has no
  `pixelSelected()`/`bounds()` (selection read/commit reworked, using
  `Selection.pixelData()`); selection edits are committed with
  `Document.setSelection()`; `Document.close()` is rejected for modified
  documents to avoid a modal-dialog deadlock; filter configuration is rejected
  because applying configured filters crashed Krita 5.3.4.1 in testing.
- Layer operations use the real libkis API where available
  (`Node.duplicate/mergeDown/setBlendingMode`, `Document.flatten`) and Krita
  QActions (`create_quick_group`, `quick_ungroup`, `move_layer_up/down`) where
  libkis has no method; unsupported operations return `code:"UNSUPPORTED"`.

No upstream source file was relicensed. The upstream copyright and permission
notice apply to all original portions; the DSH modifications are distributed
under the same MIT terms.
