/**
 * dsh-krita — Host half.
 *
 * Registers one token-efficient `krita` tool that drives a live Krita desktop
 * app through the vendored `kritamcp` python bridge, and supplies the
 * `setup` / `start` lifecycle actions. The Krita Painter agent preset mounts
 * this package together with a scoped skill provider, so the tool and skill
 * only exist inside that mode.
 */

import { fileURLToPath } from 'node:url';

import { createLogger, normalizeConfig } from './lib/config.js';
import { KritaBridge } from './lib/bridge.js';
import { createKritaTool } from './lib/tool.js';

export const name = 'dsh-krita';

/** The tool registry is provided by the Host composition. */
export const inject = ['tools'];

/**
 * @param {Record<string, any>} ctx Cordis context
 * @param {unknown} config raw config from cordis.patch.yml
 */
export function apply(ctx, config) {
  const log = createLogger(ctx);
  const normalized = normalizeConfig(config, log);
  const bridge = new KritaBridge(normalized, log);
  const packageRoot = fileURLToPath(new URL('.', import.meta.url));
  const tool = createKritaTool({ ctx, config: normalized, bridge, log, packageRoot });

  ctx.effect(function* registerKritaTool() {
    yield ctx.tools.register(tool);
    log.info(`registered tool "krita" -> ${normalized.bridgeUrl}`);
  }, 'dsh-krita tool');

  return {
    config: normalized,
    bridge,
    tool,
  };
}
