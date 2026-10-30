/**
 * Configuration and logging helpers for the dsh-krita Host plugin.
 *
 * The plugin deliberately has no runtime dependency: profile-installed DSH
 * bundles cannot resolve `@deepseek-ai/*` packages from the plugin directory,
 * so only Node builtins are imported.
 */

import { existsSync } from 'node:fs';

/**
 * Candidate Krita executables, in probe order. `KRITA_PATH` and an explicit
 * `kritaPath` in the plugin config always win over these defaults.
 */
export const KRITA_PATH_CANDIDATES = Object.freeze([
  'C:\\Program Files\\Krita (x64)\\bin\\krita.exe',
  'C:\\Program Files\\Krita\\bin\\krita.exe',
  'C:\\Program Files (x86)\\Krita\\bin\\krita.exe',
  // Tencent-packaged Krita builds seen in the wild (including this project's
  // test machine); harmless to probe on other installs.
  'C:\\Program Files\\com.tencent.pcgame.krikrita\\bin\\krita.exe',
  'D:\\Program Files\\com.tencent.pcgame.krikrita\\bin\\krita.exe',
]);

/** Last-resort path used only for the error message when probing fails. */
export const DEFAULT_KRITA_PATH = KRITA_PATH_CANDIDATES[0];

/** Host-side pseudo actions handled without a Krita bridge request. */
export const HOST_ACTIONS = new Set(['status', 'start', 'setup']);

/**
 * Build a logger from the Cordis context without assuming any particular
 * logger shape; logging must never break tool registration.
 * @param {Record<string, any>} ctx
 */
export function createLogger(ctx) {
  let sink = null;
  try {
    const candidate = ctx?.logger;
    if (typeof candidate === 'function') sink = candidate('dsh-krita') ?? null;
    else if (candidate && typeof candidate === 'object') sink = candidate;
  } catch {
    sink = null;
  }
  const emit = (level, message) => {
    try {
      const fn = sink?.[level] ?? sink?.[level === 'warn' ? 'warning' : level];
      if (typeof fn === 'function') fn.call(sink, `[dsh-krita] ${message}`);
      else if (level === 'error') console.error(`[dsh-krita] ${message}`);
    } catch {
      /* logging must never throw into the plugin lifecycle */
    }
  };
  return {
    debug: (message) => emit('debug', message),
    info: (message) => emit('info', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
  };
}

function positiveInteger(value, fallback) {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Explicit config > KRITA_PATH env > first existing standard install.
 * A missing executable is not fatal here: `start` reports the path it tried.
 * @param {unknown} configured
 * @param {{info?: Function, warn?: Function}} [log]
 */
export function resolveKritaPath(configured, log) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim();
  }
  const fromEnv = process.env.KRITA_PATH;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  for (const candidate of KRITA_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      log?.info?.(`auto-detected Krita at ${candidate}`);
      return candidate;
    }
  }
  log?.warn?.(
    'could not auto-detect krita.exe; set `kritaPath` in the preset config or the KRITA_PATH environment variable',
  );
  return DEFAULT_KRITA_PATH;
}

/**
 * Normalize raw patch config into the exact fields the runtime uses.
 * @param {unknown} raw
 * @param {{info?: Function, warn: Function}} [log]
 */
export function normalizeConfig(raw, log) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const kritaPath = resolveKritaPath(input.kritaPath, log);
  const host = typeof input.host === 'string' && input.host.trim() !== ''
    ? input.host.trim()
    : '127.0.0.1';
  const port = positiveInteger(input.port, 5678);

  if (input.port !== undefined && port !== input.port) {
    log?.warn(`ignoring invalid port ${JSON.stringify(input.port)}; using ${port}`);
  }

  return {
    kritaPath,
    host,
    port,
    /** Per bridge request budget, also the tool-call default. */
    requestTimeoutMs: positiveInteger(input.requestTimeoutMs, 30_000),
    /** How long `start` waits for Krita's bridge to answer `/health`. */
    startTimeoutMs: positiveInteger(input.startTimeoutMs, 120_000),
    /** Tool-level cap; the bridge itself accepts 64 in one `seq`. */
    maxCommands: Math.min(positiveInteger(input.maxCommands, 32), 64),
    /** Cap on the JSON text returned to the model in one tool result. */
    maxResultChars: positiveInteger(input.maxResultChars, 16_000),
    bridgeUrl: `http://${host}:${port}`,
  };
}
