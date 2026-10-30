/**
 * Retry a model step when the provider rejects a stream because a tool call's
 * arguments are malformed JSON (`MALFORMED_RESPONSE`).
 *
 * DSH's built-in DeepSeek retry policy covers EMPTY_RESPONSE/RATE_LIMIT/SERVER/
 * TIMEOUT/TRANSPORT only, so a model that emits one missing brace currently
 * ends the whole turn. This listener owns bounded recovery for that exact code
 * and otherwise delegates to the normal waterfall. It is global, so it also
 * covers sessions already open when the plugin is installed.
 *
 * No business service is injected: only the Cordis event API is used, so a
 * missing/unrelated profile cannot leave the plugin pending.
 */

const MAX_RETRIES_PER_STEP = 2;
const BASE_DELAY_MS = 800;

export const name = 'dsh-malformed-json-retry';
export const inject = [];

export function apply(ctx) {
  /** @type {Map<string, number>} turn/step key -> attempts already used */
  const attempts = new Map();

  function prune() {
    if (attempts.size <= 256) return;
    const drop = attempts.size - 128;
    let index = 0;
    for (const key of attempts.keys()) {
      attempts.delete(key);
      if (++index >= drop) break;
    }
  }

  ctx.effect(function* installMalformedJsonRetry() {
    yield ctx.on(
      'agent/request-error',
      async (payload, next) => {
        const failure = payload?.failure;
        if (failure === null || typeof failure !== 'object' || failure.code !== 'MALFORMED_RESPONSE') {
          return next();
        }
        if (payload.signal?.aborted) return next();

        const agentId = payload.agent?.id ?? 'unknown';
        const key = `${agentId}:${payload.turn}:${payload.step}`;
        const used = attempts.get(key) ?? 0;
        if (used >= MAX_RETRIES_PER_STEP) {
          attempts.delete(key);
          return next();
        }

        attempts.set(key, used + 1);
        prune();
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS + used * 700));
        if (payload.signal?.aborted) return next();
        return { kind: 'retry' };
      },
      { global: true, prepend: true },
    );
  }, 'malformed-json-retry');
}
