---
description: Link this computer to the Wudland app with the 6-digit code
argument-hint: <6-digit code>
allowed-tools: Bash(node:*)
---

Run this exact command with the Bash tool, then tell me the result in one line. Do not do anything else.

```
node "${CLAUDE_PLUGIN_ROOT}/launcher.mjs" link $ARGUMENTS --kind claude --name "Claude Code" --timeout 100
```

If I did not give a code, ask me to open Wudland > Settings > Link a computer and read it out.
