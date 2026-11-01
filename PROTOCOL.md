# Wudland Link protocol, v1

How tools on your computers (Claude Code, Codex, opencode, any script) show up in the Wudland iPhone app.
No accounts and no Wudland server. Messages go through an ntfy-compatible relay (default `https://ntfy.sh`)
with end-to-end encryption for event and letter content. The relay sees random topics, timing/IP metadata,
and plaintext pairing metadata (computer label, tool kind, host label and ephemeral public keys); it does not receive the verification code or linked inbox key in plaintext.

## Primitives
- X25519 key agreement, raw 32-byte public keys.
- HKDF-SHA256 -> 32-byte key.
- AES-256-GCM. A "box" is `nonce(12) || ciphertext || tag(16)`, base64 (standard, padded). This is exactly CryptoKit's `AES.GCM.SealedBox.combined`.
- All JSON is UTF-8.

## The app token (6 digits, changes every 60 s)
- The app keeps a random 32-byte secret in the Keychain.
- Code = RFC 6238 TOTP: HMAC-SHA1, 60-second step, 6 digits, T0 = 0.
- Shown in Settings > Link a computer. Valid for the current and the previous step.

## Pair topic
`pairTopic(code) = "wudland-pair-" + hex(SHA256("wudland-pair-v1:" + code))[0..<24]`

## Pairing
1. Plugin (`wudland link 123456`) makes an ephemeral X25519 key pair and a random 16-byte `nonce`, then POSTs to `{relay}/{pairTopic}` this JSON body:
   `{"t":"hello","v":1,"pk":"<b64 raw pubkey>","nonce":"<b64 16 bytes>","name":"Claude Code","kind":"claude","host":"studio"}`
   - `kind`: `claude` | `codex` | `opencode` | `cli` | anything short.
   - `host`: a short machine label (default: hostname before the first dot, lowercased, max 24 chars).
2. The app, while the Link screen is open, polls `GET {relay}/{pairTopicNow},{pairTopicPrev}/json?poll=1&since=2m` (one request, comma-separated topics) every 3 s. Each line is an ntfy message object; the JSON above is in `.message`.
3. The app creates an ephemeral X25519 pair and derives
   `k = HKDF-SHA256(ikm: X25519(appEph, pluginPk), salt: nonce, info: "wudland-pair-v1", 32)`.
   It posts `{"t":"challenge","v":1,"to":"<plugin nonce b64>","pk":"<app eph pubkey b64>"}`.
   Both sides calculate a verification code: SHA256 of UTF-8 `"wudland-verify-v1:"` followed by the raw derived key;
   interpret the first four digest bytes as an unsigned big-endian integer, modulo 100000000, zero-pad to 8 digits,
   display as `1234 5678`. **Never transmit this verification code through the relay.**
4. The CLI displays that verification code. The phone displays the matching code alongside the request's computer name.
   The user compares both screens and taps **Codes match** only if the codes match exactly. A mismatch must be denied.
   This comparison authenticates the ephemeral key exchange against an active relay substituting public keys.
   The original six-digit token is only a discovery code; it is not itself proof of identity. Requests expire after 120 seconds.
5. Only after confirmation, the app creates a link: random 8-byte hex `id`, random 16-byte hex `inbox` prefixed `wudland-`,
   and a random 32-byte `key`. It sends
   `{"t":"welcome","v":1,"to":"<nonce>","pk":"<same app ephemeral pubkey>","box":"<b64 AES-GCM box>"}`.
   Box plaintext is `{"id":"…","inbox":"…","key":"<b64 32 bytes>","relay":"https://ntfy.sh"}` encrypted with `k`.
   The CLI pins the first challenge public key and ignores welcome messages with a different public key or no prior challenge.
6. The plugin polls every 3 seconds for at most 120 seconds. It saves the confirmed link in
   `~/.config/wudland/link.json` (mode 0600). One file can hold several links.
7. Deny posts `{"t":"deny","v":1,"to":"<nonce>"}`. A forged denial can interrupt pairing but cannot expose a link key.

## Events (computer -> phone)
POST `{relay}/{inbox}` with the body `w1.<b64 box>` encrypted with the link `key` (random 12-byte nonce each time).
Plaintext:
```json
{"v":1,"sid":"<session id>","src":"claude","host":"studio","name":"Fix the login bug",
 "where":"my-app","state":"busy","tool":"Edit","tools":14,"model":"opus","started":"2026-11-01T15:00:00Z",
 "at":"2026-11-01T15:12:03Z","note":"Edited src/auth.ts","parent":null}
```
- `state`: `busy` (working), `waiting` (needs you), `idle`, `done`, `failed`.
- `sid` is stable for one agent session. `parent` is the sid of the session that spawned this one (subagents), or null.
- `name` is a short title (first prompt, max 60 chars). Users can turn titles off (`wudland config titles off`), then `name` is the folder name.
- `note` max 120 chars. Never send file contents, prompts beyond the title, or secrets.
- Letters: `{"v":1,"kind":"letter","from":"studio","title":"Backup finished","body":"…(max 600 chars)","at":"…"}` sent by `wudland letter "Title" "Body"`. These land in the Raven Post.
- Budget: the public ntfy.sh allows about 250 published messages per day per IP and refills requests at one per 5 s. So plugins must:
  - send state changes immediately (busy/waiting/idle/done/failed), but at most one per session per 5 s;
  - send tool/progress updates for a busy session at most once every 3 minutes (coalesce: latest wins);
  - keep a per-machine daily counter in `~/.config/wudland/state.json`; above 180 sends in a UTC day, only state changes go out; above 240, nothing until tomorrow;
  - never retry a failed POST more than once.
  Users who want more can point `relay` at their own ntfy server (`wudland config relay https://ntfy.example.com`).

## The app reading events
`GET {relay}/{inbox1},{inbox2},…/json?poll=1&since=<last message id, or 12h>` (all links in one request) every 8 s while the app is open, and once on return to the foreground. Decrypt; drop anything that fails to decrypt. The authenticated payload `at` must be less than 24 hours old and at most 5 minutes in the future; relay timestamps are not trusted. Persist the latest 1000 encrypted-box SHA256 fingerprints to reject duplicates across restarts; ignore session updates older than the latest authenticated session timestamp. Letter IDs derive from the link ID and encrypted-box fingerprint. Sessions with no event for 45 minutes are shown as asleep; after 24 hours they are forgotten.

## Unlinking
The app forgets the link (the inbox goes quiet). `wudland unlink` removes it on the computer.

## Test vector
`plugins/test/vectors.json` holds a fixed key, nonce, plaintext and box so the Swift side can check interop.
