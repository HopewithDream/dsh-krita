/**
 * Live verification for the `py` file mode: a UTF-8 script with quotes, braces,
 * and newlines runs without putting the script into tool-call JSON.
 */
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./py_file_test.py', import.meta.url));
const response = await fetch('http://127.0.0.1:5678/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'py', params: { file, mode: 'exec' } }),
  signal: AbortSignal.timeout(20_000),
});
const data = await response.json();
console.log(JSON.stringify(data, null, 2));
if (data.status !== 'ok') throw new Error(`py file failed: ${JSON.stringify(data)}`);
if (!String(data.stdout).includes('file_mode_ok py_file_test.py')) {
  throw new Error('file-based py did not print the expected stdout');
}
if (!String(data.stdout).includes('value 2')) {
  throw new Error('file-based py did not execute the payload');
}
console.log('PASS py file mode');
