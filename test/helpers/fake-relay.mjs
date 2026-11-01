// In-memory ntfy-compatible relay: POST /topic, GET /a,b/json?poll=1&since=...
import { createServer } from 'node:http';

export async function startRelay() {
  const messages = []; // { id, time, event, topic, message }
  let n = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname.slice(1));
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        messages.push({ id: `m${++n}`, time: Math.floor(Date.now() / 1000), event: 'message', topic: path, message: body });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
      return;
    }
    if (req.method === 'GET' && path.endsWith('/json')) {
      const topics = path.slice(0, -5).split(',');
      const since = url.searchParams.get('since') || 'all';
      const minTime = /^\d{9,}$/.test(since) ? Number(since)
        : /^(\d+)m$/.test(since) ? Math.floor(Date.now() / 1000) - 60 * parseInt(since) : 0;
      const lines = messages.filter((m) => topics.includes(m.topic) && m.time >= minTime)
        .map((m) => JSON.stringify(m)).join('\n');
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(lines ? lines + '\n' : '');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    messages,
    post: (topic, message) => messages.push({ id: `m${++n}`, time: Math.floor(Date.now() / 1000), event: 'message', topic, message }),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
