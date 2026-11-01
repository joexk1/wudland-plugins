// The `wudland` command line.
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { randomHex } from './crypto.mjs';
import { configDir, hostLabel, readConfig, readState, writeConfig, writeState } from './config.mjs';
import { buildEvent, buildLetter, clip, folderName } from './events.mjs';
import { runCodexNotify } from './codex.mjs';
import { runHook } from './hook.mjs';
import { pair } from './pair.mjs';
import { DEFAULT_RELAY } from './relay.mjs';
import { sendToLinks } from './send.mjs';
import { LIMITS, allowLetter, utcDay } from './throttle.mjs';
import { track } from './track.mjs';

const VERSION = '0.1.0';

const HELP = `wudland ${VERSION}: link coding agents to the Wudland app

Usage
  wudland link <code> [--relay URL] [--name NAME] [--kind KIND]
  wudland unlink
  wudland status
  wudland letter "Title" "Body"
  wudland config [titles on|off | relay URL | host NAME]
  wudland emit --src NAME --state busy|waiting|idle|done|failed [--name T] [--note N] [--sid ID]
  wudland run [--name T] -- <command...>
  wudland hook claude|codex        (reads hook JSON on stdin)
  wudland codex-notify <json>      (Codex notify program)
  wudland test-send
`;

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'hook': return runHook(rest[0] === 'codex' ? 'codex' : 'claude').then(() => 0);
    case 'codex-notify': runCodexNotify(rest[rest.length - 1] || '{}'); return 0;
    case 'link': return cmdLink(rest);
    case 'unlink': return cmdUnlink();
    case 'status': return cmdStatus();
    case 'letter': return cmdLetter(rest);
    case 'config': return cmdConfig(rest);
    case 'emit': return cmdEmit(rest);
    case 'run': return cmdRun(rest);
    case 'test-send': return cmdTestSend();
    case '--version': case '-v': case 'version': out(VERSION); return 0;
    case undefined: case 'help': case '--help': case '-h': out(HELP); return 0;
    default: err(`Unknown command "${cmd}".\n`); err(HELP); return 1;
  }
}

async function cmdLink(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    relay: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, timeout: { type: 'string' },
  } });
  const code = positionals[0];
  if (!code) { err('Usage: wudland link <6-digit code>\nOpen Wudland > Settings > Link a computer to get one.'); return 1; }
  const cfg = readConfig();
  const relay = values.relay || cfg.relay || DEFAULT_RELAY;
  const host = hostLabel(cfg);
  out(`Linking ${host} to Wudland...`);
  try {
    const link = await pair({
      code, relay, host, name: values.name || 'Wudland Link', kind: values.kind || 'cli',
      timeoutMs: values.timeout ? Number(values.timeout) * 1000 : 120000,
      onProgress: (p) => {
        if (p === 'sent') out('Sent the request.');
        if (p === 'waiting') out('Waiting for you to tap Allow on your phone…');
      },
    });
    cfg.links = cfg.links.filter((l) => l.id !== link.id);
    cfg.links.push({ ...link, kind: values.kind || 'cli', linkedAt: new Date().toISOString() });
    writeConfig(cfg);
    out('Linked. This computer will show up in Wudland.');
    return 0;
  } catch (e) { err(e.message); return 1; }
}

function cmdUnlink() {
  const cfg = readConfig();
  const n = cfg.links.length;
  cfg.links = [];
  writeConfig(cfg);
  writeState({ ...readState(), sessions: {} });
  out(n ? `Unlinked (${n} link${n === 1 ? '' : 's'} removed). You can also remove this computer in the app.` : 'Nothing was linked.');
  return 0;
}

function cmdStatus() {
  const cfg = readConfig();
  const state = readState();
  const sent = state.day === utcDay(Date.now()) ? state.count : 0;
  out(cfg.links.length ? `Linked: ${cfg.links.length} phone${cfg.links.length === 1 ? '' : 's'}` : 'Not linked. Run: wudland link <code>');
  out(`Computer name: ${hostLabel(cfg)}`);
  out(`Relay: ${cfg.relay || cfg.links[0]?.relay || DEFAULT_RELAY}`);
  out(`Titles: ${cfg.titles === false ? 'off (folder names only)' : 'on'}`);
  out(`Sent today (UTC): ${sent} of ${LIMITS.hardCap}${sent >= LIMITS.softCap ? ' (state changes only)' : ''}`);
  out(`Config: ${configDir()}`);
  return 0;
}

