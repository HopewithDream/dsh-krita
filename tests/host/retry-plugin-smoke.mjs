/**
 * Offline smoke test for the malformed-json-retry profile plugin.
 * Verifies bounded retry for MALFORMED_RESPONSE and delegation for other codes.
 */
import assert from 'node:assert/strict';
import { apply } from '../../extras/malformed-json-retry/index.js';

let handler;
const disposers = [];
const ctx = {
  effect(generator) {
    const iterator = generator();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (typeof next.value === 'function') disposers.push(next.value);
    }
    return () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
  },
  on(event, callback, options) {
    assert.equal(event, 'agent/request-error');
    assert.deepEqual(options, { global: true, prepend: true });
    handler = callback;
    return () => {};
  },
};

apply(ctx);
assert.equal(typeof handler, 'function');

const signal = new AbortController().signal;
const payload = {
  agent: { id: 'session-test' },
  turn: 1,
  step: 3,
  provider: 'deepseek-official',
  failure: { code: 'MALFORMED_RESPONSE', message: 'tool input is invalid JSON' },
  signal,
};

let delegated = 0;
const next = async () => {
  delegated += 1;
  return undefined;
};

assert.deepEqual(await handler(payload, next), { kind: 'retry' });
assert.deepEqual(await handler(payload, next), { kind: 'retry' });
assert.equal(await handler(payload, next), undefined);
assert.equal(delegated, 1, 'third attempt must delegate');

const other = { ...payload, failure: { code: 'RATE_LIMIT', message: 'slow down' } };
assert.equal(await handler(other, next), undefined);
assert.equal(delegated, 2);

const aborted = new AbortController();
aborted.abort();
assert.equal(await handler({ ...payload, signal: aborted.signal }, next), undefined);

console.log('PASS malformed-json-retry plugin smoke test');
