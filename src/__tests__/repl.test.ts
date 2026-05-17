import { describe, test, expect } from "vitest"
import { extractMessageText } from "../repl"

describe("extractMessageText", () => {
  test("user message with TextPart first", () => {
    const m = {
      info: { role: "user" },
      parts: [{ type: "text", text: "hello" }],
    }
    expect(extractMessageText(m)).toEqual({ role: "user", text: "hello" })
  })

  test("assistant message with TextPart first", () => {
    const m = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "hi there" }],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "hi there" })
  })

  test("assistant message with TextPart after other parts", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "step-start" },
        { type: "tool", tool: "bash", state: { status: "completed" } },
        { type: "text", text: "result" },
      ],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "result" })
  })

  test("takes only first TextPart when multiple exist", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "first" },
        { type: "tool" },
        { type: "text", text: "second" },
      ],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "first" })
  })

  test("fallback to ReasoningPart text when no TextPart", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "reasoning", text: "thinking..." },
        { type: "tool" },
      ],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "thinking..." })
  })

  test("joins multiple reasoning/text parts", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "reasoning", text: "step1" },
        { type: "reasoning", text: "step2" },
      ],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "step1 step2" })
  })

  test("no text parts at all shows (no text)", () => {
    const m = {
      info: { role: "assistant" },
      parts: [
        { type: "step-start" },
        { type: "tool", tool: "bash" },
        { type: "step-finish" },
      ],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "(no text)" })
  })

  test("empty parts array shows (no text)", () => {
    const m = {
      info: { role: "assistant" },
      parts: [],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "(no text)" })
  })

  test("undefined parts shows (no text)", () => {
    const m = {
      info: { role: "assistant" },
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "(no text)" })
  })

  test("role fallback when info missing", () => {
    const m = {
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "hello" })
  })

  test("empty TextPart text is preserved", () => {
    const m = {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "" }],
    }
    expect(extractMessageText(m)).toEqual({ role: "assistant", text: "" })
  })
})
