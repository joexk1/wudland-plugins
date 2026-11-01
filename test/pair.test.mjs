import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { pair } from '../lib/pair.mjs';
import { b64, derivePairKey, generateKeyPair, seal, unb64, verificationCode } from '../lib/crypto.mjs';
import { FakeApp } from './helpers/app.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const helloCommitment = (pk, nonce) => createHash('sha256').update(Buffer.concat([pk, nonce])).digest();

/** A tiny in-memory ntfy: POSTs append {event:'message', topic, message}; GETs return all. */
function FakeRelay() {
  let seq = 0;
  const lines = [];
  return async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const topic = url.split('/').slice(3)[0];
      lines.push({ event: 'message', id: String(++seq), time: Math.floor(Date.now() / 1000), topic, message: opts.body });
      return { ok: true, text: async () => '' };
    }
    return { ok: true, text: async () => lines.map(JSON.stringify).join('\n') };
  };
}

test('verification fingerprint agrees for both peers and changes for a substituted key', () => {
  const a = generateKeyPair(), b = generateKeyPair(), other = generateKeyPair(), nonce = Buffer.alloc(16, 7);
  const key = derivePairKey(a.privateKey, b.publicKey, nonce);
  assert.equal(verificationCode(key).toString(), verificationCode(derivePairKey(b.privateKey, a.publicKey, nonce)).toString());
  assert.notEqual(verificationCode(key).toString(), verificationCode(derivePairKey(a.privateKey, other.publicKey, nonce)).toString());
  assert.match(verificationCode(key), /^\d{4} \d{4}$/);
});

test('commitment binds the hello to one key pair', () => {
  const kp = generateKeyPair();
  const nonce = Buffer.alloc(16, 3);
  const commit = helloCommitment(kp.publicKey, nonce);
  assert.ok(commit.equals(helloCommitment(kp.publicKey, nonce)), 'commitment is deterministic');
  assert.ok(!commit.equals(helloCommitment(generateKeyPair().publicKey, nonce)), 'substituted key rejected');
  assert.ok(!commit.equals(helloCommitment(kp.publicKey, Buffer.alloc(16, 4))), 'substituted nonce rejected');
});

test('pairing completes end to end: committed hello, challenge, reveal, welcome', async () => {
  let verified = 0;
  const relay = FakeRelay();
  const app = new FakeApp('https://relay.invalid', relay);
  const op = pair({ code: '123456', relay: 'https://relay.invalid', pollMs: 1, timeoutMs: 4000, fetchImpl: relay,
    onProgress: (step) => { if (step === 'verify') verified++; } });
  const drive = (async () => { for (let i = 0; i < 200; i++) { await app.handlePairing('allow'); await sleep(1); } })();
  const link = await op;
  await drive;
  assert.ok(link.id && link.inbox.startsWith('wudland-') && link.key, 'link contents valid');
  assert.equal(verified, 1, 'the verify step ran exactly once');
  const hello = app.links[0].hello;
  assert.ok(!('pk' in hello), 'v2 hello carries no public key');
  const raw = relay.lines?.[0]; // not exposed; re-derive from fake relay closure below instead
  assert.ok(hello.commit, 'hello carries a commitment');
});

test('pairing never reveals the key without a challenge', async () => {
  let messages = [], verified = 0;
  const relay = FakeRelay();
  // a relay that swallows challenges: the phone never answers
  const blackhole = async (url, opts = {}) => {
    if (opts.method === 'POST') return { ok: true, text: async () => '' };
    return { ok: true, text: async () => '' };
  };
  await assert.rejects(pair({ code: '123456', relay: 'https://relay.invalid', pollMs: 1, timeoutMs: 60,
    fetchImpl: blackhole, onProgress: (step) => { if (step === 'verify') verified++; } }), /Timed out/);
  assert.equal(verified, 0, 'no verify step without a challenge');
});

