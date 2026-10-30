/**
 * Live verification that a configured color-adjustment filter accepts
 * InfoObject properties (hsvadjustment) and visibly changes the layer.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const commands = [
  { action: 'new_canvas', params: { width: 160, height: 160, name: 'filter-hsv-test', background: '#ffffff' } },
  { action: 'create_layer', params: { name: 'paint' } },
  { action: 'set_color', params: { color: '#ff0000' } },
  { action: 'draw_shape', params: { shape: 'rectangle', x: 20, y: 20, width: 120, height: 120, fill: true } },
  { action: 'get_color_at', params: { x: 80, y: 80 } },
  { action: 'filter', params: { name: 'hsvadjustment', config: { h: 120 } } },
  { action: 'get_color_at', params: { x: 80, y: 80 } },
  { action: 'save', params: { path: join(outDir, 'filter-hsv-after.png') } },
  { action: 'doc_save', params: { path: join(outDir, 'filter-hsv-test.kra') } },
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
if (data.status !== 'ok') throw new Error('hsv filter sequence failed');
const colors = (data.results ?? [])
  .filter((entry) => entry.action === 'get_color_at')
  .map((entry) => entry.result?.color);
const filterResult = data.results.find((entry) => entry.action === 'filter')?.result;
if (!filterResult?.configured) throw new Error(`hsv filter was not configured: ${JSON.stringify(filterResult)}`);
if (!colors[0] || !colors[1] || colors[0] === colors[1]) {
  throw new Error(`hsv adjustment did not change the pixel: ${JSON.stringify(colors)}`);
}
console.log(`PASS configured hsvadjustment: ${colors[0]} -> ${colors[1]}`);
