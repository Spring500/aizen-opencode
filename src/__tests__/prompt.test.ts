// ============================================================================
// prompt.test.ts
// ============================================================================
//
// 这个文件测试一轮对话的完整处理流程。用户发一条消息后，服务端会返回
// 一串事件（文字片段、工具调用状态、权限询问等），REPL 需要逐个处理
// 这些事件直到对话结束。
//
// 文件里有两个被测对象：
//
// 第一个是 processEvent，负责处理单个事件。它决定了每种事件类型应该
// 产生什么影响：是往输出里加一行文字、标记对话结束、触发权限询问、
// 还是忽略掉。测试覆盖了：
//   - 消息头事件：第一次出现要显示，重复出现跳过
//   - 文字片段：有结束标记的才输出（流式中的不输出）；多行文字一次性输出
//   - 工具调用：运行中、完成、失败三种状态各自的输出
//   - 推理内容：开了 thinking 显示，关了就不显示
//   - 权限询问：已经批准过的命令自动放行，没批准的发回给上层决定
//   - 问题询问：原样发回给上层
//   - 会话错误：错误信息输出到屏幕
//   - 会话空闲：标记对话完成
//   - 未知事件/无 type 事件：安全忽略，不崩溃
//   - 不同会话的事件：直接过滤掉
//
// 第二个是 createPromptLoop，负责把上面这些串成完整的循环。测试覆盖了：
//   - 正常走完：发消息 → 消费事件流 → 遇到 idle → 返回 completed
//   - 权限交互：遇到权限询问 → 回调决定通过 → 继续 → completed
//   - 中断场景：收到 abort 信号 → 返回 aborted
//   - 问题交互：遇到问题询问 → 回调给出答案 → 回复服务端 → completed
//   - 缺少权限处理器时：至少把提示信息显示出来
//   - 缺少问题处理器时：至少把问题内容显示出来
//
// ============================================================================

import { describe, test, expect } from "vitest"
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

// createPromptLoop：完整的提示交互循环（发送消息 → 消费事件流 → 权限/问题交互 → 完成/中断）
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
