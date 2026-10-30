/**
 * Tiny HTTP client for the Krita-side `kritamcp` bridge.
 *
 * The bridge speaks one JSON object per request:
 *   POST /  {"action": "...", "params": {...}}
 *   GET  /health
 * Errors use `{"error":{"message","code","recoverable"}}`.
 */

export class BridgeError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, recoverable?: boolean, cause?: unknown}} [details]
   */
  constructor(message, details = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'BridgeError';
    this.code = details.code ?? 'BRIDGE_ERROR';
    this.recoverable = details.recoverable ?? true;
  }
}

/** @param {unknown} error */
export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class KritaBridge {
  /**
   * @param {{host: string, port: number, requestTimeoutMs: number, bridgeUrl: string}} config
   * @param {{debug: Function, info: Function, warn: Function, error: Function}} logger
   */
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.url = config.bridgeUrl;
  }

  /**
   * One HTTP request with cooperative cancellation and a hard timeout.
   * @param {string} path
   * @param {{method?: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal}} options
   */
  async request(path, options = {}) {
    const method = options.method ?? 'GET';
    const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : this.config.requestTimeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
    const init = { method, signal, headers: { accept: 'application/json' } };
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(`${this.url}${path}`, init);
    } catch (error) {
      if (signal.aborted) {
        throw new BridgeError(`Krita bridge request timed out after ${timeoutMs} ms`, {
          code: 'BRIDGE_TIMEOUT',
          cause: error,
        });
      }
      throw new BridgeError(
        `Krita bridge unreachable at ${this.url}. Start Krita and enable the DSH Krita Bridge python plugin.`,
        { code: 'BRIDGE_UNREACHABLE', cause: error },
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new BridgeError(
        `Krita bridge returned a non-JSON response (HTTP ${response.status})`,
        { code: 'BRIDGE_BAD_RESPONSE', cause: error },
      );
    }

    if (data !== null && typeof data === 'object' && data.error !== undefined) {
      const detail = data.error;
      const message = typeof detail === 'string'
        ? detail
        : typeof detail?.message === 'string'
          ? detail.message
          : 'Krita bridge command failed';
      throw new BridgeError(message, {
        code: typeof detail?.code === 'string' ? detail.code : 'BRIDGE_COMMAND_ERROR',
        recoverable: detail?.recoverable !== false,
      });
    }
    if (!response.ok) {
      throw new BridgeError(`Krita bridge HTTP ${response.status}`, {
        code: 'BRIDGE_HTTP_ERROR',
      });
    }
    return data;
  }

  /** @param {number} [timeoutMs] */
  async health(timeoutMs = 2_000) {
    try {
      const data = await this.request('/health', { timeoutMs });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: errorMessage(error), code: error?.code };
    }
  }

  /**
   * Send one bridge action.
   * @param {string} action
   * @param {Record<string, unknown>} [params]
   * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
   */
  async call(action, params = {}, options = {}) {
    return this.request('/', {
      method: 'POST',
      body: { action, params: params ?? {} },
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  /**
   * Send several commands in one round trip without the snapshot cost of the
   * legacy `batch` action.
   * @param {Array<{action: string, params?: Record<string, unknown>}>} commands
   * @param {{timeoutMs?: number, signal?: AbortSignal, stopOnError?: boolean}} [options]
   */
  async seq(commands, options = {}) {
    return this.call(
      'seq',
      { commands, stop_on_error: options.stopOnError === true },
      { timeoutMs: options.timeoutMs, signal: options.signal },
    );
  }
}
