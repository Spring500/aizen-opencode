import { createOpencodeClient as createSDKClient } from "@opencode-ai/sdk/v2"

export type ClientConfig = {
  baseUrl: string
  directory: string
  fetch?: typeof globalThis.fetch
}

export type SSEEvent = Record<string, any>

function describeError(err: unknown, response?: Response): string {
  if (err instanceof Error) {
    const cause = (err as any).cause
    if (err.message === "fetch failed" || cause?.code) {
      if (cause?.code === "ECONNREFUSED") {
        const addr = cause?.address ?? "localhost"
        const port = cause?.port ?? ""
        return `无法连接到 opencode 服务 — ${addr}${port ? ":" + port : ""} ${port ? "端口" : ""}未在运行或不可达 (${cause.code})`
      }
      if (cause?.code === "ENOTFOUND" || cause?.code === "EAI_AGAIN") {
        return `无法解析 opencode 服务地址 — ${cause?.hostname ?? "未知主机"} (${cause.code})`
      }
      if (cause?.code === "ECONNRESET") {
        return `与 opencode 服务的连接被重置 — 服务可能意外终止 (${cause.code})`
      }
      if (cause?.code === "ETIMEDOUT") {
        return `连接 opencode 服务超时 — 请检查网络或服务是否正常响应 (${cause.code})`
      }
      return `网络请求失败: ${err.message}${cause?.code ? " (" + cause.code + ")" : ""}`
    }
    if (response) {
      return `服务端错误 (HTTP ${response.status} ${response.statusText}): ${err.message}`
    }
    return err.message
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as any
    const msg = obj.message ?? obj.name ?? obj.error ?? JSON.stringify(err)
    if (response) return `服务端错误 (HTTP ${response.status}): ${msg}`
    return msg
  }
  if (typeof err === "string" && err.length > 0) return err
  return "未知错误"
}

function unwrap<T>(r: { data?: T; error?: any; response?: Response }): T {
  if (r.error) {
    const msg = describeError(r.error, r.response)
    throw new Error(msg, { cause: r.error })
  }
  if (r.data === undefined || r.data === null) {
    throw new Error("服务器返回空数据 — opencode 服务可能未正常响应")
  }
  return r.data
}

export function createClient(config: ClientConfig) {
  const sdk = createSDKClient({
    baseUrl: config.baseUrl,
    directory: config.directory,
    fetch: config.fetch,
  })

  return {
    baseUrl: config.baseUrl,

    listSessions: (params: { roots?: boolean; limit?: number }) =>
      sdk.session.list(params).then((r) => r.data ?? []),

    getSession: (id: string) =>
      sdk.session.get({ sessionID: id }).then((r) => unwrap(r)),

    createSession: (body: { title?: string }) =>
      sdk.session.create({ title: body.title, directory: config.directory }).then((r) => unwrap(r)),

    sendMessage: (sid: string, body: { parts: any[] }) =>
      sdk.session.prompt({ sessionID: sid, parts: body.parts }),

    sendCommand: (sid: string, body: { command: string; arguments?: string; model?: string; agent?: string }) =>
      sdk.session.command({ sessionID: sid, command: body.command, arguments: body.arguments, model: body.model, agent: body.agent }),

    replyPermission: (rid: string, reply: string) =>
      sdk.permission.reply({ requestID: rid, reply: reply as "once" | "always" | "reject" }),

    replyQuestion: (qid: string, answer: string) =>
      sdk.question.reply({ requestID: qid, answers: [[answer]] }),

    abortSession: (sid: string) =>
      sdk.session.abort({ sessionID: sid }),

    forkSession: (sid: string, messageID?: string) =>
      sdk.session.fork({ sessionID: sid, ...(messageID ? { messageID } : {}) }).then((r) => unwrap(r)),

    getMessages: (sid: string, limit: number) =>
      sdk.session.messages({ sessionID: sid, limit }).then((r) => r.data ?? []),

    subscribe: () => ({ stream: sdk.event.subscribe() }),
  }
}
