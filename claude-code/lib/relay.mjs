// Minimal ntfy-compatible relay client built on fetch.
export const DEFAULT_RELAY = 'https://ntfy.sh';

const trimSlash = (u) => u.replace(/\/+$/, '');

/** POST a text body to {relay}/{topic}. Throws on a non-2xx answer or timeout. */
export async function publish(relay, topic, body, { timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${trimSlash(relay)}/${topic}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`relay answered ${res.status}`);
}

/** Parse ntfy's JSON stream: one JSON object per line. Keeps real messages only. */
export function parseNdjson(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && (o.event === undefined || o.event === 'message') && typeof o.message === 'string') out.push(o);
    } catch { /* skip junk lines */ }
  }
  return out;
}

/** Poll one or more topics once. Returns ntfy message objects (use `.message`). */
export async function poll(relay, topics, since, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const list = Array.isArray(topics) ? topics.join(',') : topics;
  const url = `${trimSlash(relay)}/${list}/json?poll=1&since=${encodeURIComponent(since)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`relay answered ${res.status}`);
  return parseNdjson(await res.text());
}
