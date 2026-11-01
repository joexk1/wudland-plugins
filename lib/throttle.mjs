// Send budget from PROTOCOL.md. Pure functions over the state object, so they are
// easy to test; callers load and save state around them.
export const LIMITS = {
  stateGapMs: 5000,       // at most one send per session per 5 s
  progressGapMs: 180000,  // busy progress updates at most every 3 minutes
  softCap: 180,           // above this, state changes only
  hardCap: 240,           // above this, nothing until tomorrow
};

export const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

export function session(state, sid, now = Date.now()) {
  state.sessions ||= {};
  return (state.sessions[sid] ||= { tools: 0, seenAt: now });
}

function rollover(state, now) {
  const day = utcDay(now);
  if (state.day !== day) { state.day = day; state.count = 0; }
}

function commit(state, s, evt, now) {
  s.lastState = evt.state;
  s.lastSentAt = now;
  s.pending = null;
  state.count += 1;
}

/**
 * Decide what to do with an event for session `sid`.
 * Returns { action: 'send' } | { action: 'skip' } | { action: 'defer', delayMs, seq }.
 * 'send' has already been counted. 'defer' stores the event as pending; the caller
 * should call takePending(state, sid, seq, now) once delayMs has passed.
 */
export function decide(state, sid, evt, now = Date.now()) {
  rollover(state, now);
  const s = session(state, sid, now);
  if (state.count >= LIMITS.hardCap) return { action: 'skip', reason: 'daily cap' };

  const pending = s.pending;
  if (pending && evt.state === pending.evt.state) {
    pending.evt = evt; // latest wins, existing timer still applies
    return { action: 'skip', reason: 'coalesced' };
  }
  if (pending && evt.state === s.lastState) {
    s.pending = null;  // we are back to what the phone already shows
    s.pendingSeq = (s.pendingSeq || 0) + 1;
  }

  const isChange = evt.state !== s.lastState;
  if (!isChange) {
    if (evt.state !== 'busy') return { action: 'skip', reason: 'no change' };
    if (state.count >= LIMITS.softCap) return { action: 'skip', reason: 'soft cap' };
    if (now - (s.lastSentAt || 0) < LIMITS.progressGapMs) return { action: 'skip', reason: 'progress throttle' };
    commit(state, s, evt, now);
    return { action: 'send' };
  }

  const gap = now - (s.lastSentAt || 0);
  if (gap < LIMITS.stateGapMs) {
    s.pendingSeq = (s.pendingSeq || 0) + 1;
    s.pending = { evt, seq: s.pendingSeq };
    return { action: 'defer', delayMs: LIMITS.stateGapMs - gap, seq: s.pendingSeq };
  }
  commit(state, s, evt, now);
  return { action: 'send' };
}

/** Called after a defer's delay. Returns the event to send, or null if superseded. */
export function takePending(state, sid, seq, now = Date.now()) {
  rollover(state, now);
  const s = state.sessions?.[sid];
  if (!s?.pending || s.pending.seq !== seq) return null;
  if (state.count >= LIMITS.hardCap) { s.pending = null; return null; }
  const evt = s.pending.evt;
  commit(state, s, evt, now);
  return evt;
}

/** Letters are explicit, so they skip the per-session rules but obey the daily cap. */
export function allowLetter(state, now = Date.now()) {
  rollover(state, now);
  if (state.count >= LIMITS.hardCap) return false;
  state.count += 1;
  return true;
}
