export type ClientConfig = {
  baseUrl: string
  directory: string
  fetch?: typeof globalThis.fetch
}

export type SSEEvent = Record<string, any>

export function createClient(config: ClientConfig) {
  const f = config.fetch ?? globalThis.fetch.bind(globalThis)

  function url(path: string, params?: Record<string, string>) {
    let u = `${config.baseUrl}${path}`
    if (params) {
      const qs = new URLSearchParams(params).toString()
      if (qs) u += `?${qs}`
    }
    return u
  }

  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const res = await f(url(path, params))
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await f(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  return {
    baseUrl: config.baseUrl,

    listSessions: (params: { roots?: boolean; limit?: number }) =>
      get<any[]>(`/session`, {
        directory: config.directory,
        ...params.roots !== undefined ? { roots: String(params.roots) } : {},
        ...params.limit !== undefined ? { limit: String(params.limit) } : {},
      }),

    getSession: (id: string) =>
      get<any>(`/session/${id}`),

    createSession: (body: { title?: string }) =>
      post<any>("/session", body),

    sendMessage: (sid: string, body: { parts: any[]; model?: string }) =>
      post<any>(`/session/${sid}/message`, body as any),

    sendCommand: (sid: string, body: { command: string; arguments?: string }) =>
      post<any>(`/session/${sid}/command`, body),

    replyPermission: (rid: string, reply: string) =>
      post<any>(`/permission/${rid}/reply`, { reply }),

    replyQuestion: (qid: string, answer: string) =>
      post<any>(`/question/${qid}/reply`, { answer }),

    abortSession: (sid: string) =>
      post<any>(`/session/${sid}/abort`),

    forkSession: (sid: string, messageID: string) =>
      post<any>(`/session/${sid}/fork`, { messageID }),

    getMessages: (sid: string, limit: number) =>
      get<any[]>(`/session/${sid}/message`, { limit: String(limit) }),

    subscribe: (): { stream: AsyncIterable<SSEEvent> } => {
      let done = false
      return {
        stream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: true, value: undefined }
              },
            }
          },
        },
      }
    },
  }
}
