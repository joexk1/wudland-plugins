// Turns an "intent" (what just happened in some agent) into a throttled, detached send.
// Shared by the hook handlers, `emit` and `run`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostLabel, readConfig, readState, writeState } from './config.mjs';
import { buildEvent, isoNow } from './events.mjs';
import { decide, session } from './throttle.mjs';

const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));

/** Default spawner: a detached node process that outlives us. */
export function spawnWorker(job) {
  const child = spawn(process.execPath, [WORKER], {
    detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(job));
  child.unref();
}

/**
 * intent: { sid, src, state, where, note, tool, countTool, name, forceName, model, parent, tools }
 * Returns the decision ({action}) or null when there is no link.
 */
export function track(intent, { now = Date.now(), spawnFn = spawnWorker } = {}) {
  const cfg = readConfig();
  if (!cfg.links.length) return null;
  const state = readState();
  const s = session(state, intent.sid, now);

  s.seenAt = now;
  s.started ||= isoNow(now);
  if (intent.where) s.where = intent.where;
  if (intent.model) s.model = intent.model;
  if (intent.parent) s.parent = intent.parent;
  if (intent.name && (intent.forceName || !s.name)) s.name = intent.name;
  if (intent.tool) s.tool = intent.tool;
  if (typeof intent.tools === 'number') s.tools = intent.tools;
  else if (intent.countTool) s.tools += 1;

  const evt = buildEvent({
    sid: intent.sid, src: intent.src, host: hostLabel(cfg), name: s.name, where: s.where,
    state: intent.state, tool: s.tool, tools: s.tools, model: s.model, started: s.started,
    note: intent.note, parent: s.parent, titles: cfg.titles, now,
  });
  const d = decide(state, intent.sid, evt, now);
  writeState(state);

  try {
    if (d.action === 'send') spawnFn({ evt });
    else if (d.action === 'defer') spawnFn({ sid: intent.sid, seq: d.seq, delayMs: d.delayMs });
  } catch { /* never let a failed spawn reach the agent */ }
  return d;
}
