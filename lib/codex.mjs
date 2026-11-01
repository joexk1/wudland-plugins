// Codex `notify` program: called with one JSON argument after each agent turn.
import { spawn } from 'node:child_process';
import { hasLink } from './config.mjs';
import { folderName, titleFrom } from './events.mjs';
import { track } from './track.mjs';

/** Map a notify payload to a track() intent. Only "agent-turn-complete" exists today. */
export function intentFromNotify(payload) {
  if (!payload || payload.type !== 'agent-turn-complete') return null;
  const sid = payload['thread-id'] || payload.thread_id;
  if (!sid) return null;
  const first = Array.isArray(payload['input-messages']) ? payload['input-messages'][0] : null;
  return {
    sid: String(sid), src: 'codex', where: folderName(payload.cwd), state: 'idle',
    name: titleFrom(typeof first === 'string' ? first : first?.text) || undefined,
    note: 'Finished a turn',
  };
}

/** WUDLAND_CHAIN_NOTIFY: a JSON array or a plain command line, run with the payload appended. */
export function chainCommand(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length) return parsed.map(String);
  } catch { /* not JSON */ }
  const parts = value.match(/"[^"]*"|'[^']*'|\S+/g);
  return parts ? parts.map((p) => p.replace(/^(["'])(.*)\1$/, '$2')) : null;
}

export function runCodexNotify(rawJson, env = process.env) {
  const chain = chainCommand(env.WUDLAND_CHAIN_NOTIFY);
  if (chain) {
    try {
      const c = spawn(chain[0], [...chain.slice(1), rawJson], { detached: true, stdio: 'ignore' });
      c.on('error', () => {});
      c.unref();
    } catch { /* ignore */ }
  }
  try {
    if (!hasLink()) return;
    const intent = intentFromNotify(JSON.parse(rawJson));
    if (intent) track(intent);
  } catch { /* swallow */ }
}
