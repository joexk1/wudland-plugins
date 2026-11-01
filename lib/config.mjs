// Config and state on disk. link.json holds links + settings, state.json holds
// per-session bookkeeping and the daily send counter. Both are mode 0600.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
function writeState(s) {
  // Forget sessions we have not heard from in 24 hours.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, v] of Object.entries(s.sessions || {})) if ((v.seenAt || 0) < cutoff) delete s.sessions[k];
  writeJson(statePath(), s);
}

/**
 * Serialize a short synchronous read/modify/write operation across processes.
 * A fully populated candidate directory is renamed into place atomically: an
 * existing nonempty lock directory cannot be replaced. The unique owner file
 * also makes crashed-owner recovery safe when several contenders race: only
 * one can unlink that exact owner's file, and rmdir cannot remove a new owner's
 * nonempty directory. Never hold this lock across network I/O or an await.
 */
export function withStateLock(fn, { maxWaitMs = 120 } = {}) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = `${process.pid}-${randomUUID()}`;
  const candidate = join(dir, `.state-lock-${token}`);
  const lock = join(dir, 'state.lock');
  const owner = `owner-${token}`;
  mkdirSync(candidate, { mode: 0o700 });
  writeFileSync(join(candidate, owner), '', { mode: 0o600 });
  const deadline = performance.now() + maxWaitMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let acquired = false;
  try {
    while (!acquired) {
      try { renameSync(candidate, lock); acquired = true; }
      catch (e) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
        // Remove only a confirmed dead owner's unique file. A new owner has
        // a different file name, so another reaper cannot unlink its ownership.
        try {
          const owners = readdirSync(lock);
          if (!owners.length) { try { rmdirSync(lock); } catch { /* a populated candidate arrived */ } }
          for (const name of owners) {
            const match = /^owner-(\d+)-[a-f0-9-]+$/.exec(name);
            if (!match) continue;
            let dead = false;
            try { process.kill(Number(match[1]), 0); }
            catch (err) { dead = err.code === 'ESRCH'; }
            if (dead) {
              unlinkSync(join(lock, name));
              try { rmdirSync(lock); } catch { /* a new populated owner won */ }
            }
          }
        } catch { /* ownership changed or another contender already recovered */ }
        if (performance.now() >= deadline) {
          const busy = new Error('Wudland state is busy. Try again shortly.');
          busy.code = 'WUDLAND_STATE_BUSY';
          throw busy;
        }
        Atomics.wait(sleeper, 0, 0, Math.min(4, Math.max(0, deadline - performance.now())));
      }
    }
    const result = fn();
    if (result && typeof result.then === 'function') throw new TypeError('State transactions must be synchronous');
    return result;
  } finally {
    // After unlink, rename by another process may replace the empty directory;
    // rmdir fails safely if it already contains that process's owner file.
    const owned = acquired ? lock : candidate;
    try { unlinkSync(join(owned, owner)); } catch { /* best effort */ }
    try { rmdirSync(owned); } catch { /* a new owner holds the lock */ }
  }
}

/** Apply a state mutation and atomically save it while holding the process lock. */
export function updateState(mutate, options) {
  return withStateLock(() => {
    const state = readState();
    const result = mutate(state);
    if (result && typeof result.then === 'function') throw new TypeError('State transactions must be synchronous');
    writeState(state);
    return result;
  }, options);
}
