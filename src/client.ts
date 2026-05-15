import { createOpencodeClient as createSDKClient } from "@opencode-ai/sdk/v2"

export type ClientConfig = {
  baseUrl: string
  directory: string
  fetch?: typeof globalThis.fetch
}

export type SSEEvent = Record<string, any>

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
      sdk.session.get({ sessionID: id }).then((r) => r.data),

    createSession: (body: { title?: string }) =>
      sdk.session.create({ title: body.title, directory: config.directory }).then((r) => r.data),

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
      sdk.session.fork({ sessionID: sid, ...(messageID ? { messageID } : {}) }),

    getMessages: (sid: string, limit: number) =>
      sdk.session.messages({ sessionID: sid, limit }),

    subscribe: () => ({ stream: sdk.event.subscribe() }),
  }
}
