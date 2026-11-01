// Plays the iPhone app's side of the protocol (v2), following PROTOCOL.md.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { b64, derivePairKey, generateKeyPair, open, pairTopic, seal, unb64, verificationCode } from '../../lib/crypto.mjs';
import { parseNdjson } from '../../lib/relay.mjs';

/** RFC 6238: HMAC-SHA1, 60 s step, 6 digits, T0 = 0. */
export function totp(secret, atMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 60)));
  const h = createHmac('sha1', secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}

/** SHA256(pk || nonce), base64 — the hello commitment. */
export const helloCommitment = (pk, nonce) => b64(createHash('sha256').update(Buffer.concat([pk, nonce])).digest());

export class FakeApp {
  constructor(relayUrl, fetchImpl) {
    this.relayUrl = relayUrl;
    this.h = fetchImpl || ((u, o) => fetch(u, o));
    this.secret = randomBytes(32);
    this.links = [];
    this.pending = new Map(); // nonce -> { topic, hello, eph }
  }
  code(at) { return totp(this.secret, at); }

  /** Poll the pair topics once. mode: 'allow' | 'deny'. Returns processed hellos.
      One round can post challenges and welcome a revealed key; caller loops for v2 timing. */
  async handlePairing(mode = 'allow') {
    const now = Date.now();
    const topics = [this.code(now), this.code(now - 60000)].map(pairTopic);
    const res = await this.h(`${this.relayUrl}/${topics.join(',')}/json?poll=1&since=2m`);
    const handled = [];
    for (const m of parseNdjson(await res.text())) {
      let o; try { o = JSON.parse(m.message); } catch { continue; }
      const topic = m.topic;
      if (o.t === 'hello') {
        if (this.pending.has(o.nonce) || this.links.some((l) => l.nonce === o.nonce) || this.denied?.has(o.nonce)) continue;
        if (!o.commit || unb64(o.commit).length !== 32 || !o.nonce || unb64(o.nonce).length !== 16) continue;
        if (mode === 'deny') {
          (this.denied ||= new Set()).add(o.nonce);
          await this.h(`${this.relayUrl}/${topic}`, { method: 'POST', body: JSON.stringify({ t: 'deny', v: 1, to: o.nonce }) });
          continue;
        }
        const eph = generateKeyPair();
        await this.h(`${this.relayUrl}/${topic}`, { method: 'POST', body: JSON.stringify({ t: 'challenge', v: 2, to: o.nonce, pk: b64(eph.publicKey) }) });
        this.pending.set(o.nonce, { topic, hello: o, eph });
        handled.push(o);
      } else if (o.t === 'reveal') {
        const slot = this.pending.get(o.to);
        if (!slot) continue;
        // commitment check: only the key from the committed hello can be revealed
        // commitment check: only the key from the committed hello can be revealed
        if (helloCommitment(unb64(o.pk), unb64(slot.hello.nonce)) !== slot.hello.commit) continue;
        this.pending.delete(o.to);
        const link = { id: randomBytes(8).toString('hex'), inbox: `wudland-${randomBytes(16).toString('hex')}`, key: randomBytes(32), nonce: slot.hello.nonce, hello: slot.hello };
        const k = derivePairKey(slot.eph.privateKey, unb64(o.pk), unb64(slot.hello.nonce));
        link.verificationCode = verificationCode(k);
        const box = seal(k, JSON.stringify({ id: link.id, inbox: link.inbox, key: b64(link.key), relay: this.relayUrl }));
        await this.h(`${this.relayUrl}/${slot.topic}`, { method: 'POST', body: JSON.stringify({ t: 'welcome', v: 1, to: slot.hello.nonce, pk: b64(slot.eph.publicKey), box }) });
        this.links.push(link);
        handled.push(slot.hello);
      }
    }
    return handled;
  }

  /** Read and decrypt every event on the link inboxes. */
  async readEvents() {
    if (!this.links.length) return [];
    const res = await this.h(`${this.relayUrl}/${this.links.map((l) => l.inbox).join(',')}/json?poll=1&since=all`);
    const out = [];
    for (const m of parseNdjson(await res.text())) {
      const link = this.links.find((l) => l.inbox === m.topic);
      if (!link || !m.message.startsWith('w1.')) continue;
      try { out.push(JSON.parse(open(link.key, m.message.slice(3)).toString('utf8'))); } catch { /* drop */ }
    }
    return out;
  }
}
