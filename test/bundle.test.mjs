import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('claude-code/lib is an exact copy of lib (run npm run build:plugins)', () => {
  const files = readdirSync(new URL('lib/', root));
  assert.deepEqual(readdirSync(new URL('claude-code/lib/', root)), files);
  for (const f of files) {
    assert.equal(readFileSync(new URL(`claude-code/lib/${f}`, root), 'utf8'), readFileSync(new URL(`lib/${f}`, root), 'utf8'), f);
  }
});

test('plugin manifests are consistent', () => {
  const mk = JSON.parse(readFileSync(new URL('.claude-plugin/marketplace.json', root), 'utf8'));
  assert.equal(mk.name, 'wudland');
  assert.equal(mk.owner.name, 'joexk1');
  assert.equal(mk.plugins[0].source, './claude-code');
  const hooks = JSON.parse(readFileSync(new URL('claude-code/hooks/hooks.json', root), 'utf8')).hooks;
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd']) {
    assert.match(hooks[e][0].hooks[0].command, /CLAUDE_PLUGIN_ROOT/);
  }
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.bin.wudland, 'bin/wudland.mjs');
});
