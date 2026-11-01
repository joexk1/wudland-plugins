import assert from 'node:assert/strict';
import test from 'node:test';
import { pair } from '../lib/pair.mjs';
import { b64, derivePairKey, generateKeyPair, seal, unb64, verificationCode } from '../lib/crypto.mjs';

for (const mode of ['no-challenge', 'swapped-key']) {
  test(`pairing rejects ${mode} welcome even when its box decrypts`, async () => {
    let messages = [], verified = 0;
    const fetchImpl = async (_url, opts = {}) => {
      if (opts.method === 'POST') {
        const hello = JSON.parse(opts.body), attacker = generateKeyPair(), phone = generateKeyPair();
        const key = derivePairKey(attacker.privateKey, unb64(hello.pk), unb64(hello.nonce));
        const welcome = { t: 'welcome', v: 1, to: hello.nonce, pk: b64(attacker.publicKey),
          box: seal(key, JSON.stringify({ id: 'bad', inbox: 'bad', key: b64(Buffer.alloc(32)) })) };
        if (mode === 'swapped-key') messages.push({ message: JSON.stringify({ t: 'challenge', v: 1, to: hello.nonce, pk: b64(phone.publicKey) }) });
        messages.push({ message: JSON.stringify(welcome) });
        return { ok: true };
      }
      return { ok: true, text: async () => messages.map(JSON.stringify).join('\n') };
    };
    await assert.rejects(pair({ code: '123456', relay: 'https://relay.invalid', pollMs: 1, timeoutMs: 30,
      fetchImpl, onProgress: (step) => { if (step === 'verify') verified++; } }), /Timed out/);
    assert.equal(verified, mode === 'swapped-key' ? 1 : 0);
  });
}

test('verification fingerprint agrees for both peers and changes for a substituted key', () => {
  const a = generateKeyPair(), b = generateKeyPair(), other = generateKeyPair(), nonce = Buffer.alloc(16, 7);
  const key = derivePairKey(a.privateKey, b.publicKey, nonce);
  assert.equal(verificationCode(key), verificationCode(derivePairKey(b.privateKey, a.publicKey, nonce)));
  assert.notEqual(verificationCode(key), verificationCode(derivePairKey(a.privateKey, other.publicKey, nonce)));
  assert.match(verificationCode(key), /^\d{4} \d{4}$/);
});
