// Pairing, plugin side. See "Pairing" in PROTOCOL.md.
import { randomBytes } from 'node:crypto';
import { b64, derivePairKey, generateKeyPair, open, pairTopic, unb64, verificationCode } from './crypto.mjs';
import { poll, publish } from './relay.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pair with the phone using the 6-digit code.
 * Resolves with the link { id, inbox, key, relay }. Rejects with a friendly Error.
 */
export async function pair({
  code, relay, name = 'Wudland Link', kind = 'cli', host,
  onProgress = () => {}, pollMs = 3000, timeoutMs = 120000, fetchImpl,
}) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('The code should be 6 digits, as shown in the app.');
  const topic = pairTopic(code);
  const kp = generateKeyPair();
  const nonce = randomBytes(16);
  const nonceB64 = b64(nonce);
  const sentAt = Math.floor(Date.now() / 1000);

  const hello = { t: 'hello', v: 1, pk: b64(kp.publicKey), nonce: nonceB64, name, kind, host };
  try {
    await publish(relay, topic, JSON.stringify(hello), { timeoutMs: 10000, fetchImpl });
  } catch (e) {
    throw new Error(`Could not reach the relay at ${relay} (${e.message}). Check your connection and try again.`);
  }
  onProgress('sent');

  const deadline = Date.now() + timeoutMs;
  let announced = false;
  let challenge = null;
  while (Date.now() < deadline) {
    if (!announced) { onProgress('waiting'); announced = true; }
    await sleep(pollMs);
    let msgs;
    try { msgs = await poll(relay, topic, sentAt - 5, { fetchImpl }); } catch { continue; }
    for (const m of msgs) {
      let o;
      try { o = JSON.parse(m.message); } catch { continue; }
      if (!o || o.to !== nonceB64) continue;
      if (o.t === 'deny') throw new Error('The request was declined on the phone.');
      if (o.t === 'challenge' && !challenge) {
        try {
          const key = derivePairKey(kp.privateKey, unb64(o.pk), nonce);
          challenge = { pk: o.pk, key };
          onProgress('verify', verificationCode(key));
        } catch { /* malformed public key */ }
        continue;
      }
      if (o.t !== 'welcome' || !challenge || o.pk !== challenge.pk) continue;
      try {
        const key = challenge.key;
        const link = JSON.parse(open(key, o.box).toString('utf8'));
        if (!link.id || !link.inbox || !link.key) throw new Error('incomplete');
        return { id: link.id, inbox: link.inbox, key: link.key, relay: link.relay || relay };
      } catch { /* not for us or corrupted; keep waiting */ }
    }
  }
  throw new Error('Timed out waiting for the phone. Get a fresh code in the app and try again.');
}
