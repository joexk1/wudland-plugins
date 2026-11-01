import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FakeApp, totp } from './helpers/app.mjs';
import { startRelay } from './helpers/fake-relay.mjs';

const BIN = fileURLToPath(new URL('../bin/wudland.mjs', import.meta.url));
const LAUNCHER = fileURLToPath(new URL('../claude-code/launcher.mjs', import.meta.url));

function run(file, args, { home, input, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [file, ...args], { env: { ...process.env, WUDLAND_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), timeout);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    c.stdin.on('error', () => {});
    c.stdin.end(input ?? '');
  });
}
const wait = async (cond, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await cond(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };

test('pairing end to end against a fake relay, then events and letters decrypt', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  const app = new FakeApp(relay.url);
  const code = app.code();
  assert.match(code, /^\d{6}$/);

  // `link` polls every 3 s, so shorten nothing: the app answers as soon as hello lands.
  const linkRun = run(BIN, ['link', code, '--relay', relay.url, '--kind', 'claude', '--name', 'Claude Code'], { home });
  const hello = await wait(async () => (await app.handlePairing())[0]);
  assert.ok(hello, 'app saw the hello');
  assert.equal(hello.t, 'hello');
  assert.equal(hello.v, 1);
  assert.equal(hello.name, 'Claude Code');
  assert.equal(hello.kind, 'claude');
  assert.equal(Buffer.from(hello.pk, 'base64').length, 32);
  assert.equal(Buffer.from(hello.nonce, 'base64').length, 16);
  assert.match(hello.host, /^[^.A-Z]{1,24}$/);

  const r = await linkRun;
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Waiting for you to tap Allow on your phone/);
  assert.match(r.stdout, /Linked\. This computer will show up in Wudland\./);

  const linkFile = join(home, 'link.json');
  assert.equal(statSync(linkFile).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(linkFile, 'utf8'));
  assert.equal(saved.links[0].id, app.links[0].id);
  assert.equal(saved.links[0].inbox, app.links[0].inbox);

  // A hook now produces an encrypted event the app can read.
  const hookIn = JSON.stringify({ session_id: 'sess-1', cwd: '/home/x/my-app', hook_event_name: 'UserPromptSubmit', prompt: 'Fix the login bug' });
  const h = await run(LAUNCHER, [], { home, input: hookIn });
  assert.equal(h.code, 0);
  assert.equal(h.stdout + h.stderr, '');
  const events = await wait(async () => { const e = await app.readEvents(); return e.length ? e : null; });
  assert.ok(events, 'event arrived');
  assert.equal(events[0].sid, 'sess-1');
  assert.equal(events[0].src, 'claude');
  assert.equal(events[0].name, 'Fix the login bug');
  assert.equal(events[0].where, 'my-app');
  assert.equal(events[0].state, 'busy');
  // The relay only ever saw ciphertext.
  assert.ok(!JSON.stringify(relay.messages).includes('Fix the login bug'));

  const l = await run(BIN, ['letter', 'Backup finished', 'All good.'], { home });
  assert.equal(l.code, 0, l.stderr);
  const letter = (await app.readEvents()).find((e) => e.kind === 'letter');
  assert.equal(letter.title, 'Backup finished');
  assert.equal(letter.body, 'All good.');

  const s = await run(BIN, ['status'], { home });
  assert.match(s.stdout, /Linked: 1 phone/);

  const u = await run(BIN, ['unlink'], { home });
  assert.match(u.stdout, /Unlinked/);
  const after = await run(LAUNCHER, [], { home, input: hookIn.replace('sess-1', 'sess-2') });
  assert.equal(after.code, 0);
});

test('denied pairing explains itself', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  const app = new FakeApp(relay.url);
  const linkRun = run(BIN, ['link', app.code(), '--relay', relay.url], { home });
  await wait(async () => (await app.handlePairing('deny')).length || (app.denied?.size ? true : null));
  const r = await linkRun;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /declined/);
  assert.equal(existsSync(join(home, 'link.json')), false);
});

test('bad code is rejected before any network call', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  const r = await run(BIN, ['link', '12ab', '--relay', 'http://127.0.0.1:9'], { home });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /6 digits/);
});

test('hooks exit 0 silently and quickly with no link, and on garbage input', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  for (const input of ['', 'not json', '{"hook_event_name":"Stop","session_id":"x"}']) {
    const t0 = Date.now();
    const r = await run(LAUNCHER, [], { home, input });
    assert.equal(r.code, 0);
    assert.equal(r.stdout + r.stderr, '');
    assert.ok(Date.now() - t0 < 1500);
  }
  assert.equal(existsSync(join(home, 'state.json')), false, 'nothing written when unlinked');
  const c = await run(BIN, ['hook', 'claude'], { home, input: 'garbage' });
  assert.equal(c.code, 0);
});

test('hooks stay fast and silent when the relay is unreachable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(home, 'link.json'), JSON.stringify({ links: [{ id: 'a', inbox: 'wudland-z', key: Buffer.alloc(32, 2).toString('base64'), relay: 'http://127.0.0.1:9' }] }));
  const t0 = Date.now();
  const r = await run(LAUNCHER, [], { home, input: JSON.stringify({ session_id: 'q', cwd: '/x/y', hook_event_name: 'Stop' }) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout + r.stderr, '');
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
});

test('config, emit and run', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.close());
  const home = mkdtempSync(join(tmpdir(), 'wudland-cli-'));
  const app = new FakeApp(relay.url);
  const linkRun = run(BIN, ['link', app.code(), '--relay', relay.url], { home });
  await wait(async () => (await app.handlePairing())[0]);
  assert.equal((await linkRun).code, 0);

  assert.equal((await run(BIN, ['config', 'titles', 'off'], { home })).code, 0);
  assert.equal((await run(BIN, ['config', 'host', 'studio'], { home })).code, 0);
  assert.equal((await run(BIN, ['config', 'titles', 'maybe'], { home })).code, 1);

  assert.equal((await run(BIN, ['emit', '--src', 'cron', '--state', 'busy', '--name', 'Nightly job', '--sid', 'job1', '--where', 'ops'], { home })).code, 0);
  let evs = await wait(async () => { const e = await app.readEvents(); return e.length ? e : null; });
  assert.equal(evs[0].name, 'ops', 'titles off applies to emit');
  assert.equal(evs[0].host, 'studio');
  assert.equal(evs[0].src, 'cron');

  await run(BIN, ['config', 'titles', 'on'], { home });
  const r = await run(BIN, ['run', '--name', 'Say hi', '--', process.execPath, '-e', 'console.log("hi")'], { home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /hi/);
  const bad = await run(BIN, ['run', '--', process.execPath, '-e', 'process.exit(3)'], { home });
  assert.equal(bad.code, 3);
  evs = await wait(async () => { const e = (await app.readEvents()).filter((x) => x.name === 'Say hi'); return e.length >= 2 ? e : null; }, 12000);
  assert.deepEqual(evs.map((e) => e.state), ['busy', 'done']);
});

test('app-side totp is stable within a 60 s step', () => {
  assert.equal(totp(Buffer.from('k'), 120000), totp(Buffer.from('k'), 179999));
  assert.notEqual(totp(Buffer.from('k'), 120000), totp(Buffer.from('k'), 180000));
});
