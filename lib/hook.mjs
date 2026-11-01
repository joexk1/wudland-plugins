// Hook handlers for Claude Code and Codex. Both send the same JSON shape on stdin.
// Everything here is best effort: no output, no errors, always exit 0.
import { hasLink } from './config.mjs';
import { folderName, titleFrom, toolNote, clip } from './events.mjs';
import { track } from './track.mjs';

/** Map a hook payload to a track() intent, or null if it is not interesting. */
export function intentFromHook(src, input, { titles = true } = {}) {
  if (!input || typeof input !== 'object' || !input.session_id) return null;
  const cwd = input.cwd;
  const base = { src, where: folderName(cwd), model: input.model };
  // Inside a subagent, show it as its own villager under the parent.
  const sub = input.agent_id ? { sid: `${input.session_id}:${input.agent_id}`, parent: input.session_id, name: input.agent_type || 'subagent' } : null;
  const sid = sub ? sub.sid : input.session_id;
  const common = { ...base, sid, ...(sub ? { parent: sub.parent, name: sub.name } : {}) };

  switch (input.hook_event_name) {
    case 'SessionStart':
      return { ...common, state: 'idle', note: input.source === 'resume' ? 'Resumed' : 'Session started' };
    case 'UserPromptSubmit':
      return { ...common, state: 'busy', note: 'Working on a prompt', name: sub ? sub.name : titleFrom(input.prompt) || undefined };
    case 'PreToolUse':
      return { ...common, state: 'busy', tool: input.tool_name, countTool: true,
        note: toolNote(input.tool_name, input.tool_input, { cwd, paths: titles }) };
    case 'PostToolUse':
      return { ...common, state: 'busy', tool: input.tool_name,
        note: toolNote(input.tool_name, input.tool_input, { cwd, past: true, paths: titles }) };
    case 'Notification': {
      const kind = input.notification_type;
      const note = kind === 'permission_prompt' ? 'Needs your permission'
        : kind === 'idle_prompt' ? 'Waiting for you' : clip(input.message || 'Needs you', 120);
      return { ...common, state: 'waiting', note };
    }
    case 'PermissionRequest':
      return { ...common, state: 'waiting', note: 'Needs your permission' };
    case 'Stop':
      return { ...common, state: 'idle', note: 'Finished a turn' };
    case 'SubagentStop':
      // Closes the subagent's villager; without an agent id, note it on the parent.
      return sub ? { ...common, state: 'done', note: 'Subagent finished' }
        : { ...base, sid, state: 'busy', note: 'Subagent finished' };
    case 'SessionEnd':
      return { ...common, state: 'done', note: input.reason ? `Session ended (${clip(input.reason, 40)})` : 'Session ended' };
    default:
      return null;
  }
}

async function readStdin(limitMs = 1000) {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, limitMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

/** Entry point used by the CLI and by the plugin launcher. Never throws. */
export async function runHook(src) {
  try {
    const raw = await readStdin();       // always drain so the agent never sees a broken pipe
    if (!hasLink()) return;              // not linked: do nothing at all
    const { readConfig } = await import('./config.mjs');
    const intent = intentFromHook(src, JSON.parse(raw), { titles: readConfig().titles !== false });
    if (intent) track(intent);
  } catch { /* swallow everything */ }
}
