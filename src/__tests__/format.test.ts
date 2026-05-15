import { describe, test, expect } from "bun:test"
import {
  formatAIHeader, formatPrompt, formatPermissionPrompt, formatSeparator,
  formatConnecting, formatConnected, formatConnectionError, formatSessionNotFound,
  formatSessionCreateError, formatInfo, formatFiles,
  formatTextDelta, formatToolCall, formatReasoning,
  formatHistory, formatSessions, formatAbortMessage,
  formatDisconnectMessage, formatDisconnectPermMessage, formatQuestionPrompt,
} from "../format"

function strip(s: string) { return s.replace(/\x1b\[\d+(;\d+)?m/g, "") }

describe("format", () => {
  describe("formatAIHeader", () => {
    test("all fields present", () => {
      const out = formatAIHeader("build", "claude-sonnet-4")
      expect(out).toContain("AI")
      expect(out).toContain("build")
      expect(out).toContain("claude-sonnet-4")
    })
    test("agent undefined", () => {
      const out = formatAIHeader(undefined, "claude-sonnet-4")
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
    test("modelID undefined", () => {
      const out = formatAIHeader("build", undefined)
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
  })

  describe("formatPrompt", () => {
    test("idle prompt", () => {
      const out = formatPrompt()
      expect(out).toContain(">")
    })
  })

  describe("formatPermissionPrompt", () => {
    test("renders permission request", () => {
      const out = formatPermissionPrompt("bash", ["rm -rf dist/"])
      expect(out).toContain("⚠")
      expect(out).toContain("bash")
      expect(out).toContain("rm -rf dist/")
      expect(out).toContain("y=")
      expect(out).toContain("n=")
      expect(out).toContain("a=")
    })
  })

  describe("formatSeparator", () => {
    test("with label", () => {
      const out = formatSeparator("最近 10 条消息")
      expect(out).toContain("最近 10 条消息")
      expect(out).toContain("─")
    })
    test("empty label", () => {
      const out = formatSeparator()
      expect(out).toContain("─")
    })
  })

  describe("connect messages", () => {
    test("formatConnecting", () => {
      const out = formatConnecting("http://localhost:4096")
      expect(strip(out)).toContain("正在连接")
      expect(out).toContain("localhost:4096")
    })
    test("formatConnected", () => {
      const out = formatConnected("ses_xxx", "测试会话")
      expect(strip(out)).toContain("已连接")
      expect(out).toContain("ses_xxx")
      expect(out).toContain("测试会话")
    })
    test("formatConnectionError", () => {
      const out = formatConnectionError("ECONNREFUSED")
      expect(strip(out)).toContain("无法连接")
      expect(out).toContain("ECONNREFUSED")
    })
    test("formatSessionNotFound", () => {
      const out = formatSessionNotFound("ses_404")
      expect(out).toContain("ses_404")
      expect(strip(out)).toContain("不存在")
    })
    test("formatSessionCreateError", () => {
      const out = formatSessionCreateError("权限不足")
      expect(strip(out)).toContain("无法创建")
      expect(out).toContain("权限不足")
    })
  })

  describe("formatInfo", () => {
    test("full info", () => {
      const out = formatInfo({ id: "ses_1", title: "测试", directory: "/a", model: "openai/gpt-4o", files: ["a.ts"] })
      expect(strip(out)).toContain("Title")
      expect(out).toContain("ses_1")
      expect(out).toContain("openai/gpt-4o")
      expect(strip(out)).toContain("1")
    })
    test("no model", () => {
      const out = formatInfo({ id: "ses_1", title: "x", directory: "/a", model: undefined, files: [] })
      expect(out).toContain("默认")
    })
  })

  describe("formatFiles", () => {
    test("empty", () => {
      const out = formatFiles([])
      expect(strip(out)).toContain("无附件")
    })
    test("with files", () => {
      const out = formatFiles(["a.ts", "b.ts"])
      expect(strip(out)).toContain("1.")
      expect(strip(out)).toContain("2.")
      expect(out).toContain("a.ts")
      expect(out).toContain("b.ts")
    })
  })
})

describe("format stream events", () => {
  describe("formatTextDelta", () => {
    test("normal text", () => {
      expect(formatTextDelta("hello")).toBe("hello")
    })
    test("empty text", () => {
      expect(formatTextDelta("")).toBe("")
    })
  })

  describe("formatToolCall", () => {
    test("running", () => {
      const out = formatToolCall("bash", "npm install", "running")
      expect(strip(out)).toContain("⚙")
      expect(out).toContain("bash")
      expect(out).toContain("npm install")
    })
    test("completed", () => {
      const out = formatToolCall("bash", "npm install", "completed", "done!")
      expect(strip(out)).toContain("✓")
      expect(out).toContain("done!")
    })
    test("completed no output", () => {
      const out = formatToolCall("read", "file.ts", "completed")
      expect(strip(out)).toContain("✓")
      expect(() => out).not.toThrow()
    })
    test("error", () => {
      const out = formatToolCall("write", "config.json", "error", "EACCES")
      expect(strip(out)).toContain("✗")
      expect(out).toContain("EACCES")
    })
    test("undefined state does not throw", () => {
      const out = formatToolCall("bash", "cmd", undefined as any)
      expect(() => out).not.toThrow()
    })
  })

  describe("formatReasoning", () => {
    test("enabled", () => {
      const out = formatReasoning("思考中...", true)
      expect(strip(out)).toContain("思考中...")
    })
    test("disabled", () => {
      const out = formatReasoning("思考中...", false)
      expect(out).toBe("")
    })
  })

  describe("formatQuestionPrompt", () => {
    test("renders question", () => {
      const out = formatQuestionPrompt("你想使用哪个端口？")
      expect(strip(out)).toContain("?")
      expect(out).toContain("你想使用哪个端口")
    })
  })

  describe("formatAbortMessage", () => {
    test("renders", () => {
      const out = formatAbortMessage()
      expect(strip(out)).toContain("已中断")
    })
  })

  describe("formatDisconnectMessage", () => {
    test("streaming disconnect", () => {
      const out = formatDisconnectMessage()
      expect(strip(out)).toContain("连接中断")
    })
  })

  describe("formatDisconnectPermMessage", () => {
    test("permission disconnect", () => {
      const out = formatDisconnectPermMessage()
      expect(strip(out)).toContain("权限请求可能已被拒绝")
    })
  })
})

describe("formatHistory", () => {
  test("empty", () => {
    const out = formatHistory([], 10)
    expect(strip(out)).toContain("无历史")
  })
  test("user message", () => {
    const out = formatHistory([{ role: "user", text: "hello" }])
    expect(out).toContain("You:")
    expect(out).toContain("hello")
  })
  test("assistant message", () => {
    const out = formatHistory([{ role: "assistant", text: "hi" }])
    expect(out).toContain("AI:")
    expect(out).toContain("hi")
  })
  test("long message truncation", () => {
    const msg = "a".repeat(130)
    const out = formatHistory([{ role: "user", text: msg }])
    expect(strip(out)).toContain("...")
    expect(strip(out).length).toBeLessThan(300)
  })
  test("multiline preserved", () => {
    const out = formatHistory([{ role: "user", text: "line1\nline2" }])
    expect(out).toContain("line1")
    expect(out).toContain("line2")
  })
  test("respects limit", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, text: `msg${i}` }))
    const out = formatHistory(msgs, 5)
    const lines = out.split("\n")
    const count = lines.filter(l => l.includes("You:")).length
    expect(count).toBe(5)
  })
})

describe("formatSessions", () => {
  test("empty", () => {
    const out = formatSessions([])
    expect(strip(out)).toContain("无 session")
  })
  test("single", () => {
    const out = formatSessions([{ id: "ses_1", title: "测试", updated: "11:18" }])
    expect(out).toContain("ses_1")
    expect(out).toContain("测试")
    expect(out).toContain("11:18")
    expect(out).toContain("Session ID")
    expect(out).toContain("Title")
    expect(out).toContain("Updated")
  })
  test("long id truncated", () => {
    const out = formatSessions([{ id: "s".repeat(30), title: "测试", updated: "11:18" }])
    const stripped = strip(out)
    expect(stripped).toContain("...")
    expect(stripped.length).toBeLessThan(180)
  })
  test("long title truncated", () => {
    const out = formatSessions([{ id: "ses_1", title: "这是一个非常非常非常非常非常非常非常非常长的标题需要被截断显示省略号", updated: "11:18" }])
    const stripped = strip(out)
    expect(stripped).toContain("...")
  })
})
