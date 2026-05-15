import { describe, test, expect } from "bun:test"
import { parseSlash } from "../commands/slash"

describe("slash", () => {
  describe("local commands", () => {
    test("/quit", () => {
      expect(parseSlash("/quit")).toEqual({ local: true, command: "quit", args: "" })
    })
    test("/exit", () => {
      expect(parseSlash("/exit")).toEqual({ local: true, command: "exit", args: "" })
    })
    test("/switch with id", () => {
      expect(parseSlash("/switch ses_abc")).toEqual({ local: true, command: "switch", args: "ses_abc" })
    })
    test("/switch no args", () => {
      expect(parseSlash("/switch")).toEqual({ local: true, command: "switch", args: "" })
    })
    test("/new with title", () => {
      expect(parseSlash("/new 新标题")).toEqual({ local: true, command: "new", args: "新标题" })
    })
    test("/new no args", () => {
      expect(parseSlash("/new")).toEqual({ local: true, command: "new", args: "" })
    })
    test("/fork with messageID", () => {
      expect(parseSlash("/fork msg_001")).toEqual({ local: true, command: "fork", args: "msg_001" })
    })
    test("/fork no args", () => {
      expect(parseSlash("/fork")).toEqual({ local: true, command: "fork", args: "" })
    })
    test("/history 20", () => {
      expect(parseSlash("/history 20")).toEqual({ local: true, command: "history", args: "20" })
    })
    test("/history no args", () => {
      expect(parseSlash("/history")).toEqual({ local: true, command: "history", args: "" })
    })
    test("/file with path", () => {
      expect(parseSlash("/file src/index.ts")).toEqual({ local: true, command: "file", args: "src/index.ts" })
    })
    test("/files", () => {
      expect(parseSlash("/files")).toEqual({ local: true, command: "files", args: "" })
    })
    test("/clear-files", () => {
      expect(parseSlash("/clear-files")).toEqual({ local: true, command: "clear-files", args: "" })
    })
    test("/model with spec", () => {
      expect(parseSlash("/model openai/gpt-4o")).toEqual({ local: true, command: "model", args: "openai/gpt-4o" })
    })
    test("/model no args", () => {
      expect(parseSlash("/model")).toEqual({ local: true, command: "model", args: "" })
    })
    test("/info", () => {
      expect(parseSlash("/info")).toEqual({ local: true, command: "info", args: "" })
    })
    test("/sessions 5", () => {
      expect(parseSlash("/sessions 5")).toEqual({ local: true, command: "sessions", args: "5" })
    })
    test("/sessions no args", () => {
      expect(parseSlash("/sessions")).toEqual({ local: true, command: "sessions", args: "" })
    })
    test("case insensitive /QUIT", () => {
      expect(parseSlash("/QUIT")).toEqual({ local: true, command: "quit", args: "" })
    })
    test("trims whitespace", () => {
      expect(parseSlash("/switch   ses_abc  ")).toEqual({ local: true, command: "switch", args: "ses_abc" })
    })
  })

  describe("passthrough commands", () => {
    test("/review", () => { const r = parseSlash("/review"); expect(r!.local).toBe(false); expect(r!.command).toBe("review") })
    test("/compact", () => { const r = parseSlash("/compact"); expect(r!.local).toBe(false) })
    test("/release with args", () => { const r = parseSlash("/release minor"); expect(r!.local).toBe(false); expect(r!.command).toBe("release"); expect(r!.arguments).toBe("minor") })
    test("/unknown", () => { const r = parseSlash("/foobar baz"); expect(r!.local).toBe(false) })
    test("bare /", () => { const r = parseSlash("/"); expect(r!.local).toBe(false); expect(r!.command).toBe(""); expect(r!.arguments).toBe("") })
  })

  describe("non-slash", () => {
    test("plain text", () => { expect(parseSlash("你好")).toBeNull() })
    test("empty", () => { expect(parseSlash("")).toBeNull() })
    test("leading space", () => { expect(parseSlash("  /quit")).toBeNull() })
  })
})
