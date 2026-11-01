// Detached sender. Hooks spawn this and exit straight away, so the agent never waits
// on the network. Reads one JSON job on stdin:
//   { evt }                    send now
//   { sid, seq, delayMs }      wait, then send the pending event if still current
import { readConfig, readState, writeState } from './config.mjs';
import { sendToLinks } from './send.mjs';
import { takePending } from './throttle.mjs';

const watchdog = setTimeout(() => process.exit(0), 25000);
watchdog.unref();

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const job = JSON.parse(raw);
  let evt = job.evt;
  if (!evt) {
    await new Promise((r) => setTimeout(r, job.delayMs || 0));
    const state = readState();
    evt = takePending(state, job.sid, job.seq);
    writeState(state);
  }
  if (!evt) return;
  const { links } = readConfig();
  if (links.length) await sendToLinks(links, evt, { timeoutMs: 3000 });
}

main().catch(() => {}).finally(() => process.exit(0));
