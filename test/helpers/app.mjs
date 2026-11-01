// Plays the iPhone app's side of the protocol, following PROTOCOL.md.
import { createHmac, randomBytes } from 'node:crypto';
import { b64, derivePairKey, generateKeyPair, open, pairTopic, seal, unb64 } from '../../lib/crypto.mjs';
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

export class FakeApp {
  constructor(relayUrl) {
    this.relayUrl = relayUrl;
    this.secret = randomBytes(32);
    this.links = [];
  }
  code(at) { return totp(this.secret, at); }

  /** Poll the pair topics once, handle any hello. mode: 'allow' | 'deny'. Returns handled hellos. */
  async handlePairing(mode = 'allow') {
    const now = Date.now();
    const topics = [this.code(now), this.code(now - 60000)].map(pairTopic);
    const res = await fetch(`${this.relayUrl}/${topics.join(',')}/json?poll=1&since=2m`);
    const handled = [];
    for (const m of parseNdjson(await res.text())) {
      let o; try { o = JSON.parse(m.message); } catch { continue; }
      if (o.t !== 'hello') continue;
      if (this.links.some((l) => l.nonce === o.nonce) || this.denied?.has(o.nonce)) continue;
      const topic = m.topic;
      if (mode === 'deny') {
        (this.denied ||= new Set()).add(o.nonce);
        await fetch(`${this.relayUrl}/${topic}`, { method: 'POST', body: JSON.stringify({ t: 'deny', v: 1, to: o.nonce }) });
        continue;
      }
      const link = { id: randomBytes(8).toString('hex'), inbox: `wudland-${randomBytes(16).toString('hex')}`, key: randomBytes(32), nonce: o.nonce, hello: o };
      const eph = generateKeyPair();
      const k = derivePairKey(eph.privateKey, unb64(o.pk), unb64(o.nonce));
      const box = seal(k, JSON.stringify({ id: link.id, inbox: link.inbox, key: b64(link.key), relay: this.relayUrl }));
      await fetch(`${this.relayUrl}/${topic}`, { method: 'POST', body: JSON.stringify({ t: 'welcome', v: 1, to: o.nonce, pk: b64(eph.publicKey), box }) });
      this.links.push(link);
      handled.push(o);
    }
    return handled;
  }

  /** Read and decrypt every event on the link inboxes. */
  async readEvents() {
    if (!this.links.length) return [];
    const res = await fetch(`${this.relayUrl}/${this.links.map((l) => l.inbox).join(',')}/json?poll=1&since=all`);
    const out = [];
    for (const m of parseNdjson(await res.text())) {
      const link = this.links.find((l) => l.inbox === m.topic);
      if (!link || !m.message.startsWith('w1.')) continue;
      try { out.push(JSON.parse(open(link.key, m.message.slice(3)).toString('utf8'))); } catch { /* drop */ }
    }
    return out;
  }
}
