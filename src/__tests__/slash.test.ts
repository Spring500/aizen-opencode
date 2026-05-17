// ============================================================================
// slash.test.ts
// ============================================================================
//
// 这个文件测试斜杠命令的解析逻辑。用户在 REPL 里输入以 "/" 开头的文本时，
// 需要判断它是一个本地命令（REPL 自己处理）、远程命令（转发给服务端），
// 还是根本就不是命令（普通聊天文本）。
//
// 本地命令有 12 个：quit、exit、switch、new、fork、history、file、
// files、clear-files、model、info、sessions。它们的共同特征是 local=true，
// 并且附带命令名和参数。不在这个列表里的 /xxx 都归为远程命令（local=false）。
//
// 具体覆盖了：
//   - 每个本地命令的识别，包括带参数和不带参数的情况
//   - /review、/compact、/release 等远程命令的识别（local=false）
//   - 远程命令的参数放在 arguments 字段里
//   - 普通文本（不以 / 开头）返回 null
//   - 空字符串返回 null
//   - 前面有空格的 "/xxx" 不算命令，返回 null
//   - 大小写不敏感（/QUIT 等同于 /quit）
//   - 前后空白自动去掉
//   - 单个 "/" 被视为内容为空的远程命令
//
// ============================================================================

import { describe, test, expect } from "vitest"
import { parseSlash } from "../commands/slash"

describe("slash", () => {
  // 本地命令：/quit /switch /new /file 等，由 REPL 内部处理
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

  // passthrough 命令：不在本地命令列表中的斜杠输入，转发给服务端
  describe("passthrough commands", () => {
    test("/review", () => { const r = parseSlash("/review"); expect(r!.local).toBe(false); expect(r!.command).toBe("review") })
    test("/compact", () => { const r = parseSlash("/compact"); expect(r!.local).toBe(false) })
    test("/release with args", () => { const r = parseSlash("/release minor")!; expect(r.local).toBe(false); expect(r.command).toBe("release"); if (!r.local) expect(r.arguments).toBe("minor") })
    test("/unknown", () => { const r = parseSlash("/foobar baz"); expect(r!.local).toBe(false) })
    test("bare /", () => { const r = parseSlash("/")!; expect(r.local).toBe(false); expect(r.command).toBe(""); if (!r.local) expect(r.arguments).toBe("") })
  })

  // 非斜杠输入：普通文本、空字符串等应返回 null（作为普通聊天消息处理）
  describe("non-slash", () => {
    test("plain text", () => { expect(parseSlash("你好")).toBeNull() })
    test("empty", () => { expect(parseSlash("")).toBeNull() })
    test("leading space", () => { expect(parseSlash("  /quit")).toBeNull() })
  })
})
