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
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendMessage("ses_1", { parts: [{ type: "text", text: "hello" }] })
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

    test("sendCommand with model", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/command")
        const body = JSON.parse(opts?.body as string)
        expect(body.command).toBe("model")
        expect(body.model).toBe("openai/gpt-4o")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendCommand("ses_1", { command: "model", arguments: "openai/gpt-4o", model: "openai/gpt-4o" })
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

    test("createClient with empty directory does not crash", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "" })
      expect(client).toBeDefined()
    })

    test("listSessions surfaces network error", async () => {
      const netError = new Error("fetch failed")
      ;(netError as any).code = "ECONNREFUSED"
      const fetch = mockFetch(() => { throw netError })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      const result = await client.listSessions({})
      expect(result).toEqual([])
    })

    test("getSession surfaces HTTP 404", async () => {
      const fetch = mockFetch(() => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "session not found" }),
      }))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      const result = await client.getSession("ses_missing")
      expect(result).toBeUndefined()
    })

    test("createSession surfaces HTTP 500", async () => {
      const fetch = mockFetch(() => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ message: "server error" }),
      }))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      const result = await client.createSession({ title: "test" })
      expect(result).toBeUndefined()
    })
  })
})

function mockFetch(handler: (url: string, opts?: RequestInit) => any) {
  return (async (url: string, opts?: RequestInit) => {
    const result = await handler(url, opts)
    const json = result.json ?? (async () => ({}))
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      statusText: result.statusText ?? "OK",
      json,
      text: result.text ?? (async () => JSON.stringify(await json())),
      headers: result.headers ?? new Headers(),
    }
  }) as any
}