async function cmdLetter(args) {
  const [title, ...body] = args;
  if (!title) { err('Usage: wudland letter "Title" "Body"'); return 1; }
  const cfg = readConfig();
  if (!cfg.links.length) { err('Not linked. Run: wudland link <code>'); return 1; }
  const state = readState();
  if (!allowLetter(state)) { err('Daily send limit reached. Try again tomorrow.'); return 1; }
  writeState(state);
  const res = await sendToLinks(cfg.links, buildLetter({ from: hostLabel(cfg), title, body: body.join(' ') }));
  if (res.every((r) => r.ok)) { out('Letter sent.'); return 0; }
  err(`Could not send: ${res.find((r) => !r.ok).error}`);
  return 1;
}

function cmdConfig(args) {
  const cfg = readConfig();
  const [key, ...vals] = args;
  const value = vals.join(' ').trim();
  if (!key) {
    out(`titles ${cfg.titles === false ? 'off' : 'on'}\nrelay  ${cfg.relay || '(default ' + DEFAULT_RELAY + ')'}\nhost   ${hostLabel(cfg)}`);
    return 0;
  }
  if (key === 'titles' && (value === 'on' || value === 'off')) {
    cfg.titles = value === 'on';
    out(cfg.titles ? 'Titles on: session names are sent.' : 'Titles off: only folder names are sent.');
  } else if (key === 'relay' && /^https?:\/\//.test(value)) {
    cfg.relay = value.replace(/\/+$/, '');
    for (const l of cfg.links) l.relay = cfg.relay;
    out(`Relay set to ${cfg.relay}. Your phone must use the same relay.`);
  } else if (key === 'host' && value) {
    cfg.host = clip(value, 24);
    out(`Computer name set to ${cfg.host}.`);
  } else { err('Usage: wudland config titles on|off | relay URL | host NAME'); return 1; }
  writeConfig(cfg);
  return 0;
}

function cmdEmit(args) {
  const { values } = parseArgs({ args, options: {
    src: { type: 'string' }, state: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' },
    sid: { type: 'string' }, tool: { type: 'string' }, tools: { type: 'string' }, where: { type: 'string' },
    model: { type: 'string' }, parent: { type: 'string' },
  } });
  const states = ['busy', 'waiting', 'idle', 'done', 'failed'];
  if (!states.includes(values.state)) { err(`--state must be one of ${states.join(', ')}`); return 1; }
  try {
    track({
      sid: values.sid || `${values.src || 'cli'}-${process.ppid}`, src: values.src || 'cli', state: values.state,
      name: values.name, forceName: Boolean(values.name), note: values.note, tool: values.tool,
      tools: values.tools !== undefined ? Number(values.tools) : undefined,
      where: values.where || folderName(process.cwd()), model: values.model, parent: values.parent,
    });
  } catch { /* emit is used from hooks and scripts: stay quiet */ }
  return 0;
}

async function cmdRun(args) {
  const dash = args.indexOf('--');
  const own = dash >= 0 ? args.slice(0, dash) : [];
  const cmd = dash >= 0 ? args.slice(dash + 1) : args;
  if (!cmd.length) { err('Usage: wudland run [--name TITLE] -- <command...>'); return 1; }
  const { values } = parseArgs({ args: own, options: { name: { type: 'string' }, src: { type: 'string' } } });
  const intent = {
    sid: `run-${randomHex(6)}`, src: values.src || 'cli', where: folderName(process.cwd()),
    name: values.name || clip(cmd.map((c, i) => (i === 0 ? basename(c) : c)).join(' '), 60), forceName: true,
  };
  const safe = (i) => { try { track({ ...intent, ...i }); } catch { /* ignore */ } };
  safe({ state: 'busy', note: 'Started' });

  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
    child.on('error', (e) => { err(`wudland: ${e.message}`); safe({ state: 'failed', note: clip(e.message, 100) }); resolve(127); });
    child.on('exit', (code, signal) => {
      const ok = code === 0;
      safe({ state: ok ? 'done' : 'failed', note: ok ? 'Finished' : signal ? `Stopped by ${signal}` : `Exited with code ${code}` });
      // Give the detached sender a moment to start before we leave.
      setTimeout(() => resolve(signal ? 1 : code ?? 1), 50);
    });
  });
}

async function cmdTestSend() {
  const cfg = readConfig();
  if (!cfg.links.length) { err('Not linked. Run: wudland link <code>'); return 1; }
  const state = readState();
  if (!allowLetter(state)) { err('Daily send limit reached. Try again tomorrow.'); return 1; }
  writeState(state);
  const evt = buildEvent({
    sid: `test-${hostLabel(cfg)}`, src: 'cli', host: hostLabel(cfg), name: 'Test from wudland', where: folderName(process.cwd()),
    state: 'idle', note: 'Hello from the command line', titles: cfg.titles,
  });
  const res = await sendToLinks(cfg.links, evt);
  const ok = res.filter((r) => r.ok).length;
  out(ok === res.length ? 'Sent. Check Wudland for a new villager.' : `Sent to ${ok} of ${res.length}. ${res.find((r) => !r.ok).error}`);
  return ok === res.length ? 0 : 1;
}

