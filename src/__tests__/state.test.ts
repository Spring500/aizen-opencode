import { describe, test, expect } from "bun:test"
import { createSession, createConfig, startMultiline, pushLine, finishMultiline } from "../state"

describe("state", () => {
  describe("createConfig", () => {
    test("defaults", () => {
      const c = createConfig({})
      expect(c.serverUrl).toBe("http://localhost:4096")
      expect(c.thinking).toBe(false)
      expect(c.newSession).toBe(false)
      expect(c.initSession).toBe("")
    })
    test("custom url", () => {
      const c = createConfig({ serverUrl: "http://example.com:8080" })
      expect(c.serverUrl).toBe("http://example.com:8080")
    })
    test("--thinking flag", () => {
      const c = createConfig({ thinking: true })
      expect(c.thinking).toBe(true)
    })
    test("--new flag", () => {
      const c = createConfig({ newSession: true })
      expect(c.newSession).toBe(true)
    })
    test("--session", () => {
      const c = createConfig({ initSession: "ses_abc" })
      expect(c.initSession).toBe("ses_abc")
    })
    test("--dir", () => {
      const c = createConfig({ directory: "/tmp" })
      expect(c.directory).toBe("/tmp")
    })
  })

  describe("createSession", () => {
    test("all fields", () => {
      const s = createSession({ id: "ses_001", title: "测试" })
      expect(s.id).toBe("ses_001")
      expect(s.title).toBe("测试")
      expect(s.files).toEqual([])
      expect(s.approved).toBeInstanceOf(Set)
      expect(s.approved.size).toBe(0)
    })
    test("with model", () => {
      const s = createSession({ id: "ses_002", title: "x", model: "openai/gpt-4o" })
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("with files", () => {
      const s = createSession({ id: "ses_003", title: "x", files: ["a.ts", "b.ts"] })
      expect(s.files).toEqual(["a.ts", "b.ts"])
    })
    test("default model is undefined", () => {
      const s = createSession({ id: "ses_004", title: "x" })
      expect(s.model).toBeUndefined()
    })
  })

  describe("session mutations", () => {
    test("switchSession updates id, title, clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = { ...s, id: "ses_002", title: "新", approved: new Set<string>() }
      expect(s2.id).toBe("ses_002")
      expect(s2.title).toBe("新")
      expect(s2.approved.size).toBe(0)
    })
    test("newSession clears files and approved", () => {
      const s = createSession({ id: "ses_old", title: "x", files: ["f.ts"] })
      s.approved.add("pw")
      const s2 = createSession({ id: "ses_new", title: "新会话" })
      expect(s2.files).toEqual([])
      expect(s2.approved.size).toBe(0)
    })
    test("forkSession clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = createSession({ id: "ses_fork", title: "fork" })
      expect(s2.approved.size).toBe(0)
    })
    test("setModel", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, model: "openai/gpt-4o" }
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("addFile", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, files: [...s.files, "src/foo.ts"] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("addFile deduplication", () => {
      let s = createSession({ id: "ses_001", title: "x", files: ["src/foo.ts"] })
      s = { ...s, files: [...new Set([...s.files, "src/foo.ts"])] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("clearFiles", () => {
      const s = createSession({ id: "ses_001", title: "x", files: ["a.ts", "b.ts"] })
      const s2 = { ...s, files: [] }
      expect(s2.files).toEqual([])
    })
    test("approvePattern", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, approved: new Set([...s.approved, "rm -rf dist/"]) }
      expect(s.approved.has("rm -rf dist/")).toBe(true)
    })
  })

  describe("multiline", () => {
    test("startMultiline", () => {
      const m = startMultiline()
      expect(m.active).toBe(true)
      expect(m.buffer).toEqual([])
    })
    test("pushLine", () => {
      let m = startMultiline()
      m = pushLine(m, "line1")
      m = pushLine(m, "line2")
      expect(m.buffer).toEqual(["line1", "line2"])
    })
    test("finishMultiline", () => {
      let m = startMultiline()
      m = pushLine(m, "a")
      m = pushLine(m, "b")
      const result = finishMultiline(m)
      expect(result).toBe("a\nb")
    })
    test("finishMultiline empty buffer returns null", () => {
      const m = startMultiline()
      const result = finishMultiline(m)
      expect(result).toBeNull()
    })
    test("finishMultiline empty lines", () => {
      let m = startMultiline()
      m = pushLine(m, "")
      const result = finishMultiline(m)
      expect(result).toBe("")
    })
  })
})
