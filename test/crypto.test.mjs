import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { derivePairKey, generateKeyPair, open, pairTopic, publicFromPrivate, seal, sharedSecret } from '../lib/crypto.mjs';

const vec = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const h = (s) => Buffer.from(s, 'hex');

test('seal/open round trip, with unicode', () => {
  const key = Buffer.alloc(32, 7);
  const msg = JSON.stringify({ name: 'Fix the login bug \u{1F680}' });
  const box = seal(key, msg);
  assert.equal(open(key, box).toString('utf8'), msg);
  assert.equal(Buffer.from(box, 'base64').length, 12 + Buffer.byteLength(msg) + 16);
});

test('tampering and wrong keys fail to open', () => {
  const key = Buffer.alloc(32, 7);
  const raw = Buffer.from(seal(key, 'hello'), 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => open(key, raw.toString('base64')));
  assert.throws(() => open(Buffer.alloc(32, 8), seal(key, 'hello')));
  assert.throws(() => open(key, 'AAAA'));
});

test('nonces are random per box', () => {
  const key = Buffer.alloc(32, 1);
  assert.notEqual(seal(key, 'x'), seal(key, 'x'));
});

test('X25519 matches RFC 7748 section 6.1', () => {
  const alicePriv = h('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bobPub = h('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  assert.equal(publicFromPrivate(alicePriv).toString('hex'), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(sharedSecret(alicePriv, bobPub).toString('hex'), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
});

test('both sides derive the same pairing key', () => {
  const a = generateKeyPair(), b = generateKeyPair(), nonce = Buffer.alloc(16, 3);
  assert.equal(a.publicKey.length, 32);
  assert.deepEqual(derivePairKey(a.privateKey, b.publicKey, nonce), derivePairKey(b.privateKey, a.publicKey, nonce));
});

test('vectors.json: box', () => {
  const { key, nonce, plaintext, boxBase64 } = vec.box;
  assert.equal(seal(h(key), plaintext, h(nonce)), boxBase64);
  assert.equal(open(h(key), boxBase64).toString('utf8'), plaintext);
});

test('vectors.json: pairing key derivation', () => {
  const p = vec.pairing;
  assert.equal(publicFromPrivate(h(p.appPrivateKey)).toString('hex'), p.appPublicKey);
  assert.equal(publicFromPrivate(h(p.pluginPrivateKey)).toString('hex'), p.pluginPublicKey);
  assert.equal(sharedSecret(h(p.appPrivateKey), h(p.pluginPublicKey)).toString('hex'), p.sharedSecret);
  assert.equal(derivePairKey(h(p.appPrivateKey), h(p.pluginPublicKey), h(p.hkdfSalt)).toString('hex'), p.derivedKey);
  assert.equal(derivePairKey(h(p.pluginPrivateKey), h(p.appPublicKey), h(p.hkdfSalt)).toString('hex'), p.derivedKey);
});

test('pair topic', () => {
  assert.equal(pairTopic(vec.pairTopic.code), vec.pairTopic.topic);
  assert.match(pairTopic('000000'), /^wudland-pair-[0-9a-f]{24}$/);
});
