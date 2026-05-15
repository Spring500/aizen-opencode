import { describe, test, expect } from "bun:test"
import { createSession } from "../state"
import { parseSlash } from "../commands/slash"
import { processEvent } from "../commands/prompt"
import { formatHistory, formatSessions } from "../format"
import { createClient } from "../client"

describe("slash routing → client chain", () => {
  test("/review is passthrough", () => {
    const r = parseSlash("/review")
    expect(r).not.toBeNull()
    if (r) { expect(r.local).toBe(false); expect(r.command).toBe("review") }
  })
  test("/compact is passthrough", () => {
    const r = parseSlash("/compact")
    expect(r).not.toBeNull()
    if (r) expect(r.local).toBe(false)
  })
  test("all local commands recognized", () => {
    for (const cmd of ["/quit","/exit","/switch","/new","/fork","/history","/file","/files","/clear-files","/model","/info","/sessions"]) {
      const r = parseSlash(cmd)
      expect(r).not.toBeNull()
      if (r) expect(r.local).toBe(true)
    }
  })
})

describe("format pipeline", () => {
  test("formatSessions with realistic data", () => {
    const data = [
      { id: "ses_a1b2c3d4e5f6g7h8i9j0", title: "调研 OpenCode", updated: "11:18" },
      { id: "ses_x1y2z3", title: "维护 fork", updated: "10:57" },
    ]
    const out = formatSessions(data)
    expect(out).toContain("调研 OpenCode")
    expect(out).toContain("Session ID")
  })
  test("formatHistory with mixed messages", () => {
    const msgs = [
      { role: "user" as const, text: "hello" },
      { role: "assistant" as const, text: "你好！" },
      { role: "user" as const, text: "查看文件" },
    ]
    const out = formatHistory(msgs, 3)
    expect(out).toContain("hello")
    expect(out).toContain("查看文件")
  })
})

describe("event stream simulation", () => {
  test("stream: text + tool + idle", () => {
    const session = createSession({ id: "ses_001", title: "test" })
    let s = { session, headerShown: false, outputs: [] as string[] }
    const cfg = { thinking: false }

    for (const e of [
      { type: "message.updated", properties: { info: { role: "assistant", agent: "b", modelID: "c4" } } },
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "分析中", time: { end: 1 } } } },
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "running", title: "ls" } } } },
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "completed", title: "ls", output: "src/\ntests/" } } } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]) {
      const r = processEvent(e, s, cfg)
      s = { ...s, ...r }
      if (r.done) break
    }
    expect(s.headerShown).toBe(true)
    expect(s.outputs.some(l => l.includes("分析中"))).toBe(true)
    expect(s.outputs.some(l => l.includes("src/"))).toBe(true)
  })

  test("permission auto-approve skips prompt", () => {
    const session = createSession({ id: "ses_001", title: "test" })
    session.approved.add("rm -rf")
    const s = { session, headerShown: false, outputs: [] as string[] }
    const r = processEvent({ type: "permission.asked", properties: { sessionID: "ses_001", id: "req_1", permission: "bash", patterns: ["rm -rf"] } }, s, { thinking: false })
    expect(r.autoReply).toEqual({ requestID: "req_1", reply: "always" })
  })

  test("event from different session ignored", () => {
    const session = createSession({ id: "ses_001", title: "test" })
    const s = { session, headerShown: false, outputs: [] as string[] }
    const r = processEvent({ type: "message.part.updated", properties: { sessionID: "ses_other", part: { type: "text", text: "nope", time: { end: 1 } } } }, s, { thinking: false })
    expect(r.outputs.length).toBe(0)
  })
})

describe("client integration", () => {
  test("client has all required methods", () => {
    const c = createClient({ baseUrl: "http://x", directory: "/d" })
    for (const m of ["listSessions","getSession","createSession","sendMessage","sendCommand","replyPermission","replyQuestion","abortSession","forkSession","getMessages","subscribe"]) {
      expect(typeof (c as any)[m]).toBe("function")
    }
  })
})
