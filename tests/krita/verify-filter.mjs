/**
 * Live verification for configured filters (v1.1 filter config path).
 * Creates a scratch document, paints a hard-edged rectangle, applies a
 * configured blur, samples a pixel outside the original edge, exports before/
 * after PNGs, then saves and closes the scratch document.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const commands = [
  { action: 'filter_config', params: { name: 'blur' } },
  { action: 'new_canvas', params: { width: 320, height: 240, name: 'filter-config-test', background: '#ffffff' } },
  { action: 'create_layer', params: { name: 'paint' } },
  { action: 'set_color', params: { color: '#1d3557' } },
  { action: 'draw_shape', params: { shape: 'rectangle', x: 80, y: 60, width: 120, height: 100, fill: true, stroke: false } },
  { action: 'get_color_at', params: { x: 74, y: 100 } },
  { action: 'save', params: { path: join(outDir, 'filter-before.png') } },
  {
    action: 'filter',
    params: { name: 'blur', config: { halfWidth: 16, halfHeight: 16, strength: 100 } },
  },
  { action: 'get_color_at', params: { x: 74, y: 100 } },
  { action: 'save', params: { path: join(outDir, 'filter-after.png') } },
  { action: 'doc_save', params: { path: join(outDir, 'filter-test.kra') } },
  { action: 'doc_close', params: { save: true } },
];

const response = await fetch('http://127.0.0.1:5678/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'seq', params: { commands } }),
  signal: AbortSignal.timeout(60_000),
});
const data = await response.json();
console.log(JSON.stringify(data, null, 2));
if (data.status !== 'ok') throw new Error('filter sequence failed');
const colors = (data.results ?? [])
  .filter((entry) => entry.action === 'get_color_at')
  .map((entry) => entry.result?.color);
const filterResult = data.results.find((entry) => entry.action === 'filter')?.result;
const configResult = data.results.find((entry) => entry.action === 'filter_config')?.result;
if (!configResult?.properties?.halfWidth) {
  throw new Error(`filter_config did not return blur properties: ${JSON.stringify(configResult)}`);
}
if (!filterResult?.configured) throw new Error(`filter was not configured: ${JSON.stringify(filterResult)}`);
if (!colors[0] || !colors[1] || colors[1] === colors[0]) {
  throw new Error(`blur did not affect the sampled edge pixel: ${JSON.stringify(colors)}`);
}
console.log(`PASS configured blur: edge ${colors[0]} -> ${colors[1]}, config ${JSON.stringify(filterResult.config)}`);
