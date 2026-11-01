# Wudland for Codex

Install the CLI and link this computer first:

```
npm i -g github:joexk1/wudland-plugins
wudland link 123456
```

Then pick one of the two options below. Not both, or every turn is reported twice.

## Option 1: notify (simple)

Codex runs a program after each turn. Add this to `~/.codex/config.toml`:

```toml
notify = ["wudland", "codex-notify"]
```

If you would rather point at the script directly (for example from a clone of this repo):

```toml
notify = ["node", "/path/to/wudland-plugins/codex/notify.mjs"]
```

You get one update per finished turn: the session appears and goes idle.

If you already have a notify program, keep it. Wudland can run it for you:

```
export WUDLAND_CHAIN_NOTIFY='["python3", "/path/to/your/notify.py"]'
```

A plain command line also works (`WUDLAND_CHAIN_NOTIFY="notify-send Codex"`). The Codex JSON is added as the last argument, exactly as Codex would have passed it.

The payload Codex sends has `type` ("agent-turn-complete"), `thread-id`, `turn-id`, `cwd`, `input-messages` and `last-assistant-message`. Wudland only uses the thread id, the folder name and the first message (as the title). It never sends the assistant's reply.

## Option 2: hooks (live status)

Recent Codex versions have lifecycle hooks, which show busy, waiting and idle as they happen. Copy `hooks.json` to `~/.codex/hooks.json`, or merge its `hooks` into an existing one. Then open `/hooks` in Codex and trust it.

Each hook runs `wudland hook codex`, which exits straight away and sends in the background.

## Check it

`wudland test-send` should put a villager in the app. After that, `wudland status` shows today's send count.
