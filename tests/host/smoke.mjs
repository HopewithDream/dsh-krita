/**
 * Offline smoke test for the dsh-krita Host tool. No Krita or DSH process is
 * required: a fake bridge exercises command ordering, batching, host actions,
 * validation, and compact rendering.
 *
 * Run: node tests/host/smoke.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeConfig } from '../../lib/config.js';
import { createKritaTool } from '../../lib/tool.js';
import { enablePythonPlugin } from '../../lib/install.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const config = normalizeConfig({ port: 5678, requestTimeoutMs: 5_000 });

const calls = [];
const fakeBridge = {
  async health() {
    calls.push(['health']);
    return { ok: true, data: { status: 'ok', protocol_version: '1.1.0' } };
  },
  async call(action, params) {
    calls.push(['call', action, params]);
    if (action === 'info') {
      return { status: 'ok', active_doc: { name: 'test.kra', width: 64, height: 64 }, layer: 'Background' };
    }
    return { status: 'ok', action, echo: params };
  },
  async seq(commands) {
    calls.push(['seq', commands]);
    return {
      status: 'ok',
      results: commands.map((command) => ({
        action: command.action,
        status: 'ok',
        result: { status: 'ok', echo: command.params },
      })),
    };
  },
};

const tool = createKritaTool({
  config,
  bridge: fakeBridge,
  log: { info() {}, warn() {}, error() {} },
  packageRoot,
});
const signal = new AbortController().signal;

// 1. A single bridge command is sent directly, not wrapped in seq.
{
  calls.length = 0;
  const text = await tool.execute(
    { commands: [{ action: 'new_canvas', params: { width: 64, height: 64 } }] },
    { signal },
  );
  const parsed = JSON.parse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.results[0].action, 'new_canvas');
  assert.deepEqual(calls.map((call) => call[0]), ['call']);
  assert.equal(calls[0][1], 'new_canvas');
}

// 2. Several consecutive bridge commands go through one seq round trip.
{
  calls.length = 0;
  const text = await tool.execute(
    {
      commands: [
        { action: 'set_color', params: { color: '#ff0000' } },
        { action: 'stroke', params: { points: [[0, 0], [1, 1]] } },
        { action: 'save', params: { path: 'out.png' } },
      ],
    },
    { signal },
  );
  const parsed = JSON.parse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.results.length, 3);
  assert.deepEqual(calls.map((call) => call[0]), ['seq']);
  assert.equal(calls[0][1].length, 3);
}

// 3. status + bridge commands flush in order; host action does not enter seq.
{
  calls.length = 0;
  const text = await tool.execute(
    {
      commands: [
        { action: 'status' },
        { action: 'stroke', params: { points: [[0, 0]] } },
      ],
    },
    { signal },
  );
  const parsed = JSON.parse(text);
  assert.equal(parsed.results[0].status, 'running');
  assert.deepEqual(calls.map((call) => call[0]), ['health', 'call', 'call']);
}

// 4. Bad arguments fail before touching the bridge.
{
  calls.length = 0;
  await assert.rejects(
    tool.execute({ commands: [] }, { signal }),
    /non-empty array/,
  );
  await assert.rejects(
    tool.execute({ commands: [{ action: 'seq' }] }, { signal }),
    /do not send the bridge-internal/,
  );
  await assert.rejects(
    tool.execute({ commands: [{ action: 'stroke' }], timeoutMs: 10 }, { signal }),
    /timeoutMs/,
  );
  assert.equal(calls.length, 0);
}

// 5. Sub-command errors surface compactly and set ok=false.
{
  const failingBridge = {
    health: fakeBridge.health,
    call: fakeBridge.call,
    async seq() {
      return {
        status: 'partial',
        results: [
          { action: 'stroke', status: 'ok', result: { status: 'ok' } },
          { action: 'fill', status: 'error', error: { message: 'No active layer', code: 'NO_ACTIVE_LAYER' } },
        ],
      };
    },
  };
  const failingTool = createKritaTool({
    config,
    bridge: failingBridge,
    log: { info() {}, warn() {}, error() {} },
    packageRoot,
  });
  const parsed = JSON.parse(await failingTool.execute(
    { commands: [{ action: 'stroke' }, { action: 'fill' }] },
    { signal },
  ));
  assert.equal(parsed.results[1].ok, false);
  assert.equal(parsed.results[1].error, 'No active layer');
  assert.equal(parsed.results[1].code, 'NO_ACTIVE_LAYER');
}

// 6. Relative file paths resolve against the session directory and parent dirs
//    are created host-side before the bridge sees the command.
{
  const captured = [];
  const pathBridge = {
    health: fakeBridge.health,
    async call(action, params) {
      captured.push({ action, params });
      return { status: 'ok', path: params.path };
    },
    async seq(commands) {
      captured.push({ action: 'seq', commands });
      return { status: 'ok', results: commands.map((command) => ({ action: command.action, status: 'ok', result: { status: 'ok' } })) };
    },
  };
  const outDir = fileURLToPath(new URL('./out', import.meta.url));
  const fakeCtx = {
    get(name) {
      if (name === 'workingDirectory') return { get: () => outDir };
      return undefined;
    },
  };
  const pathTool = createKritaTool({
    ctx: fakeCtx,
    config,
    bridge: pathBridge,
    log: { info() {}, warn() {}, error() {} },
    packageRoot,
  });
  const parsed = JSON.parse(await pathTool.execute(
    { commands: [{ action: 'save', params: Object.freeze({ path: 'nested/rel.png' }) }] },
    { signal, agent: { session: 'test-session' } },
  ));
  assert.equal(parsed.results[0].ok, true);
  const sent = captured[0];
  assert.equal(sent.action, 'save');
  assert.equal(sent.params.path, `${outDir}\\nested\\rel.png`);
  assert.ok(existsSync(join(outDir, 'nested')), 'parent directory should be created');
  rmSync(join(outDir, 'nested'), { recursive: true, force: true });
}

// 7. kritarc editor preserves unrelated content and handles all section shapes.
{
  assert.equal(
    enablePythonPlugin('[General]\nX=1\n'),
    '[General]\nX=1\n[python]\nenable_kritamcp=true\n',
  );
  assert.equal(
    enablePythonPlugin('[python]\nfoo=1\n[Other]\n'),
    '[python]\nenable_kritamcp=true\nfoo=1\n[Other]\n',
  );
  assert.equal(
    enablePythonPlugin('[python]\nenable_kritamcp=false\n[Other]\n'),
    '[python]\nenable_kritamcp=true\n[Other]\n',
  );
}

console.log('PASS dsh-krita host smoke test');
