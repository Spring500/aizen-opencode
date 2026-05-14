import { describe, test, expect } from "bun:test"
import {
  formatAIHeader, formatPrompt, formatPermissionPrompt, formatSeparator,
  formatConnecting, formatConnected, formatConnectionError, formatSessionNotFound,
  formatSessionCreateError, formatInfo, formatFiles,
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
