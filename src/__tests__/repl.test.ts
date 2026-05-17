import { describe, test, expect } from "vitest"
import { extractMessageContent } from "../repl"

describe("extractMessageContent", () => {
  test("user message with TextPart first", () => {
    const m = {
      info: { role: "user" },
      parts: [{ type: "text", text: "hello" }],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("user")
    expect(result.lines).toEqual([{ type: "text", content: "hello" }])
  })

  test("assistant message with TextPart first", () => {
    const m = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "hi there" }],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines).toEqual([{ type: "text", content: "hi there" }])
  })

  test("assistant message with TextPart after other parts", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "step-start" },
        { type: "tool", tool: "bash", state: { status: "completed", title: "run cmd", output: "ok" } },
        { type: "text", text: "result" },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toEqual({ type: "tool", content: "✓ [bash] run cmd (completed)" })
    expect(result.lines[1]).toEqual({ type: "tool-output", content: "ok" })
    expect(result.lines[2]).toEqual({ type: "text", content: "result" })
  })

  test("skips empty text parts", () => {
    const m = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "" }],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines).toEqual([{ type: "text", content: "(no text)" }])
  })

  test("fallback to ReasoningPart text when no TextPart", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "reasoning", text: "thinking..." },
        { type: "tool", tool: "read", state: { status: "completed", output: "file content" } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines[0]).toEqual({ type: "text", content: "thinking..." })
    expect(result.lines[1].type).toBe("tool")
    expect(result.lines[2].type).toBe("tool-output")
  })

  test("no text parts at all but has tool shows tool only", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "bash", state: { status: "running", title: "npm install" } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines).toEqual([{ type: "tool", content: "⚙ [bash] npm install (running)" }])
  })

  test("tool error with output", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "write", state: { status: "error", title: "save file", error: "EACCES" } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.lines[0]).toEqual({ type: "tool", content: "✗ [write] save file (error)" })
    expect(result.lines[1]).toEqual({ type: "tool-output", content: "EACCES" })
  })

  test("tool output truncated over 200 chars", () => {
    const longOutput = "x".repeat(300)
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "cat", state: { status: "completed", title: "read file", output: longOutput } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.lines[1].content).toHaveLength(203) // 200 chars + "..."
    expect(result.lines[1].content.endsWith("...")).toBe(true)
  })

  test("empty parts array shows (no text)", () => {
    const m = {
      info: { role: "assistant" },
      parts: [],
    }
    const result = extractMessageContent(m)
    expect(result.lines).toEqual([{ type: "text", content: "(no text)" }])
  })

  test("undefined parts shows (no text)", () => {
    const m = {
      info: { role: "assistant" },
    }
    const result = extractMessageContent(m)
    expect(result.lines).toEqual([{ type: "text", content: "(no text)" }])
  })

  test("role fallback when info missing", () => {
    const m = {
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    }
    expect(extractMessageContent(m).role).toBe("assistant")
  })
})
