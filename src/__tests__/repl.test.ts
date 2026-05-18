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
    expect(result.lines).toHaveLength(4) // step-start + tool + tool-output + text
    expect(result.lines[0]).toEqual({ type: "step-start", content: "开始" })
    expect(result.lines[1]).toEqual({ type: "tool", content: "✓ [bash] run cmd (completed)" })
    expect(result.lines[2]).toEqual({ type: "tool-output", content: "ok" })
    expect(result.lines[3]).toEqual({ type: "text", content: "result" })
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

  test("reasoning part has its own type", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "reasoning", text: "thinking..." },
        { type: "tool", tool: "read", state: { status: "completed", output: "file content" } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.role).toBe("assistant")
    expect(result.lines[0]).toEqual({ type: "reasoning", content: "thinking..." })
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

  test("filters out hidden part types", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "visible" },
        { type: "tool", tool: "bash", state: { status: "completed", title: "cmd", output: "ok" } },
      ],
    }
    const filtered = extractMessageContent(m, new Set(["text"]))
    expect(filtered.lines).toEqual([{ type: "text", content: "visible" }])
  })

  test("no filter includes all part types", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "hello" },
        { type: "reasoning", text: "think" },
        { type: "tool", tool: "bash", state: { status: "completed", title: "cmd", output: "ok" } },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.lines).toHaveLength(4) // text + reasoning + tool + tool-output
  })

  test("all part types are extracted", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "step-start" },
        { type: "text", text: "hello" },
        { type: "step-finish", reason: "done", cost: 0.001, tokens: { input: 100, output: 50 } },
        { type: "file", filename: "src/main.ts", mime: "text/typescript" },
        { type: "snapshot", snapshot: "snap_1" },
        { type: "patch", hash: "a1b2c3d4e5f6", files: ["a.ts", "b.ts"] },
        { type: "agent", name: "build", source: { value: "run tests" } },
        { type: "retry", attempt: 2, error: { message: "timeout" } },
        { type: "compaction", auto: true },
        { type: "subtask", agent: "review", prompt: "请审查代码", description: "审查代码" },
      ],
    }
    const result = extractMessageContent(m)
    expect(result.lines).toHaveLength(10)
    expect(result.lines.map(l => l.type)).toEqual([
      "step-start", "text", "step-finish", "file", "snapshot",
      "patch", "agent", "retry", "compaction", "subtask",
    ])
  })
})
