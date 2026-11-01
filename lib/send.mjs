// Encrypts an event for each link and publishes it. One retry at most.
import { seal, unb64 } from './crypto.mjs';
import { publish } from './relay.mjs';

/** Returns [{ id, ok, error? }] per link. Never throws. */
export async function sendToLinks(links, payload, { timeoutMs = 3000, fetchImpl } = {}) {
  const plaintext = JSON.stringify(payload);
  return Promise.all(links.map(async (link) => {
    const body = `w1.${seal(unb64(link.key), plaintext)}`;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await publish(link.relay, link.inbox, body, { timeoutMs, fetchImpl });
        return { id: link.id, ok: true };
      } catch (e) { lastErr = e; }
    }
    return { id: link.id, ok: false, error: lastErr?.message || String(lastErr) };
  }));
}
