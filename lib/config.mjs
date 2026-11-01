// Config and state on disk. link.json holds links + settings, state.json holds
// per-session bookkeeping and the daily send counter. Both are mode 0600.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

export function configDir() {
  if (process.env.WUDLAND_HOME) return process.env.WUDLAND_HOME;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'wudland');
}
export const linkPath = () => join(configDir(), 'link.json');
export const statePath = () => join(configDir(), 'state.json');

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

// Write via a temp file then rename, so a concurrent reader never sees half a file.
function writeJson(path, data) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* best effort */ }
  renameSync(tmp, path);
}

/** Default host label: hostname before the first dot, lowercased, max 24 chars. */
export function defaultHost() {
  return (hostname().split('.')[0] || 'computer').toLowerCase().slice(0, 24);
}

const DEFAULTS = () => ({ v: 1, titles: true, relay: null, host: null, links: [] });

export function readConfig() {
  const c = { ...DEFAULTS(), ...readJson(linkPath(), {}) };
  if (!Array.isArray(c.links)) c.links = [];
  return c;
}
export const writeConfig = (c) => writeJson(linkPath(), c);

/** Cheap check used by hooks before doing any other work. */
export function hasLink() {
  if (!existsSync(linkPath())) return false;
  return readConfig().links.length > 0;
}

export const hostLabel = (c) => (c.host || defaultHost()).slice(0, 24);

export function readState() {
  const s = readJson(statePath(), {});
  return { sessions: {}, day: '', count: 0, ...s };
}
export function writeState(s) {
  // Forget sessions we have not heard from in 24 hours.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, v] of Object.entries(s.sessions || {})) if ((v.seenAt || 0) < cutoff) delete s.sessions[k];
  writeJson(statePath(), s);
}
