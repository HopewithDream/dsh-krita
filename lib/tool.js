/**
 * The single model-facing `krita` tool.
 *
 * One tool, one command-list parameter: every Krita capability is reachable
 * from `commands`, which keeps the always-visible schema small and lets the
 * model batch a whole painting pass into one round trip.
 */

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { HOST_ACTIONS } from './config.js';
import { errorMessage } from './bridge.js';
import {
  installKritaPlugin,
  isKritaRunning,
  launchKrita,
  waitForHealth,
} from './install.js';

const TOOL_NAME = 'krita';
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 600_000;
const FILE_OUTPUT_ACTIONS = new Set(['save', 'doc_save']);
const FILE_INPUT_ACTIONS = new Set(['open_file']);

function sessionDirectory(ctx, exec) {
  try {
    const service = ctx?.get?.('workingDirectory');
    const session = exec?.agent?.session;
    if (service !== undefined && session !== undefined) {
      const directory = service.get(session);
      if (typeof directory === 'string' && directory !== '') return directory;
    }
  } catch {
    /* fall back to the host process cwd */
  }
  return process.cwd();
}

/** Resolve a model-supplied path against the session working directory. */
function resolveCommandPath(command, ctx, exec) {
  const isOutput = FILE_OUTPUT_ACTIONS.has(command.action);
  if (!isOutput && !FILE_INPUT_ACTIONS.has(command.action)) return;
  const raw = command.params?.path;
  if (typeof raw !== 'string' || raw.trim() === '') return;
  const absolute = isAbsolute(raw) ? raw : resolve(sessionDirectory(ctx, exec), raw);
  command.params.path = absolute;
  if (isOutput) {
    // Krita's export does not create parent directories; do it host-side.
    try {
      mkdirSync(dirname(absolute), { recursive: true });
    } catch {
      /* the bridge will report the real write failure */
    }
  }
}

const DESCRIPTION = [
  'Draw and edit in the running Krita desktop app.',
  'A call runs 1-32 ordered bridge commands as one batch; each command is {action, params}.',
  'Load the `krita` skill before the first call for the action reference and the painting workflow.',
  'Host-only actions: status, start (launch Krita), setup (install the Krita bridge).',
  'Keep the command JSON short: for long Python, write a .py file first and use {action:"py", params:{file:"<path>"}}.',
  'Returns compact JSON with one result per command.',
].join(' ');

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['commands'],
  properties: {
    commands: {
      type: 'array',
      description:
        'Ordered commands, preferably 3-10 per call. Each item is {action, params}; action names and params are documented in the krita skill.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            description: 'Bridge action name, e.g. new_canvas, stroke, fill, create_layer, save, py, status.',
          },
          params: {
            type: 'object',
            additionalProperties: true,
            description: 'Action-specific parameters object; omit when the action takes none.',
          },
        },
      },
    },
    timeoutMs: {
      type: 'integer',
      description: 'Per-call bridge timeout in ms (default 30000, max 600000).',
    },
  },
};

function resultText(action, data) {
  if (data !== null && typeof data === 'object' && data.error !== undefined) {
    const detail = data.error;
    const message = typeof detail === 'string'
      ? detail
      : typeof detail?.message === 'string'
        ? detail.message
        : 'command failed';
    return {
      action,
      ok: false,
      error: message,
      ...(typeof detail?.code === 'string' ? { code: detail.code } : {}),
    };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { action, ok: true, result: data };
  }
  const { status, ...fields } = data;
  return { action, ok: status !== 'error', ...fields };
}

