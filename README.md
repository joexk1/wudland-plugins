<p align="center">
  <img src="assets/icon-256.png" alt="Wudland" width="160">
</p>

<h1 align="center">Wudland Link</h1>

<p align="center">Show the coding agents on your computer as villagers in Wudland.</p>

## What it is

[Wudland](https://github.com/joexk1/wudland) is a small pixel village on my iPhone where my AI agents live as villagers. This repo is the bit that sits on your computer and tells the app what your agents are up to: working, waiting for you, finished, or in trouble.

It works with Claude Code, Codex, opencode, and anything else you can run in a terminal. There is no account and no Wudland server. Messages go through an ntfy relay and are encrypted before they leave your machine. More about the app at https://wudland.pages.dev.

You need Node 18 or newer.

## Install

First, the command line tool. You need it to link your computer, and the Codex and opencode bits use it too:

```
npm i -g github:joexk1/wudland-plugins
```


If your npm version refuses GitHub packages with `EALLOWGIT`, allow this direct dependency for that command:

```sh
npm i -g --allow-git=root github:joexk1/wudland-plugins
```

Then add whichever agents you use.

### Claude Code

```
/plugin marketplace add joexk1/wudland-plugins
/plugin install wudland@wudland
```

The plugin carries its own copy of the code, so it works even if you skip the global install. In that case link with `/wudland:link 123456` from inside Claude Code.

### Codex

Add one line to `~/.codex/config.toml`:

```toml
notify = ["wudland", "codex-notify"]
```

Newer Codex versions also have hooks, which give live status. The details, and how to keep an existing notify program, are in [codex/README.md](codex/README.md).

### opencode

Copy the plugin into opencode's plugin folder:

```
mkdir -p ~/.config/opencode/plugin
cp opencode/wudland.js ~/.config/opencode/plugin/
```

Use `.opencode/plugin/` in a project if you only want it there. It calls the `wudland` command, so keep the global install.

### Anything else

Wrap any command. The villager is busy while it runs, then done or failed when it exits:

```
wudland run -- aider
wudland run --name "Nightly import" -- ./import.sh
```

For scripts that want more control there is `wudland emit --src myscript --state busy --name "Thing" --note "Step 2"`.

## Linking

1. Open Wudland, go to Settings, then Link a computer. It shows a 6 digit code that changes every minute.
2. On the computer, run `wudland link 123456` with that code.
3. Compare the separate 8-digit verification code on your computer and phone. If they match, tap Codes match on your phone. If they differ, deny the connection.

You will see "Waiting for you to approve on your phone" until you do. After that, `wudland test-send` should put a villager in the app. You only link once per computer, and every agent on it shares that link. Linking two phones works too.

## Letters

Scripts can post a note to the Raven Post:

```
wudland letter "Backup finished" "Documents copied at 03:00."
```

[scripts/backup-letter.sh](scripts/backup-letter.sh) is a cron example.

## What gets sent, and privacy

Each update has the session's name, the folder it is in, its state, the last tool used, how many tools it has run, the model, a short note like "Edited src/auth.ts", and the computer's name. That is all.

I never send file contents, command lines, prompts beyond a 60 character title, or the agent's replies.

- Agent updates and letters are end-to-end encrypted with AES-256-GCM. The key is created by your phone and handed to your computer inside an X25519 key exchange when you link. The verification code lets you check that a relay has not substituted the exchange keys.
- The relay (ntfy.sh by default) sees topic names, network metadata and encrypted event/letter payloads. During pairing it also sees computer labels, tool kind and public exchange keys.
- Titles can be turned off. `wudland config titles off` sends the folder name instead of your prompt, and drops file names from notes.
- You can run your own relay: `wudland config relay https://ntfy.example.com`. Your phone has to use the same one.
- Hooks never wait on relay requests. They make a short, bounded update to local state, send from a background process, and do nothing at all if you have not linked.

The wire format is written down in [PROTOCOL.md](PROTOCOL.md).

## Limits

The public relay is generous but not unlimited, so I keep to about 250 messages a day:

- A state change goes out straight away, at most once every 5 seconds per session.
- Tool progress goes out at most every 3 minutes.
- After 180 messages in a (UTC) day, only state changes are sent. After 240, nothing until tomorrow.
- A failed send is retried once, then dropped.

`wudland status` shows today's count. A self-hosted relay has no such limits, but the numbers above stay as they are.

## Commands

```
wudland link <code>        link this computer
wudland unlink             remove the link
wudland status             show link, settings and today's count
wudland letter "T" "B"     post a letter
wudland config             titles on|off, relay URL, host NAME
wudland emit               send one update from a script
wudland run -- <cmd>       wrap any command
wudland test-send          send a test villager
```

Settings live in `~/.config/wudland/` (`link.json` and `state.json`, both private to you).

## Uninstall

```
wudland unlink
npm rm -g wudland-link
```

For Claude Code, run `/plugin uninstall wudland@wudland`. For Codex, remove the `notify` line or the hooks. For opencode, delete `wudland.js` from the plugin folder. Then remove the computer in the app too.

## Development

```
npm test
npm run build:plugins
```

The shared code lives in `lib/`. `build:plugins` copies it into `claude-code/lib/`, because Claude Code copies a plugin to its own cache and it has to carry everything it needs. A test fails if the copy is stale. `test/vectors.json` has fixed keys and boxes for checking the Swift side.

## Links

- The app: https://github.com/joexk1/wudland
- The site: https://wudland.pages.dev

MIT licence. See [LICENSE](LICENSE).
