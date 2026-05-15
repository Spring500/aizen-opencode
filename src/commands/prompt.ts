import type { Session } from "../state"
import { formatAIHeader, formatTextDelta, formatToolCall, formatReasoning, formatPermissionPrompt, formatQuestionPrompt, formatAbortMessage } from "../format"

type State = { session: Session; headerShown: boolean; outputs: string[] }
type ConfigSlice = { thinking: boolean }

type EventResult = {
  headerShown: boolean; outputs: string[]
  done?: boolean
  needPermission?: { requestID: string; permission: string; patterns: string[] }
  needQuestion?: { id: string; question: string }
  autoReply?: { requestID: string; reply: string }
}

export function processEvent(event: any, state: State, config: ConfigSlice): EventResult {
  const next = { headerShown: state.headerShown, outputs: state.outputs }
  if (!event.type) return next

  if (event.type === "session.status") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    if (props.status?.type === "idle") return { ...next, done: true }
    return next
  }

  if (event.type === "session.error") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    next.outputs.push(`${formatAbortMessage()}: ${props.error?.message ?? "unknown"}`)
    return next
  }

  if (event.type === "permission.asked") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    const patterns: string[] = props.patterns ?? []
    if (patterns.some((p: string) => state.session.approved.has(p))) {
      return { ...next, autoReply: { requestID: props.id, reply: "always" } }
    }
    return { ...next, needPermission: { requestID: props.id, permission: props.permission, patterns } }
  }

  if (event.type === "question.asked") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    return { ...next, needQuestion: { id: props.id, question: props.question } }
  }

  if (event.type === "message.updated") {
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return next
    if (state.headerShown) return next
    next.outputs.push(formatAIHeader(info.agent, info.modelID))
    next.headerShown = true
    return next
  }

  if (event.type === "message.part.updated") {
    const props = event.properties ?? {}
    const part = props.part
    if (!part || props.sessionID !== state.session.id) return next

    if (part.type === "text" && part.time?.end) {
      next.outputs.push(formatTextDelta(part.text))
      return next
    }
    if (part.type === "tool") {
      const s = part.state?.status
      if (s === "running" || s === "completed" || s === "error") {
        next.outputs.push(formatToolCall(part.tool, part.state.title ?? part.tool, s, part.state.output))
      }
      return next
    }
    if (part.type === "reasoning" && part.time?.end && config.thinking) {
      next.outputs.push(formatReasoning(part.text, true))
      return next
    }
    return next
  }

  return next
}

export async function createPromptLoop(opts: {
  client: { sendMessage: Function; replyPermission: Function; replyQuestion: Function }
  sessionID: string; events: any; parts: any[]; session: Session; config: ConfigSlice
  // model 参数已移除：SDK 的 session.prompt() 不接受 model，正确做法是通过
  // client.sendCommand({ command: "model", model: "openai/gpt-4o" }) 设置。
  onPermission?: Function; onQuestion?: Function; signal?: AbortSignal
}) {
  const { client, sessionID, events, parts, session, config } = opts
  let state: State = { session, headerShown: false, outputs: [] }
  let aborted = false

  if (opts.signal) opts.signal.addEventListener("abort", () => { aborted = true })
  await client.sendMessage(sessionID, { parts }).catch(() => {})

  const STREAM_TIMEOUT_MS = 5 * 60 * 1000
  const iterator = events.stream[Symbol.asyncIterator]()

  while (true) {
    if (aborted) return { state: "aborted" as const, outputs: state.outputs }

    const promises: Promise<IteratorResult<any, any>>[] = [
      iterator.next(),
      new Promise<IteratorResult<any, any>>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), STREAM_TIMEOUT_MS)
      ),
    ]
    if (opts.signal) {
      promises.push(
        new Promise<IteratorResult<any, any>>((_, reject) =>
          opts.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        )
      )
    }

    let next: IteratorResult<any, any>
    try { next = await Promise.race(promises) } catch { return { state: "aborted" as const, outputs: state.outputs } }

    if (next.done) break

    const result = processEvent(next.value, state, config)

    if (result.autoReply) {
      await client.replyPermission(result.autoReply.requestID, result.autoReply.reply)
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }
    if (result.needPermission && opts.onPermission) {
      const reply = await opts.onPermission(result.needPermission)
      await client.replyPermission(result.needPermission.requestID, reply)
      if (reply === "always") for (const p of result.needPermission.patterns) session.approved.add(p)
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }
    if (result.needQuestion && opts.onQuestion) {
      const answer = await opts.onQuestion(result.needQuestion)
      await client.replyQuestion(result.needQuestion.id, answer)
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }
    if (result.needPermission && !opts.onPermission) {
      state.outputs.push(formatPermissionPrompt(result.needPermission.permission, result.needPermission.patterns))
      state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
      continue
    }
    if (result.needQuestion && !opts.onQuestion) {
      state.outputs.push(formatQuestionPrompt(result.needQuestion.question))
      state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
      continue
    }

    state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
    if (result.done) break
  }

  return { state: "completed" as const, outputs: state.outputs }
}
