# Third-party notices

## krita-cli / krita-mcp (Krita-side bridge)

The Krita-side HTTP bridge in `krita-plugin/` is a vendored and extended copy of
the Krita plugin from **krita-cli** by edithatogo:

- Source: https://github.com/edithatogo/krita-cli
- Upstream package: https://pypi.org/project/krita-cli/
- Path used: `krita-plugin/` (`kritamcp` python module)
- License: MIT (see `krita-plugin/LICENSE`)

The vendored copy keeps the upstream HTTP server, main-thread command queue,
paint/selection/layer/export commands, command history, snapshot store, rate
limiter, and payload validator. This project adds the v1.1 actions described in
`PROTOCOL.md` (`seq`, `py`, `actions`/`action`, `filters`/`filter`, `docs`,
native `.kra` save, extra layer operations, resources, richer `info`) and
adjusts packaging for DSH.

Upstream copyright and license text are preserved in
`krita-plugin/LICENSE` and the source headers.

## Everything else

The DSH Host plugin (`index.js`, `lib/`), the agent preset, the skill package,
and the documentation were written for this project and are MIT licensed.
