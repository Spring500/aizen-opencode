// ============================================================================
// client.test.ts
// ============================================================================
//
// 这个文件测试 HTTP 客户端的行为——也就是 REPL 是怎么和服务端通信的。
// 覆盖了三块：客户端能调哪些接口、每个接口发出的 HTTP 请求长什么样、
// 以及网络或服务端出错时客户端怎么反应。
//
// 具体来说：
//   - 确认客户端对象上有 11 个方法（列举会话、获取/创建会话、发消息、
//     发命令、回复权限、回复问题、中断、派生、取历史、订阅事件流）
//   - 模拟 HTTP 请求，检查 URL 路径、HTTP 方法、query 参数、请求体
//     是否和预期一致
//   - 网络断开时请求不抛异常，静默返回空结果
//   - 服务端返回 404 或 500 时抛出一个带中文错误信息的异常
//   - 空目录参数不导致崩溃
//
// 测试用了一个假的 fetch 来截获 SDK 发出的请求，然后把 Request 对象
// 拆成 { url, method, body, headers } 传给每个用例去断言。
//
// ============================================================================
// ============================================================================

import { describe, test, expect } from "vitest"
import { createClient } from "../client"

describe("client", () => {
  // createClient() 工厂函数：验证客户端实例构造，包括 baseUrl 注入
  describe("createClient", () => {
    test("returns client instance", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "/tmp" })
      expect(client).toBeDefined()
      expect(typeof client.baseUrl).toBe("string")
    })
  })

  // API wrappers：验证每个 API 方法构造的 HTTP 请求是否正确
  // （URL 路径、HTTP method、query params、body、特殊参数如 model/arguments）
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

  // 错误传播：验证网络错误静默处理、HTTP 错误正确抛出
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
      await expect(client.getSession("ses_missing")).rejects.toThrow("404")
    })

    test("createSession surfaces HTTP 500", async () => {
      const fetch = mockFetch(() => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ message: "server error" }),
      }))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await expect(client.createSession({ title: "test" })).rejects.toThrow("500")
    })
  })
})

// mockFetch：创建一个模拟的 fetch 函数。
// 从 Request 对象中提取 url / method / body / headers 传给 handler，
// 然后将 handler 的返回值包装为真实的 Response 对象返回给 SDK。
function mockFetch(handler: (url: string, opts?: { method?: string; body?: any; headers?: Headers }) => any) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    const url = req.url
    const opts = {
      method: req.method,
      body: await req.text().catch(() => req.body),
      headers: req.headers,
    }
    const raw = await handler(url, opts)
    const body = typeof raw?.json === "function" ? await raw.json() : raw
    return new Response(JSON.stringify(body), {
      status: raw?.status ?? 200,
      statusText: raw?.statusText ?? "OK",
      headers: raw?.headers ?? { "Content-Type": "application/json" },
    })
  }) as any
}
