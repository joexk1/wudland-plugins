import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS, decide, takePending } from '../lib/throttle.mjs';

const fresh = () => ({ sessions: {}, day: '', count: 0 });
const ev = (state) => ({ state });
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

test('first event sends immediately, same-state repeats are dropped', () => {
  const st = fresh();
  assert.equal(decide(st, 'a', ev('idle'), T0).action, 'send');
  assert.equal(decide(st, 'a', ev('idle'), T0 + 60000).action, 'skip');
  assert.equal(st.count, 1);
});

test('busy progress is limited to once per 3 minutes', () => {
  const st = fresh();
  decide(st, 'a', ev('busy'), T0);
  assert.equal(decide(st, 'a', ev('busy'), T0 + 60000).action, 'skip');
  assert.equal(decide(st, 'a', ev('busy'), T0 + LIMITS.progressGapMs - 1).action, 'skip');
  assert.equal(decide(st, 'a', ev('busy'), T0 + LIMITS.progressGapMs).action, 'send');
});

test('a state change within 5 s is deferred, latest wins, then sent', () => {
  const st = fresh();
  decide(st, 'a', ev('busy'), T0);
  const d1 = decide(st, 'a', ev('waiting'), T0 + 1000);
  assert.equal(d1.action, 'defer');
  assert.equal(d1.delayMs, 4000);
  const d2 = decide(st, 'a', ev('idle'), T0 + 2000);
  assert.equal(d2.action, 'defer');
  assert.equal(takePending(st, 'a', d1.seq, T0 + 5000), null, 'superseded timer does nothing');
  assert.equal(takePending(st, 'a', d2.seq, T0 + 5000).state, 'idle');
  assert.equal(takePending(st, 'a', d2.seq, T0 + 5000), null, 'only once');
  assert.equal(st.count, 2);
});

test('returning to the state the phone already shows cancels a pending change', () => {
  const st = fresh();
  decide(st, 'a', ev('busy'), T0);
  const d = decide(st, 'a', ev('idle'), T0 + 1000);
  assert.equal(decide(st, 'a', ev('busy'), T0 + 2000).action, 'skip');
  assert.equal(takePending(st, 'a', d.seq, T0 + 5000), null);
});

test('sessions are throttled independently', () => {
  const st = fresh();
  assert.equal(decide(st, 'a', ev('busy'), T0).action, 'send');
  assert.equal(decide(st, 'b', ev('busy'), T0).action, 'send');
});

test('above 180 sends only state changes go out; above 240 nothing', () => {
  const st = fresh();
  decide(st, 'a', ev('busy'), T0);
  st.count = LIMITS.softCap;
  assert.equal(decide(st, 'a', ev('busy'), T0 + 4 * 60000).action, 'skip', 'progress dropped');
  assert.equal(decide(st, 'a', ev('idle'), T0 + 5 * 60000).action, 'send', 'state change allowed');
  st.count = LIMITS.hardCap;
  assert.equal(decide(st, 'a', ev('busy'), T0 + 10 * 60000).action, 'skip');
});

test('counter resets on a new UTC day', () => {
  const st = fresh();
  decide(st, 'a', ev('busy'), T0);
  st.count = LIMITS.hardCap;
  const tomorrow = T0 + 24 * 3600 * 1000;
  assert.equal(decide(st, 'a', ev('idle'), tomorrow).action, 'send');
  assert.equal(st.count, 1);
});

test('a day of heavy tool use stays inside the budget', () => {
  const st = fresh();
  let sends = 0;
  // One busy session, a tool call every 10 s for 24 hours.
  for (let t = T0; t < T0 + 24 * 3600 * 1000; t += 10000) {
    if (decide(st, 'a', ev('busy'), t).action === 'send') sends++;
  }
  // The run spans two UTC days, each capped at the soft limit for progress updates.
  assert.ok(sends <= 2 * LIMITS.softCap, `sent ${sends}`);
});
