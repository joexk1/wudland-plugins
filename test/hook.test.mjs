import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hasLink, readState, writeConfig, readConfig } from '../lib/config.mjs';
import { clip, titleFrom, toolNote } from '../lib/events.mjs';
import { chainCommand, intentFromNotify } from '../lib/codex.mjs';
import { intentFromHook } from '../lib/hook.mjs';
import { track } from '../lib/track.mjs';

const link = { id: 'aa', inbox: 'wudland-x', key: Buffer.alloc(32, 1).toString('base64'), relay: 'http://127.0.0.1:1' };
function sandbox(linked = true) {
  process.env.WUDLAND_HOME = mkdtempSync(join(tmpdir(), 'wudland-'));
  if (linked) writeConfig({ ...readConfig(), links: [link] });
}

test('titles are the first prompt line, max 60 chars', () => {
  assert.equal(titleFrom('  fix the login bug\nand more'), 'fix the login bug');
  const t = titleFrom('x'.repeat(200));
  assert.equal(Array.from(t).length, 60);
  assert.ok(t.endsWith('\u2026'));
  assert.equal(clip('a  b\n c', 10), 'a b c');
});

test('tool notes carry paths but never commands', () => {
  const n = toolNote('Edit', { file_path: '/p/app/src/auth.ts' }, { cwd: '/p/app', past: true });
  assert.equal(n, 'Edited src/auth.ts');
  assert.equal(toolNote('Bash', { command: 'curl -H "secret"' }), 'Running a command');
  assert.equal(toolNote('Edit', { file_path: '/p/app/a.ts' }, { cwd: '/p/app', paths: false }), 'Editing a file');
  assert.equal(toolNote('mcp__github__create_issue', {}), 'Using github');
});

test('Claude hook payloads map to intents', () => {
  const base = { session_id: 's1', cwd: '/home/joe/my-app' };
  const m = (o) => intentFromHook('claude', { ...base, ...o });
  assert.deepEqual(
    (({ state, name }) => ({ state, name }))(m({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the login bug' })),
    { state: 'busy', name: 'Fix the login bug' });
  const pre = m({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/home/joe/my-app/src/a.ts' } });
  assert.equal(pre.countTool, true);
  assert.equal(pre.where, 'my-app');
  assert.equal(pre.note, 'Editing src/a.ts');
  assert.equal(m({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }).countTool, undefined);
  assert.equal(m({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).state, 'waiting');
  assert.equal(m({ hook_event_name: 'Stop' }).state, 'idle');
  assert.equal(m({ hook_event_name: 'SessionEnd', reason: 'clear' }).state, 'done');
  const sub = m({ hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'Explore' });
  assert.equal(sub.state, 'done');
  assert.equal(sub.parent, 's1');
  assert.equal(sub.sid, 's1:ag1');
  assert.equal(m({ hook_event_name: 'SomethingNew' }), null);
  assert.equal(intentFromHook('claude', { hook_event_name: 'Stop' }), null, 'no session id');
  assert.equal(intentFromHook('claude', null), null);
});

test('Codex notify payload and chaining', () => {
  const i = intentFromNotify({ type: 'agent-turn-complete', 'thread-id': 't1', cwd: '/w/proj', 'input-messages': ['Add a test'], 'last-assistant-message': 'secret reply' });
  assert.equal(i.sid, 't1');
  assert.equal(i.name, 'Add a test');
  assert.equal(i.where, 'proj');
  assert.ok(!JSON.stringify(i).includes('secret reply'));
  assert.equal(intentFromNotify({ type: 'other' }), null);
  assert.deepEqual(chainCommand('["python3","/a b/n.py"]'), ['python3', '/a b/n.py']);
  assert.deepEqual(chainCommand('notify-send "Codex done"'), ['notify-send', 'Codex done']);
  assert.equal(chainCommand(''), null);
});

test('track does nothing and writes nothing when not linked', () => {
  sandbox(false);
  let spawned = 0;
  const r = track({ sid: 's', src: 'claude', state: 'busy' }, { spawnFn: () => spawned++ });
  assert.equal(r, null);
  assert.equal(spawned, 0);
  assert.equal(hasLink(), false);
  assert.throws(() => statSync(join(process.env.WUDLAND_HOME, 'state.json')));
});

test('track builds a spec event, remembers the title and counts tools', () => {
  sandbox();
  const jobs = [];
  const now = Date.UTC(2026, 10, 1, 15, 0, 0);
  const t = (i, dt = 0) => track({ sid: 's1', src: 'claude', where: 'my-app', ...i }, { now: now + dt, spawnFn: (j) => jobs.push(j) });
  t({ state: 'busy', name: 'Fix the login bug' });
  t({ state: 'busy', name: 'A later prompt', tool: 'Edit', countTool: true, note: 'Editing a.ts' }, 200000);
  const e = jobs[0].evt;
  assert.equal(e.v, 1);
  assert.equal(e.name, 'Fix the login bug');
  assert.equal(e.where, 'my-app');
  assert.equal(e.parent, null);
  assert.match(e.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(jobs[1].evt.name, 'Fix the login bug', 'first prompt keeps the title');
  assert.equal(jobs[1].evt.tools, 1);
  assert.equal(readState().count, 2);
  assert.equal((statSync(join(process.env.WUDLAND_HOME, 'state.json')).mode & 0o777), 0o600);
});

test('titles off sends the folder name', () => {
  sandbox();
  writeConfig({ ...readConfig(), titles: false });
  const jobs = [];
  track({ sid: 's2', src: 'claude', where: 'my-app', state: 'busy', name: 'Secret plans' }, { spawnFn: (j) => jobs.push(j) });
  assert.equal(jobs[0].evt.name, 'my-app');
  assert.ok(!JSON.stringify(jobs).includes('Secret plans'));
});

test('a failing spawn never throws', () => {
  sandbox();
  assert.doesNotThrow(() => track({ sid: 's3', src: 'x', state: 'busy' }, { spawnFn: () => { throw new Error('boom'); } }));
});
