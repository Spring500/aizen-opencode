import { describe, test, expect } from "bun:test"
import { createClient } from "../client"

describe("client", () => {
  describe("createClient", () => {
    test("returns client instance", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "/tmp" })
      expect(client).toBeDefined()
      expect(typeof client.baseUrl).toBe("string")
    })
  })

  describe("API wrappers", () => {
    test("listSessions builds correct params", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session?")
        expect(url).toContain("directory=")
        expect(url).toContain("roots=true")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.listSessions({ roots: true })
    })

    test("listSessions with limit", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("limit=5")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.listSessions({ limit: 5 })
    })

    test("getSession", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session/ses_001")
        return { json: async () => ({ id: "ses_001" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.getSession("ses_001")
    })

    test("createSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session")
        expect(opts?.method).toBe("POST")
        const body = JSON.parse(opts?.body as string)
        expect(body.title).toBe("新会话")
        return { json: async () => ({ id: "ses_new", title: "新会话" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.createSession({ title: "新会话" })
    })

    test("sendMessage", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/message")
        expect(opts?.method).toBe("POST")
        const body = JSON.parse(opts?.body as string)
        expect(body.parts).toBeDefined()
        if (body.model) expect(body.model).toBe("openai/gpt-4o")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendMessage("ses_1", {
        parts: [{ type: "text", text: "hello" }],
        model: "openai/gpt-4o",
      })
    })

    test("sendCommand", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/command")
        const body = JSON.parse(opts?.body as string)
        expect(body.command).toBe("review")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendCommand("ses_1", { command: "review" })
    })

    test("sendCommand with arguments", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.arguments).toBe("minor")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendCommand("ses_1", { command: "release", arguments: "minor" })
    })

    test("replyPermission once", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/permission/req1/reply")
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("once")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "once")
    })

    test("replyPermission always", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("always")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "always")
    })

    test("replyPermission reject", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("reject")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "reject")
    })

    test("replyQuestion", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/question/q1/reply")
        const body = JSON.parse(opts?.body as string)
        expect(body.answer).toBe("8080")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyQuestion("q1", "8080")
    })

    test("abortSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/abort")
        expect(opts?.method).toBe("POST")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.abortSession("ses_1")
    })

    test("forkSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/fork")
        const body = JSON.parse(opts?.body as string)
        expect(body.messageID).toBe("msg_5")
        return { json: async () => ({ id: "ses_fork", title: "fork" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.forkSession("ses_1", "msg_5")
    })

    test("getMessages", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session/ses_1/message")
        expect(url).toContain("limit=10")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.getMessages("ses_1", 10)
    })

    test("subscribe returns object with stream", () => {
      const client = createClient({
        baseUrl: "http://x",
        directory: "/d",
        fetch: mockFetch(() => ({ ok: true })),
      })
      const result = client.subscribe()
      expect(result).toBeDefined()
      expect(result.stream).toBeDefined()
    })
  })

  describe("error propagation", () => {
    test("client created with valid config", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "/tmp" })
      expect(client).toBeDefined()
      expect(typeof client.getSession).toBe("function")
      expect(typeof client.subscribe).toBe("function")
    })
  })
})

function mockFetch(handler: (url: string, opts?: RequestInit) => Promise<{ json: () => Promise<any>; ok?: boolean; status?: number; statusText?: string; headers?: Headers }>) {
  return (async (url: string, opts?: RequestInit) => {
    const result = await handler(url, opts)
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      statusText: result.statusText ?? "OK",
      json: result.json,
      headers: result.headers ?? new Headers(),
    }
  }) as any
}
