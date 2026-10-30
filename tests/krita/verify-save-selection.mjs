/**
 * Live verification for the save_selection -> load_selection round trip.
 * Requires the Krita bridge on 127.0.0.1:5678 and a running Krita.
 * Creates a scratch 64x64 document and writes a mask under tests/out/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const maskPath = join(outDir, 'selection-roundtrip-mask.png');

const commands = [
  { action: 'new_canvas', params: { width: 64, height: 64, name: 'selection-roundtrip', background: '#ffffff' } },
  { action: 'select_rect', params: { x: 10, y: 10, width: 20, height: 20 } },
  { action: 'selection_stats' },
  {
    action: 'save_selection',
    params: { path: maskPath },
  },
  { action: 'deselect' },
  { action: 'selection_stats' },
  {
    action: 'load_selection',
    params: { path: maskPath },
  },
  { action: 'selection_stats' },
  { action: 'doc_save', params: { path: join(outDir, 'selection-roundtrip.kra') } },
  { action: 'doc_close', params: { save: true } },
];

const response = await fetch('http://127.0.0.1:5678/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'seq', params: { commands } }),
  signal: AbortSignal.timeout(30_000),
});
const data = await response.json();
console.log(JSON.stringify(data, null, 2));

const counts = (data.results ?? [])
  .filter((entry) => entry.action === 'selection_stats')
  .map((entry) => entry.result?.pixel_count ?? entry.result?.count ?? null);
if (data.status !== 'ok') throw new Error(`seq failed: ${JSON.stringify(data)}`);
if (counts.length < 3 || counts[0] <= 0 || counts[1] !== 0 || counts[2] !== counts[0]) {
  throw new Error(`unexpected selection pixel counts: ${JSON.stringify(counts)}`);
}
console.log(`PASS save_selection round trip: ${JSON.stringify(counts)}`);