function trimResult(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated; narrow the query or request fewer fields]`;
}

/**
 * @param {{ctx: Record<string, any>, config: ReturnType<import('./config.js').normalizeConfig>,
 *   bridge: import('./bridge.js').KritaBridge,
 *   log: {info: Function, warn: Function, error: Function},
 *   packageRoot: string}} options
 */
export function createKritaTool(options) {
  const { ctx, config, bridge, log, packageRoot } = options;

  async function status() {
    const health = await bridge.health();
    if (!health.ok) {
      const running = isKritaRunning();
      const wedged = running && health.code === 'BRIDGE_TIMEOUT';
      return {
        action: 'status',
        ok: false,
        status: 'down',
        bridge: config.bridgeUrl,
        error: health.error,
        ...(health.code === undefined ? {} : { code: health.code }),
        krita_running: running,
        hint: wedged
          ? 'Krita is running but its bridge is not responding. A blocking py/modal call can wedge the main thread; ask the user to close and reopen Krita (unsaved work may be lost).'
          : 'Run {action:"start"} to launch Krita, or {action:"setup"} if the bridge plugin is not installed yet.',
      };
    }
    let info = null;
    try {
      info = await bridge.call('info', {}, { timeoutMs: 5_000 });
    } catch (error) {
      log.warn(`status: info failed: ${errorMessage(error)}`);
    }
    return {
      action: 'status',
      ok: true,
      status: 'running',
      bridge: config.bridgeUrl,
      health: health.data,
      ...(info === null ? {} : { info: resultText('info', info) }),
    };
  }

  async function start() {
    const current = await status();
    if (current.ok) return { ...current, action: 'start', status: 'running', already_running: true };

    if (isKritaRunning()) {
      throw new Error(
        'Krita is running but its bridge is not answering. Run {action:"setup"} if the plugin is not installed, '
        + `then restart Krita; do not launch a second instance. Details: ${current.error}`,
      );
    }

    const launched = launchKrita(config.kritaPath);
    log.info(`launching Krita: ${config.kritaPath}`);
    const waited = await waitForHealth(bridge, config.startTimeoutMs, log);
    if (!waited.ok) {
      throw new Error(
        `Krita launched but the bridge did not answer within ${config.startTimeoutMs} ms. `
        + 'Make sure the DSH Krita Bridge python plugin is enabled (run {action:"setup"} and restart Krita), '
        + `then check ${config.bridgeUrl}/health. Last error: ${waited.error}`,
      );
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await bridge.call('info', {}, { timeoutMs: 5_000 });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    return {
      action: 'start',
      ok: true,
      status: 'running',
      launched: true,
      pid: launched.pid,
      health: waited.data,
    };
  }

  async function setup() {
    const result = installKritaPlugin(packageRoot, log);
    const health = await bridge.health();
    return {
      action: 'setup',
      ok: true,
      ...result,
      bridge_running: health.ok,
      hint: health.ok
        ? 'Bridge plugin files are installed. If this Krita session was already running before setup, restart Krita once.'
        : 'Restart Krita (or run {action:"start"} if it is closed), then call status.',
    };
  }

  async function handleHost(cmd) {
    switch (cmd.action) {
      case 'status':
        return status();
      case 'start':
        return start();
      case 'setup':
        return setup();
      default:
        return { action: cmd.action, ok: false, error: `unknown host action ${cmd.action}` };
    }
  }

  function validate(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('krita: arguments must be an object');
    }
    const commands = args.commands;
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new Error('krita: `commands` must be a non-empty array');
    }
    if (commands.length > config.maxCommands) {
      throw new Error(`krita: at most ${config.maxCommands} commands per call (got ${commands.length})`);
    }
    const normalized = commands.map((cmd, index) => {
      if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) {
        throw new Error(`krita: command ${index} must be an object like {action, params}`);
      }
      if (typeof cmd.action !== 'string' || cmd.action.trim() === '') {
        throw new Error(`krita: command ${index} needs a non-empty string action`);
      }
      if (cmd.action === 'seq') {
        throw new Error(
          'krita: do not send the bridge-internal `seq` action; pass several items in `commands` instead',
        );
      }
      if (cmd.params !== undefined && (cmd.params === null || typeof cmd.params !== 'object' || Array.isArray(cmd.params))) {
        throw new Error(`krita: command ${index} params must be an object`);
      }
      return { action: cmd.action.trim(), params: cmd.params === undefined ? {} : { ...cmd.params } };
    });
    let timeoutMs = config.requestTimeoutMs;
    if (args.timeoutMs !== undefined) {
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < MIN_TIMEOUT_MS || args.timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`krita: timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
      }
      timeoutMs = args.timeoutMs;
    }
    return { commands: normalized, timeoutMs };
  }

  const definition = {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const { commands, timeoutMs } = validate(args);
      const signal = exec?.signal;
      const results = [];
      let pending = [];
      let fatal = false;
      let skipped = 0;

      const flush = async () => {
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        if (batch.length === 1) {
          const [command] = batch;
          const data = await bridge.call(command.action, command.params, { timeoutMs, signal });
          results.push(resultText(command.action, data));
          return;
        }
        const data = await bridge.seq(batch, { timeoutMs, signal, stopOnError: false });
        const entries = Array.isArray(data?.results) ? data.results : [];
        for (let index = 0; index < batch.length; index += 1) {
          const command = batch[index];
          const entry = entries[index];
          if (entry === undefined) {
            results.push({ action: command.action, ok: false, error: 'missing bridge result' });
            fatal = true;
            continue;
          }
          if (entry.error !== undefined) {
            results.push(resultText(command.action, { error: entry.error }));
            continue;
          }
          results.push(resultText(command.action, entry.result ?? {}));
        }
        if (data?.status === 'error') fatal = true;
      };

      for (let index = 0; index < commands.length; index += 1) {
        const command = commands[index];
        if (fatal) {
          skipped += 1;
          continue;
        }
        try {
          if (HOST_ACTIONS.has(command.action)) {
            await flush();
            const hostResult = await handleHost(command);
            results.push(hostResult);
            if (hostResult.ok === false && command.action !== 'status') fatal = true;
          } else {
            resolveCommandPath(command, ctx, exec);
            pending.push(command);
          }
        } catch (error) {
          pending = [];
          fatal = true;
          results.push({ action: command.action, ok: false, error: errorMessage(error) });
        }
      }

      if (!fatal) {
        try {
          await flush();
        } catch (error) {
          fatal = true;
          results.push({ action: 'bridge', ok: false, error: errorMessage(error) });
        }
      } else {
        pending = [];
      }

      const payload = {
        ok: !fatal,
        ...(skipped > 0 ? { skipped } : {}),
        results,
      };
      return trimResult(JSON.stringify(payload), config.maxResultChars);
    },
  };

  return definition;
}
