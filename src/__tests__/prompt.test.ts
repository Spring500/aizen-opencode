import { describe, test, expect } from "bun:test"
import { processEvent, createPromptLoop } from "../commands/prompt"
import type { Session } from "../state"

describe("processEvent", () => {
  const session: Session = {
    id: "ses_001",
    title: "test",
    files: [],
    approved: new Set(),
  }

  test("message.updated -> header shown", () => {
    const outputs: string[] = []
    const event = { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "claude-sonnet-4" } } }
    const state = { session, headerShown: false, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.headerShown).toBe(true)
  })

  test("message.updated duplicate -> not shown again", () => {
    const outputs: string[] = []
    const event = { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "c" } } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.headerShown).toBe(true)
    expect(outputs.length).toBe(0)
  })

  test("text part -> added to outputs", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "hello world", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("hello world"))).toBe(true)
  })

  test("text part without end time -> not added", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "partial" } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("tool running -> added", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "running", title: "npm install" } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("bash") && l.includes("npm install"))).toBe(true)
  })

  test("tool completed -> shows output", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "completed", title: "done", output: "result!" } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.join("\n")).toContain("result!")
  })

  test("tool error -> shows error", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "write", state: { status: "error", title: "fail", output: "EACCES" } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.join("\n")).toContain("EACCES")
  })

  test("reasoning thinking=true", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "reasoning", text: "thinking...", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: true })
    expect(outputs.some(l => l.includes("thinking..."))).toBe(true)
  })

  test("reasoning thinking=false -> suppressed", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "reasoning", text: "secret", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("step-start/step-finish -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    processEvent({ type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "step-start" } } }, state, { thinking: false })
    processEvent({ type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "step-finish" } } }, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("session.error -> outputs error", () => {
    const outputs: string[] = []
    const event = { type: "session.error", properties: { sessionID: "ses_001", error: { message: "rate limited" } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.join("")).toContain("rate limited")
  })

  test("session.status idle -> returns done", () => {
    const event = { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } }
    const state = { session, headerShown: true, outputs: [] }
    const result = processEvent(event, state, { thinking: false })
    expect(result.done).toBe(true)
  })

  test("permission.asked approved pattern -> auto approve", () => {
    const sessionApproved = { ...session, approved: new Set(["rm -rf"]) }
    const outputs: string[] = []
    const event = { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_1", permission: "bash", patterns: ["rm -rf"] } }
    const state = { session: sessionApproved, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.autoReply).toEqual({ requestID: "req_1", reply: "always" })
  })

  test("permission.asked not approved -> need permission", () => {
    const outputs: string[] = []
    const event = { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_2", permission: "bash", patterns: ["rm -rf"] } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needPermission).toEqual({ requestID: "req_2", permission: "bash", patterns: ["rm -rf"] })
  })

  test("permission.asked empty patterns -> need permission", () => {
    const outputs: string[] = []
    const event = { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_3", permission: "bash", patterns: [] } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needPermission).toBeDefined()
    expect(result.autoReply).toBeUndefined()
  })

  test("question.asked -> need question", () => {
    const outputs: string[] = []
    const event = { type: "question.asked", properties: { sessionID: "ses_001", id: "q1", question: "端口?" } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needQuestion).toEqual({ id: "q1", question: "端口?" })
  })

  test("unknown event -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    const result = processEvent({ type: "unknown.xxx" }, state, { thinking: false })
    expect(result).toEqual({ headerShown: true, outputs })
  })

  test("event without type -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    const result = processEvent({} as any, state, { thinking: false })
    expect(result).toEqual({ headerShown: true, outputs })
  })

  test("tool completed before running -> renders without crash", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "completed", title: "cmd" } } } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(outputs.length).toBeGreaterThan(0)
  })

  test("different sessionID -> ignored", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "other_ses", part: { type: "text", text: "nope", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("multiline text part -> added to outputs", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "line1\nline2\nline3", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("line1\nline2\nline3"))).toBe(true)
  })
})

describe("createPromptLoop", () => {
  test("basic prompt processes events to completion", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({ ok: true }),
      replyQuestion: async () => ({ ok: true }),
    } as any

    const events: any[] = [
      { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "claude" } } },
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "hello!", time: { end: 1 } } } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "hi" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.state).toBe("completed")
    expect(result.outputs.some(l => l.includes("hello!"))).toBe(true)
  })

  test("permission flow: asked -> approved -> continues", async () => {
    let permReplied = ""
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async (_rid: string, reply: string) => { permReplied = reply },
    } as any

    const events: any[] = [
      { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_x", permission: "bash", patterns: ["rm"] } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "delete" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      onPermission: async () => "once",
    })
    expect(permReplied).toBe("once")
    expect(result.state).toBe("completed")
  })

  test("abort mid-stream returns aborted state", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    const ac = new AbortController()
    const events: any[] = [
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "before abort", time: { end: 1 } } } },
      { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "after abort", time: { end: 1 } } } },
    ]
    async function* gen() {
      yield events[0]
      ac.abort()
      yield events[1]
    }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "test" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      signal: ac.signal,
    })
    expect(result.state).toBe("aborted")
  })

  test("question flow: asked → answered → continues", async () => {
    let questionReplied = ""
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyQuestion: async (_id: string, answer: string) => { questionReplied = answer },
      replyPermission: async () => ({}),
    } as any

    const events: any[] = [
      { type: "question.asked", properties: { sessionID: "ses_001", id: "q1", question: "端口?" } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "what port" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      onQuestion: async () => "8080",
    })
    expect(questionReplied).toBe("8080")
    expect(result.state).toBe("completed")
  })

  test("permission without onPermission handler outputs prompt text", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    const events: any[] = [
      { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_z", permission: "bash", patterns: ["rm"] } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "delete" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.state).toBe("completed")
    expect(result.outputs.join("")).toContain("批准？")
  })

  test("question without onQuestion handler outputs prompt text", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    const events: any[] = [
      { type: "question.asked", properties: { sessionID: "ses_001", id: "q2", question: "端口?" } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [{ type: "text", text: "which port" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.state).toBe("completed")
    expect(result.outputs.join("")).toContain("端口?")
  })
})
