/**
 * Installation and lifecycle helpers for the Krita side of the bridge.
 *
 * `setup` copies the vendored Krita python plugin into the user's Krita
 * resource directory and enables it in `kritarc`; `start` launches the Krita
 * executable and waits for the bridge's `/health` endpoint.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODULE_NAME = 'kritamcp';
const ENABLE_KEY = `enable_${MODULE_NAME}`;

export function kritaResourceDir() {
  const appData = process.env.APPDATA;
  if (typeof appData === 'string' && appData !== '') {
    return join(appData, 'krita', 'pykrita');
  }
  return join(homedir(), 'AppData', 'Roaming', 'krita', 'pykrita');
}

export function kritarcPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === 'string' && localAppData !== '') {
    return join(localAppData, 'kritarc');
  }
  return join(homedir(), 'AppData', 'Local', 'kritarc');
}

/**
 * Insert or update `enable_kritamcp=true` inside the `[python]` section while
 * preserving every other byte of the user's Krita config.
 * @param {string} content
 */
export function enablePythonPlugin(content) {
  const line = `${ENABLE_KEY}=true`;
  const sectionMatch = /(^|\r?\n)\[python\][^\r\n]*(?:\r?\n|$)/.exec(content);

  if (sectionMatch === null) {
    const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}[python]\n${line}\n`;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const rest = content.slice(sectionStart);
  const nextSection = /(^|\r?\n)\[/.exec(rest);
  const sectionEnd = nextSection === null ? content.length : sectionStart + nextSection.index;
  const section = content.slice(sectionStart, sectionEnd);
  const existing = new RegExp(`^${ENABLE_KEY}\\s*=.*$`, 'm');

  if (existing.test(section)) {
    return content.slice(0, sectionStart)
      + section.replace(existing, line)
      + content.slice(sectionEnd);
  }

  // `sectionStart` is already at the beginning of the line after the header.
  return content.slice(0, sectionStart) + line + '\n' + content.slice(sectionStart);
}

/**
 * Copy the vendored Krita plugin into the resource directory and enable it.
 * @param {string} packageRoot absolute path to the dsh-krita package
 */
export function installKritaPlugin(packageRoot, log) {
  const source = join(packageRoot, 'krita-plugin');
  const sourceModule = join(source, MODULE_NAME);
  const sourceDesktop = join(source, `${MODULE_NAME}.desktop`);
  if (!existsSync(sourceModule) || !existsSync(sourceDesktop)) {
    throw new Error(
      `Krita bridge files not found under ${source}. The bundle is incomplete; reinstall dsh-krita-painter.`,
    );
  }

  const resourceDir = kritaResourceDir();
  mkdirSync(resourceDir, { recursive: true });
  const destination = join(resourceDir, MODULE_NAME);
  cpSync(sourceModule, destination, { recursive: true, force: true });
  copyFileSync(sourceDesktop, join(resourceDir, `${MODULE_NAME}.desktop`));

  const configPath = kritarcPath();
  let config = '';
  try {
    config = readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const next = enablePythonPlugin(config);
  if (next !== config || !existsSync(configPath)) {
    const temporary = `${configPath}.dsh-krita.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, next, 'utf8');
      renameSync(temporary, configPath);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        /* best effort */
      }
      throw new Error(`Could not update ${configPath}: ${error.message}`);
    }
  }

  log?.info(`Krita bridge installed to ${destination}`);
  return {
    installed_to: destination,
    desktop_file: join(resourceDir, `${MODULE_NAME}.desktop`),
    config: configPath,
    enabled: `${ENABLE_KEY}=true`,
    restart_required: isKritaRunning(),
  };
}

/** Best-effort check whether a Krita GUI process is running on this machine. */
export function isKritaRunning() {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'tasklist',
        ['/FI', 'IMAGENAME eq krita.exe', '/NH'],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true },
      );
      return output.toLowerCase().includes('krita.exe');
    }
    const output = execFileSync('pgrep', ['-x', 'krita'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return output.trim() !== '';
  } catch {
    return false;
  }
}

/** Launch Krita detached; returns immediately. */
export function launchKrita(kritaPath) {
  if (!existsSync(kritaPath)) {
    throw new Error(`Krita executable not found at ${kritaPath}. Set kritaPath in the preset config.`);
  }
  const child = spawn(kritaPath, ['--nosplash'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return { pid: child.pid ?? null };
}

/**
 * Poll `/health` until the bridge answers or the budget expires.
 * @param {{health: (timeoutMs?: number) => Promise<{ok: boolean, data?: unknown, error?: string}>}} bridge
 * @param {number} timeoutMs
 * @param {{info: Function, warn: Function}} log
 */
export async function waitForHealth(bridge, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const result = await bridge.health(1_500);
    if (result.ok) return result;
    lastError = result.error ?? 'unknown error';
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  log?.warn(`Krita bridge did not become ready within ${timeoutMs} ms: ${lastError}`);
  return { ok: false, error: lastError };
}
