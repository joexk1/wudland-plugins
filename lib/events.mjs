// Builds the plaintext event objects defined in PROTOCOL.md.
import { basename, isAbsolute, relative } from 'node:path';

export const STATES = ['busy', 'waiting', 'idle', 'done', 'failed'];

/** Truncate to `max` characters (code points), ending with an ellipsis when cut. */
export function clip(text, max) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

/** Session title from the first line of a prompt, max 60 characters. */
export function titleFrom(prompt) {
  const line = String(prompt ?? '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return clip(line, 60);
}

export const folderName = (cwd) => (cwd ? basename(String(cwd).replace(/\/+$/, '')) || '' : '');

export const isoNow = (now = Date.now()) => new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Short model label: "opus", "sonnet", or the slug itself. */
export function shortModel(model) {
  if (typeof model !== 'string' || !model) return null;
  const m = model.match(/opus|sonnet|haiku/i);
  return (m ? m[0].toLowerCase() : model).slice(0, 32);
}

/**
 * Build one session event.
 * `titles: false` replaces the name with the folder name.
 */
export function buildEvent(o) {
  const where = o.where || '';
  const name = o.titles === false ? (where || o.src || 'session') : (o.name || where || 'session');
  return {
    v: 1,
    sid: String(o.sid),
    src: o.src || 'cli',
    host: o.host,
    name: clip(name, 60),
    where: clip(where, 60),
    state: o.state,
    tool: o.tool ? clip(o.tool, 40) : null,
    tools: o.tools || 0,
    model: shortModel(o.model),
    started: o.started || isoNow(o.now),
    at: isoNow(o.now),
    note: clip(o.note || '', 120),
    parent: o.parent || null,
  };
}

export function buildLetter({ from, title, body, now }) {
  return { v: 1, kind: 'letter', from, title: clip(title, 80), body: String(body ?? '').trim().slice(0, 600), at: isoNow(now) };
}

// [present, past] wording per tool. Keeps notes short and free of file contents.
const VERBS = {
  Edit: ['Editing', 'Edited'], MultiEdit: ['Editing', 'Edited'], NotebookEdit: ['Editing', 'Edited'],
  Write: ['Writing', 'Wrote'], Read: ['Reading', 'Read'],
  Bash: ['Running a command', 'Ran a command'], Grep: ['Searching', 'Searched'], Glob: ['Searching', 'Searched'],
  WebFetch: ['Browsing the web', 'Browsed the web'], WebSearch: ['Browsing the web', 'Browsed the web'],
  Task: ['Running a subagent', 'Ran a subagent'], Agent: ['Running a subagent', 'Ran a subagent'],
  apply_patch: ['Editing files', 'Edited files'],
};
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Read']);

/** Note for a tool call. Only file paths are included, never commands or contents. */
export function toolNote(tool, input, { cwd, past = false, paths = true } = {}) {
  if (!tool) return '';
  if (tool.startsWith('mcp__')) return `${past ? 'Used' : 'Using'} ${tool.split('__')[1] || 'a tool'}`;
  const v = VERBS[tool];
  if (!v) return `${past ? 'Used' : 'Using'} ${tool}`;
  const verb = v[past ? 1 : 0];
  const file = input && (input.file_path || input.notebook_path || input.path);
  if (paths && FILE_TOOLS.has(tool) && typeof file === 'string') {
    let shown = file;
    if (cwd && isAbsolute(file)) {
      const rel = relative(cwd, file);
      shown = rel && !rel.startsWith('..') ? rel : basename(file);
    }
    return `${verb} ${shown}`;
  }
  return FILE_TOOLS.has(tool) ? `${verb} a file` : verb;
}
