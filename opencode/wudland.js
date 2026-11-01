// Wudland plugin for opencode.
// Install: copy this file to ~/.config/opencode/plugin/ (or .opencode/plugin/ in a project).
// It needs the `wudland` CLI on your PATH and a linked computer (`wudland link <code>`).
// Each event runs `wudland emit` in a detached process, so opencode never waits on it.
import { spawn } from "node:child_process"
import { basename } from "node:path"

const DEFAULT_TITLE = /^(New session|Child session) - /

export const WudlandPlugin = async ({ directory }) => {
  const sessions = new Map() // id -> { title, tools, lastTool, parent, state }
  const where = basename(directory || process.cwd())

  const get = (id) => {
    if (!sessions.has(id)) sessions.set(id, { title: "", tools: 0, lastTool: 0, parent: null, state: null })
    return sessions.get(id)
  }

  // Fire and forget. Errors (CLI missing, not linked) are ignored on purpose.
  const emit = (id, state, extra = {}) => {
    try {
      const s = get(id)
      const args = ["emit", "--src", "opencode", "--sid", id, "--state", state, "--where", where, "--tools", String(s.tools)]
      if (s.title) args.push("--name", s.title)
      if (s.parent) args.push("--parent", s.parent)
      if (extra.note) args.push("--note", extra.note)
      if (extra.tool) args.push("--tool", extra.tool)
      const child = spawn("wudland", args, { detached: true, stdio: "ignore", windowsHide: true })
      child.on("error", () => {})
      child.unref()
      s.state = state
    } catch {}
  }

  const remember = (info) => {
    const s = get(info.id)
    if (info.parentID) s.parent = info.parentID
    if (info.title && !DEFAULT_TITLE.test(info.title)) s.title = info.title
    return s
  }

  return {
    event: async ({ event }) => {
      const p = event.properties || {}
      switch (event.type) {
        case "session.created":
          remember(p.info)
          emit(p.info.id, "idle", { note: "Session started" })
          break
        case "session.updated": {
          // Titles are generated after the first message; send once when it changes.
          const before = get(p.info.id).title
          const s = remember(p.info)
          if (s.title && s.title !== before) emit(p.info.id, s.state || "idle", { note: "Renamed" })
          break
        }
        case "session.status":
          if (p.status?.type === "busy") emit(p.sessionID, "busy", { note: "Working" })
          break
        case "permission.updated":
          emit(p.sessionID, "waiting", { note: "Needs your permission" })
          break
        case "permission.replied":
          emit(p.sessionID, "busy", { note: "Working" })
          break
        case "session.idle":
          emit(p.sessionID, "idle", { note: "Finished a turn" })
          break
        case "session.error":
          if (p.sessionID) emit(p.sessionID, "failed", { note: "Hit an error" })
          break
        case "session.deleted":
          emit(p.info.id, "done", { note: "Session closed" })
          sessions.delete(p.info.id)
          break
      }
    },

    // Tool calls: count every one, but only spawn the CLI every 20 s (it throttles further).
    "tool.execute.before": async (input) => {
      const s = get(input.sessionID)
      s.tools += 1
      if (Date.now() - s.lastTool < 20000) return
      s.lastTool = Date.now()
      emit(input.sessionID, "busy", { tool: input.tool, note: `Using ${input.tool}` })
    },
  }
}