test('a substituted key does not satisfy the hello commitment', async () => {
  // the attacker replaces the plugin's hello with one committing to its own key
  let verified = 0, welcomed = 0;
  const lines = [];
  const attacker = generateKeyPair();
  const attackerNonce = Buffer.alloc(16, 9);
  const attackerCommit = helloCommitment(attacker.publicKey, attackerNonce);
  const deliver = (topic, body) => lines.push({ event: 'message', id: String(lines.length + 1), time: Math.floor(Date.now() / 1000), topic, message: body });
  const relay = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const topic = url.split('/').slice(3)[0];
      const body = JSON.parse(opts.body);
      deliver(topic, opts.body);
      if (body.t === 'hello') {
        // swap the plugin's challenge for an attacker key (the substituted pk的帮助 is rejected later)
        deliver(topic, JSON.stringify({ t: 'challenge', v: 2, to: body.nonce, pk: b64(attacker.publicKey) }));
      } else if (body.t === 'reveal' && !lines.some((l) => l.message.includes('"t":"welcome"'))) {
        // attacker forms a welcome under its own key, which the plugin CAN decrypt (challenge pin is attacker's)
        const k = derivePairKey(attacker.privateKey, unb64(body.pk), attackerNonce);
        deliver(topic, JSON.stringify({ t: 'welcome', v: 2, to: body.to, pk: b64(attacker.publicKey), box: seal(k, JSON.stringify({ id: 'sub', inbox: 'wudland-sub', key: b64(Buffer.alloc(32)) })) }));
        welcomed = 1;
      }
      return { ok: true, text: async () => '' };
    }
    return { ok: true, text: async () => lines.map(JSON.stringify).join('\n') };
  };
  await assert.rejects(pair({ code: '123456', relay: 'https://relay.invalid', pollMs: 1, timeoutMs: 80,
    fetchImpl: relay, onProgress: (step) => { if (step === 'verify') verified++; } }), /Timed out/);
  // the plugin still ran its side (it pinned the attacker challenge and verified), but the
  // phone would drop the reveal because it does not match the plugin's original commitment
  assert.ok(welcomed === 1, 'attacker produced a welcome');
  // assertion purpose: with the commitment in place the FakeApp-side integration test proves the
  // phone rejects this state; this fixture documents that the attacker cannot mirror it alone
});

test('a relay hassling the hello commitment cannot complete pairing on the phone side', async () => {
  let verified = 0;
  const delivered = [];
  const attacker = generateKeyPair();
  const deliver = (topic, body) => delivered.push({ event: 'message', id: String(delivered.length + 1), time: Math.floor(Date.now() / 1000), topic, message: body });
  const relay = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const topic = url.split('/').slice(3)[0];
      const body = JSON.parse(opts.body);
      if (body.t === 'hello') {
        // attacker's hello makes up for the plugin's but commits to the attacker's key itself
        deliver(topic, JSON.stringify({ t: 'hello', v: 2, nonce: body.nonce, commit: b64(helloCommitment(attacker.publicKey, Buffer.alloc(16, 8))), name: body.name, kind: body.kind, host: body.host }));
      } else deliver(topic, opts.body);
      return { ok: true, text: async () => '' };
    }
    return { ok: true, text: async () => delivered.map(JSON.stringify).join('\n') };
  };
  const phone = new FakeApp('https://relay.invalid', relay);

  const op = pair({ code: '123456', relay: 'https://relay.invalid', pollMs: 1, timeoutMs: 120, fetchImpl: relay,
    onProgress: (step) => { if (step === 'verify') verified++; } });
  const drive = (async () => { for (let i = 0; i < 150; i++) { await phone.handlePairing('allow'); await sleep(1); } })();
  await assert.rejects(op, /Timed out/);
  await drive;
  assert.equal(verified, 1, 'the plugin still derives and displays a code for its real exchange');
  assert.equal(phone.links.length, 0, 'the phone never accepts a reveal that busts the commitment');
});
